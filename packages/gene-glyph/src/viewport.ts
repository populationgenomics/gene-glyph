import type {
  AnchorTarget,
  CdsPosition,
  CoordinateMapper,
  DroppedRange,
  GenomicPosition,
  RangeProjection,
  RangeSegment,
  ScreenPoint,
  ViewMode,
  Viewport,
} from './types.js';

export interface ViewportControllerInit {
  mapper: CoordinateMapper;
  width: number;
  mode?: ViewMode;
  range?: readonly [number, number];
  intronScale?: number;
}

export interface TransitionTarget {
  range?: readonly [number, number];
}

export interface TransitionOptions {
  duration?: number;
}

/** Default duration for programmatic viewport transitions, in milliseconds.
 *  Matches the CSS `transition` on `.vv-exon-group` (350ms). */
export const DEFAULT_TRANSITION_MS = 350;

/** Fraction of the natural range used as soft padding for pan clamping
 *  (design §7: "pan clamps hard to gene bounds + ~5% padding"). The same
 *  padding governs the most zoomed-out state — `minZoom` defaults to the
 *  zoom that exactly fits `naturalRange + 2 × this fraction × naturalRange`. */
export const VIEWPORT_PAN_PADDING = 0.05;

/** Default upper zoom bound. ~200× the natural range covers "1 aa per 20px"
 *  on typical-width figures without over-tuning per mode; hosts can override
 *  via the `maxZoom` prop on `<GeneGlyph>`. */
export const DEFAULT_MAX_ZOOM = 200;

interface TransitionSchedule {
  fromRange: [number, number];
  toRange: [number, number];
  startTime: number;
  duration: number;
}

interface CssTarget {
  style: CSSStyleDeclaration;
}

/** Preferred pixel width of one collapsed-intron gap at full visibility. */
const PREF_GAP_PX = 24;
const MIN_GAP_PX = 4;
/** Cap total collapsed-intron pixels at this fraction of viewport width so
 *  genes with many exons still leave room for in-scale exon drawing. */
const GAP_BUDGET_FRACTION = 0.35;

interface ExonScreenSegment {
  exonIdx: number;
  /** Visible CDS bounds of this exon, clipped to the active range. */
  cdsLo: number;
  cdsHi: number;
  /** Screen x bounds of this exon. */
  xStart: number;
  xEnd: number;
}

interface CdsGeometry {
  segments: ExonScreenSegment[];
  /** Screen pixels per CDS bp inside exons. */
  pxPerBp: number;
  /** Width of one collapsed-intron gap in screen pixels. */
  gapPx: number;
}

function defaultRangeFor(mode: ViewMode, mapper: CoordinateMapper): [number, number] {
  if (mode === 'protein') {
    const aaLength = Math.floor(mapper.transcript.cdsLength / 3);
    return [1, Math.max(1, aaLength)];
  }
  return [1, Math.max(1, mapper.transcript.cdsLength)];
}

function defaultIntronScale(mode: ViewMode): number {
  return mode === 'cds-with-introns' ? 1 : 0;
}

export class ViewportController implements Viewport {
  private _mode: ViewMode;
  private _range: [number, number];
  private _width: number;
  private _intronScale: number;
  private _attached: CssTarget | null = null;
  private _transition: TransitionSchedule | null = null;
  readonly mapper: CoordinateMapper;

  constructor(init: ViewportControllerInit) {
    this.mapper = init.mapper;
    this._mode = init.mode ?? 'cds-with-introns';
    this._range = [...(init.range ?? defaultRangeFor(this._mode, this.mapper))] as [number, number];
    this._width = init.width;
    this._intronScale = init.intronScale ?? defaultIntronScale(this._mode);
  }

  // ---- Read-only state ---------------------------------------------------

  get mode(): ViewMode {
    return this._mode;
  }

  get intronScale(): number {
    return this._intronScale;
  }

  get range(): readonly [number, number] {
    return this._range;
  }

  get width(): number {
    return this._width;
  }

  // ---- Mutators ----------------------------------------------------------

  setMode(mode: ViewMode): void {
    this._mode = mode;
    this._intronScale = defaultIntronScale(mode);
    // Reproject the range onto the new mode's natural ruler.
    this._range = defaultRangeFor(mode, this.mapper);
    this._transition = null;
    this.publish();
  }

  setRange(range: readonly [number, number]): void {
    this._range = [range[0], range[1]];
    this._transition = null;
    this.publish();
  }

  /** Natural fit-gene range for the active mode (1..cdsLength, or 1..aaLength
   *  in protein mode). */
  naturalRange(): readonly [number, number] {
    return defaultRangeFor(this._mode, this.mapper);
  }

  /** Outer bound that pan + zoom-out are clamped to: the natural range plus
   *  `VIEWPORT_PAN_PADDING` on each side. The zoomed-all-the-way-out state
   *  shows this padded box; you cannot pan further than its edges. */
  paddedBounds(): readonly [number, number] {
    const [lo, hi] = this.naturalRange();
    const pad = (hi - lo) * VIEWPORT_PAN_PADDING;
    return [lo - pad, hi + pad];
  }

  /** Smallest visible-range length permitted by `maxZoom` (the most zoomed-in
   *  state). At zoom z, visible length = naturalLen / z, so minLen = naturalLen
   *  / maxZoom. */
  minVisibleLen(maxZoom: number): number {
    const [lo, hi] = this.naturalRange();
    const natural = hi - lo;
    if (!Number.isFinite(maxZoom) || maxZoom <= 0) return Math.max(1, natural);
    return Math.max(1, natural / maxZoom);
  }

  /** Largest visible-range length permitted by `minZoom`. Defaults to the
   *  padded bounds' length when `minZoom <= naturalLen / paddedLen`, which is
   *  what the design calls "min zoom = fit-gene + 5% padding". */
  maxVisibleLen(minZoom: number | undefined): number {
    const [lo, hi] = this.paddedBounds();
    const paddedLen = hi - lo;
    if (minZoom === undefined || !Number.isFinite(minZoom) || minZoom <= 0) {
      return paddedLen;
    }
    const naturalLen = this.naturalRange()[1] - this.naturalRange()[0];
    return Math.min(paddedLen, naturalLen / minZoom);
  }

  /** Pure clamp: tighten the given range so its length is in
   *  `[minVisibleLen, maxVisibleLen]` and its endpoints sit within
   *  `paddedBounds()`. Preserves the centre when possible. */
  clampRange(
    range: readonly [number, number],
    opts: { minZoom?: number; maxZoom: number },
  ): [number, number] {
    const [pLo, pHi] = this.paddedBounds();
    const minLen = this.minVisibleLen(opts.maxZoom);
    const maxLen = this.maxVisibleLen(opts.minZoom);

    let [lo, hi] = range[0] <= range[1] ? [range[0], range[1]] : [range[1], range[0]];
    const len = Math.max(minLen, Math.min(maxLen, hi - lo));
    const centre = (lo + hi) / 2;
    lo = centre - len / 2;
    hi = centre + len / 2;

    if (len >= pHi - pLo) {
      // Range can't fit inside the padded bounds — snap to the padded bounds.
      return [pLo, pHi];
    }
    if (lo < pLo) {
      hi += pLo - lo;
      lo = pLo;
    }
    if (hi > pHi) {
      lo -= hi - pHi;
      hi = pHi;
    }
    return [lo, hi];
  }

  /** Mutates state to the target and records a transition schedule so that
   *  `getInterpolatedRange()` can report intermediate values during animation.
   *  CSS transitions on `.vv-exon-group` and `.vv-intron-decoration` provide
   *  the visual interpolation; this method only sets the new CSS-variable
   *  targets and records the schedule for host queries. */
  transitionTo(target: TransitionTarget, options?: TransitionOptions): void {
    const duration = options?.duration ?? DEFAULT_TRANSITION_MS;
    if (target.range) {
      const fromRange: [number, number] = [this._range[0], this._range[1]];
      const toRange: [number, number] = [target.range[0], target.range[1]];
      this._transition = { fromRange, toRange, startTime: now(), duration };
      this._range = toRange;
    }
    this.publish();
  }

  /** Range as it would be at the current animation timestamp — interpolated
   *  through the in-flight transition curve, or the committed range if no
   *  transition is active or the transition has elapsed. */
  getInterpolatedRange(): readonly [number, number] {
    const t = this._transition;
    if (!t) return this._range;
    const elapsed = now() - t.startTime;
    if (elapsed >= t.duration) {
      this._transition = null;
      return this._range;
    }
    const eased = easeOutQuart(Math.max(0, elapsed / t.duration));
    const a = t.fromRange[0] + (t.toRange[0] - t.fromRange[0]) * eased;
    const b = t.fromRange[1] + (t.toRange[1] - t.fromRange[1]) * eased;
    return [a, b];
  }

  /** Whether a programmatic transition is currently in flight. */
  isTransitioning(): boolean {
    if (!this._transition) return false;
    return now() - this._transition.startTime < this._transition.duration;
  }

  setWidth(width: number): void {
    this._width = width;
    this.publish();
  }

  setIntronScale(scale: number): void {
    this._intronScale = scale;
    this.publish();
  }

  // ---- CSS variable publication -----------------------------------------

  attach(el: CssTarget): void {
    this._attached = el;
    this.publish();
  }

  detach(): void {
    this._attached = null;
  }

  publish(): void {
    if (!this._attached) return;
    const s = this._attached.style;
    s.setProperty('--vv-zoom', this.zoom().toString());
    s.setProperty('--vv-pan-x', '0px');
    s.setProperty('--vv-intron-scale', this._intronScale.toString());
    const exons = this.mapper.transcript.exons;
    const segByIdx = new Map<number, ExonScreenSegment>();
    if (this.usesPiecewiseGeometry()) {
      const geom = this.cdsGeometry();
      for (const seg of geom.segments) segByIdx.set(seg.exonIdx, seg);
    }
    const xEndByIdx = new Array<number>(exons.length);
    for (let i = 0; i < exons.length; i++) {
      const seg = segByIdx.get(i);
      const e = exons[i]!;
      let xStart: number;
      let xEnd: number;
      if (seg) {
        xStart = seg.xStart;
        xEnd = seg.xEnd;
      } else {
        const a = this.cdsToScreen(e.cdsStart, 0);
        const b = this.cdsToScreen(e.cdsEnd, 0);
        xStart = a ?? 0;
        xEnd = b ?? xStart;
      }
      xEndByIdx[i] = xEnd;
      s.setProperty(`--vv-exon-x-${i}`, `${xStart}px`);
      s.setProperty(`--vv-exon-w-${i}`, `${Math.max(0, xEnd - xStart)}px`);
    }
    // Per-gap inter-exon translate. Drives `transform: translateX(...)` on
    // each `.vv-intron-decoration` `<g>` (published by the SVG painter) so
    // intron polylines / linkers share the same CSS transition path as the
    // exon groups and don't jump when the range changes.
    for (let i = 0; i < exons.length - 1; i++) {
      s.setProperty(`--vv-intron-x-${i}`, `${xEndByIdx[i] ?? 0}px`);
    }
  }

  private usesPiecewiseGeometry(): boolean {
    return this._mode === 'cds-with-introns';
  }

  /** Zoom scalar relative to fit-gene. >1 = zoomed in. */
  zoom(): number {
    const naturalSpan = defaultRangeFor(this._mode, this.mapper);
    const naturalLen = naturalSpan[1] - naturalSpan[0];
    const currentLen = this._range[1] - this._range[0];
    return currentLen > 0 ? naturalLen / currentLen : 1;
  }

  // ---- Point projection --------------------------------------------------

  private rulerOf(cPos: number): number | null {
    // Convert a CDS position to the active ruler coordinate (protein mode only;
    // CDS modes go through the piecewise geometry instead).
    if (this._mode === 'protein') {
      const aa = this.mapper.cdsToProtein(cPos);
      return aa;
    }
    return cPos;
  }

  private mapToScreen(rulerPos: number): number | null {
    const [lo, hi] = this._range;
    if (rulerPos < lo || rulerPos > hi) return null;
    if (hi === lo) return 0;
    return ((rulerPos - lo) / (hi - lo)) * this._width;
  }

  cdsToScreen(cPos: number, offset: number): number | null {
    if (this._mode === 'cds-spliced' && offset !== 0) return null;
    if (this._mode === 'protein' && offset !== 0) return null;
    if (offset !== 0) return null;
    if (this.usesPiecewiseGeometry()) {
      const geom = this.cdsGeometry();
      return cdsToScreenViaGeometry(geom, cPos);
    }
    const ruler = this.rulerOf(cPos);
    if (ruler === null) return null;
    return this.mapToScreen(ruler);
  }

  proteinToScreen(aa: number): number | null {
    if (this._mode === 'protein') {
      return this.mapToScreen(aa);
    }
    const cPos = this.mapper.proteinToCds(aa);
    return this.cdsToScreen(cPos, 0);
  }

  genomicToScreen(chr: string, pos: number): number | null {
    const cds = this.mapper.genomicToCds(chr, pos);
    if (!cds) return null;
    return this.cdsToScreen(cds.cPos, cds.offset);
  }

  screenToCds(x: number): CdsPosition | null {
    if (this.usesPiecewiseGeometry()) {
      if (x < 0 || x > this._width) return null;
      const geom = this.cdsGeometry();
      return screenToCdsViaGeometry(geom, x);
    }
    const ruler = this.screenToRuler(x);
    if (ruler === null) return null;
    if (this._mode === 'protein') {
      const aa = Math.round(ruler);
      return { cPos: this.mapper.proteinToCds(aa), offset: 0 };
    }
    return { cPos: Math.round(ruler), offset: 0 };
  }

  screenToProtein(x: number): number | null {
    const cds = this.screenToCds(x);
    if (!cds) return null;
    return this.mapper.cdsToProtein(cds.cPos);
  }

  screenToGenomic(x: number): GenomicPosition | null {
    const cds = this.screenToCds(x);
    if (!cds) return null;
    return this.mapper.cdsToGenomic(cds.cPos, cds.offset);
  }

  /** Ruler coordinate (CDS bp in CDS modes, aa in protein mode) at the given
   *  screen x. Used as the anchor for cursor-anchored zoom. In
   *  `cds-with-introns` mode we go through `screenToCds` (which understands
   *  the piecewise geometry); in linear modes we use the simple ratio. */
  rulerAtScreen(x: number): number | null {
    if (this.usesPiecewiseGeometry()) {
      const cds = this.screenToCds(x);
      return cds ? cds.cPos : null;
    }
    return this.screenToRuler(x);
  }

  private screenToRuler(x: number): number | null {
    if (x < 0 || x > this._width) return null;
    const [lo, hi] = this._range;
    if (this._width === 0) return lo;
    return lo + (x / this._width) * (hi - lo);
  }

  // ---- Range projection --------------------------------------------------

  projectCdsRange(start: number, end: number): RangeProjection {
    const [lo, hi] = clampOrdered(start, end);
    return this.projectExonic(lo, hi);
  }

  projectProteinRange(aaStart: number, aaEnd: number): RangeProjection {
    const [lo, hi] = clampOrdered(aaStart, aaEnd);
    // First and last base of the residue range in CDS coords.
    const cdsLo = this.mapper.proteinToCds(lo);
    const cdsHi = this.mapper.proteinToCds(hi) + 2;
    return this.projectExonic(cdsLo, cdsHi);
  }

  projectGenomicRange(chr: string, start: number, end: number): RangeProjection {
    const [gLo, gHi] = clampOrdered(start, end);
    const exons = this.mapper.transcript.exons;

    const segments: RangeSegment[] = [];
    const droppedRanges: DroppedRange[] = [];
    let droppedIntronicCount = 0;
    let droppedExonicCount = 0;

    const exonHits: Array<{ idx: number; cdsLo: number; cdsHi: number }> = [];
    for (let i = 0; i < exons.length; i++) {
      const e = exons[i]!;
      if (e.chr !== chr) continue;
      const overlapLo = Math.max(gLo, e.genomicStart);
      const overlapHi = Math.min(gHi, e.genomicEnd);
      if (overlapLo > overlapHi) continue;
      const cdsA = exonicToCds(e, overlapLo, this.mapper.transcript.strand);
      const cdsB = exonicToCds(e, overlapHi, this.mapper.transcript.strand);
      const cdsLo = Math.min(cdsA, cdsB);
      const cdsHi = Math.max(cdsA, cdsB);
      exonHits.push({ idx: i, cdsLo, cdsHi });
    }

    // Always fragment by exon: each visible exon contributes a segment with
    // its own piecewise screen-x bounds. Tracks that want a joined visual
    // (Pfam, IPR) draw a linker across the inter-exon gap themselves.
    for (let k = 0; k < exonHits.length; k++) {
      const hit = exonHits[k]!;
      const seg = this.cdsRangeToSegment(hit.cdsLo, hit.cdsHi, hit.idx);
      if (seg) segments.push(seg);
      if (k > 0) {
        droppedIntronicCount += 1;
        droppedRanges.push({ kind: 'intronic', near: { exonIdx: hit.idx } });
      }
    }

    if (exonHits.length === 0) {
      droppedExonicCount += 1;
      droppedRanges.push({ kind: 'out-of-bounds' });
    }

    return { segments, droppedIntronicCount, droppedExonicCount, droppedRanges };
  }

  private projectExonic(cdsLo: number, cdsHi: number): RangeProjection {
    const exons = this.mapper.transcript.exons;

    const segments: RangeSegment[] = [];
    const droppedRanges: DroppedRange[] = [];

    const hits: Array<{ idx: number; lo: number; hi: number }> = [];
    for (let i = 0; i < exons.length; i++) {
      const e = exons[i]!;
      const overlapLo = Math.max(cdsLo, e.cdsStart);
      const overlapHi = Math.min(cdsHi, e.cdsEnd);
      if (overlapLo > overlapHi) continue;
      hits.push({ idx: i, lo: overlapLo, hi: overlapHi });
    }

    if (hits.length === 0) {
      return {
        segments,
        droppedIntronicCount: 0,
        droppedExonicCount: 1,
        droppedRanges: [{ kind: 'out-of-bounds' }],
      };
    }

    // Always fragment by exon: one segment per visible exon, each with its
    // own piecewise screen-x bounds. In cds-with-introns mode the segments'
    // x-bounds sit either side of a collapsed-intron gap; tracks that want
    // a joined visual draw a linker themselves.
    for (const h of hits) {
      const seg = this.cdsRangeToSegment(h.lo, h.hi, h.idx);
      if (seg) segments.push(seg);
    }

    return {
      segments,
      droppedIntronicCount: 0,
      droppedExonicCount: 0,
      droppedRanges,
    };
  }

  private cdsRangeToSegment(cdsLo: number, cdsHi: number, exonIdx: number): RangeSegment | null {
    const xStart = this.cdsToScreen(cdsLo, 0);
    const xEnd = this.cdsToScreen(cdsHi, 0);
    if (xStart === null && xEnd === null) return null;
    if (xStart === null || xEnd === null) {
      const clampedStart = xStart ?? 0;
      const clampedEnd = xEnd ?? this._width;
      return { xStart: clampedStart, xEnd: clampedEnd, exonIdx };
    }
    return { xStart, xEnd, exonIdx };
  }

  // ---- Geometry ----------------------------------------------------------

  /**
   * Piecewise screen layout in CDS modes. Exons get pixel space proportional
   * to their visible CDS bp; consecutive visible exons are separated by a
   * collapsed-intron gap whose width scales with `intronScale` and a
   * preferred-width-capped budget.
   *
   * Recomputed on demand each call. Tracks may call multiple times per
   * render; the work is O(exons) and fine for the current scale.
   */
  cdsGeometry(): CdsGeometry {
    const [lo, hi] = this._range;
    const exons = this.mapper.transcript.exons;

    const visible: Array<{ idx: number; cdsLo: number; cdsHi: number; bp: number }> = [];
    for (let i = 0; i < exons.length; i++) {
      const e = exons[i]!;
      const cdsLo = Math.max(lo, e.cdsStart);
      const cdsHi = Math.min(hi, e.cdsEnd);
      if (cdsHi < cdsLo) continue;
      // Use interval count (not point count) so a contiguous CDS still maps
      // edge-to-edge in screen space when gapPx === 0.
      visible.push({ idx: i, cdsLo, cdsHi, bp: cdsHi - cdsLo });
    }

    const nGaps = Math.max(0, visible.length - 1);
    const gapBudget = this._width * GAP_BUDGET_FRACTION;
    const naturalGapPx = nGaps > 0
      ? Math.max(MIN_GAP_PX, Math.min(PREF_GAP_PX, gapBudget / nGaps))
      : 0;
    const gapPx = naturalGapPx * this._intronScale;

    const totalBp = visible.reduce((s, v) => s + v.bp, 0);
    const exonPx = Math.max(0, this._width - nGaps * gapPx);
    const pxPerBp = totalBp > 0 ? exonPx / totalBp : 0;

    const segments: ExonScreenSegment[] = [];
    let x = 0;
    for (let k = 0; k < visible.length; k++) {
      const v = visible[k]!;
      const xStart = x;
      const xEnd = xStart + v.bp * pxPerBp;
      segments.push({ exonIdx: v.idx, cdsLo: v.cdsLo, cdsHi: v.cdsHi, xStart, xEnd });
      x = xEnd;
      if (k < visible.length - 1) x += gapPx;
    }
    return { segments, pxPerBp, gapPx };
  }

  // ---- Anchors -----------------------------------------------------------

  resolveAnchor(target: AnchorTarget): ScreenPoint | null {
    switch (target.kind) {
      case 'cds-pos': {
        const x = this.cdsToScreen(target.cPos, target.offset ?? 0);
        return x === null ? null : { x, y: 0 };
      }
      case 'protein-aa': {
        const x = this.proteinToScreen(target.aa);
        return x === null ? null : { x, y: 0 };
      }
      case 'genomic-pos': {
        const x = this.genomicToScreen(target.chr, target.pos);
        return x === null ? null : { x, y: 0 };
      }
      case 'intron-boundary': {
        const exon = this.mapper.transcript.exons[target.exonIdx];
        if (!exon) return null;
        const cPos = target.side === 'donor' ? exon.cdsEnd : exon.cdsStart;
        const x = this.cdsToScreen(cPos, 0);
        return x === null ? null : { x, y: 0 };
      }
      case 'feature':
        return null;
    }
  }
}

function clampOrdered(a: number, b: number): [number, number] {
  return a <= b ? [a, b] : [b, a];
}

function now(): number {
  // performance.now() is monotonic and present in JSDOM + browsers; fall back
  // to Date.now() in the unlikely case it isn't.
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/** Polynomial approximation of cubic-bezier(0.22, 1, 0.36, 1) — the ease-out-
 *  quart curve used for programmatic viewport transitions per design §8. */
function easeOutQuart(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u * u;
}

function exonicToCds(exon: { cdsStart: number; genomicStart: number; genomicEnd: number }, pos: number, strand: '+' | '-'): number {
  return strand === '+'
    ? exon.cdsStart + (pos - exon.genomicStart)
    : exon.cdsStart + (exon.genomicEnd - pos);
}

function cdsToScreenViaGeometry(geom: CdsGeometry, cPos: number): number | null {
  for (const seg of geom.segments) {
    if (cPos >= seg.cdsLo && cPos <= seg.cdsHi) {
      return seg.xStart + (cPos - seg.cdsLo) * geom.pxPerBp;
    }
  }
  return null;
}

function screenToCdsViaGeometry(geom: CdsGeometry, x: number): CdsPosition | null {
  if (geom.segments.length === 0) return null;
  for (let i = 0; i < geom.segments.length; i++) {
    const seg = geom.segments[i]!;
    if (x >= seg.xStart && x <= seg.xEnd) {
      const bp = (x - seg.xStart) / Math.max(geom.pxPerBp, Number.EPSILON);
      const cPos = Math.round(seg.cdsLo + bp);
      return { cPos, offset: 0 };
    }
    // Snap onto the nearest exon edge when the point lands in an intron gap.
    const next = geom.segments[i + 1];
    if (next && x > seg.xEnd && x < next.xStart) {
      // Round to whichever edge is closer (mirrors lit-manager's deep-intron
      // centre-pin: between flanks, the user clicked nothing in particular).
      return x - seg.xEnd <= next.xStart - x
        ? { cPos: seg.cdsHi, offset: 0 }
        : { cPos: next.cdsLo, offset: 0 };
    }
  }
  return null;
}
