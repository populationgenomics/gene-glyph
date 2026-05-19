import { createStormDetector } from './debug-leash.js';
import { ProjectionFrame } from './projection-frame.js';
import type {
  AnchorTarget,
  BaselineGeometry,
  CdsPosition,
  CoordinateMapper,
  DroppedRange,
  Exon,
  ExonBaseline,
  GapBaseline,
  GenomicPosition,
  RangeProjection,
  RangeSegment,
  ScreenPoint,
  ViewMode,
  Viewport,
} from './types.js';

export type { BaselineGeometry, ExonBaseline, GapBaseline } from './types.js';

export interface ViewportControllerInit {
  mapper: CoordinateMapper;
  width: number;
  mode?: ViewMode;
  range?: readonly [number, number];
  intronScale?: number;
}

/** Fraction of the natural range used as soft padding for pan clamping
 *  (design §7: "pan clamps hard to gene bounds + ~5% padding"). The same
 *  padding governs the most zoomed-out state — `minZoom` defaults to the
 *  zoom that exactly fits `naturalRange + 2 × this fraction × naturalRange`. */
export const VIEWPORT_PAN_PADDING = 0.05;

/** Default upper zoom bound. ~200× the natural range covers "1 aa per 20px"
 *  on typical-width figures without over-tuning per mode; hosts can override
 *  via the `maxZoom` prop on `<GeneGlyph>`. */
export const DEFAULT_MAX_ZOOM = 200;

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
  private _baseline: BaselineGeometry | null = null;
  private _baselineKey: string | null = null;
  private _frame: ProjectionFrame | null = null;
  private _publishStorm = createStormDetector('ViewportController.publish');
  private _listeners = new Set<() => void>();
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
    if (mode === this._mode) return;
    const prevMode = this._mode;
    this._mode = mode;
    this._intronScale = defaultIntronScale(mode);
    // Preserve the visible region across the mode switch by reprojecting the
    // range endpoints through the mapper. Numeric range values differ between
    // rulers (CDS bp vs aa); the biological window the user sees should not.
    this._range = reprojectRange(this._range, prevMode, mode, this.mapper);
    this.invalidateBaseline();
    this.publish();
    this.notify();
  }

  setRange(range: readonly [number, number]): void {
    if (this._range[0] === range[0] && this._range[1] === range[1]) return;
    this._range = [range[0], range[1]];
    this._frame = null;
    this.publish();
    this.notify();
  }

  /** Subscribe to committed range / mode / width changes. Called synchronously
   *  after the relevant mutator publishes new CSS variables. Returns an
   *  unsubscribe function — pair with React's `useSyncExternalStore` (or any
   *  framework's external-store hook) to keep auxiliary chrome in step with
   *  the figure without polling. */
  subscribe(listener: () => void): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this._listeners) listener();
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

  setWidth(width: number): void {
    if (this._width === width) return;
    this._width = width;
    this.invalidateBaseline();
    this.publish();
    this.notify();
  }

  setIntronScale(scale: number): void {
    if (this._intronScale === scale) return;
    this._intronScale = scale;
    this.publish();
    this.notify();
  }

  // ---- Baseline geometry -------------------------------------------------

  /**
   * Viewport-independent geometry computed at fit-gene zoom. Each exon owns
   * a stable `(xStart, width)` here; the current viewport maps this baseline
   * onto screen-x via a uniform translate + scale. Tracks render their
   * features in this frame so React never re-issues new rect widths on pan
   * or zoom — only the wrapping `<g>` transforms change, and CSS transitions
   * those.
   *
   * Cached per (mode, width, transcript-identity).
   */
  baselineGeometry(): BaselineGeometry {
    const key = this.baselineKey();
    if (this._baseline && this._baselineKey === key) return this._baseline;
    this._baseline = this.computeBaseline();
    this._baselineKey = key;
    return this._baseline;
  }

  private baselineKey(): string {
    return `${this._mode}|${this._width}|${this.mapper.transcript.transcriptId}|${this.mapper.transcript.cdsLength}|${this.mapper.transcript.exons.length}`;
  }

  private invalidateBaseline(): void {
    this._baseline = null;
    this._baselineKey = null;
    this._frame = null;
  }

  /** Memoised projection frame for the active `(baseline, range, width, mode)`
   *  tuple. Invalidated alongside the baseline (on mode/width change) and on
   *  every `setRange`. All ruler/baseline/screen math goes through here. */
  private frame(): ProjectionFrame {
    if (this._frame) return this._frame;
    this._frame = new ProjectionFrame({
      baseline: this.baselineGeometry(),
      range: this._range,
      width: this._width,
      mode: this._mode,
      exons: this.mapper.transcript.exons,
    });
    return this._frame;
  }

  private computeBaseline(): BaselineGeometry {
    const exons = this.mapper.transcript.exons;
    const nGaps = Math.max(0, exons.length - 1);
    const gapBudget = this._width * GAP_BUDGET_FRACTION;
    const naturalGapPx = nGaps > 0
      ? Math.max(MIN_GAP_PX, Math.min(PREF_GAP_PX, gapBudget / nGaps))
      : 0;

    if (this._mode === 'protein') {
      return this.computeProteinBaseline(exons);
    }

    // CDS modes: piecewise per-exon with a visible gap (cds-with-introns) or
    // a single-bp transition interval that gets absorbed into the linear
    // pxPerBp (cds-spliced). Counting `cdsEnd - cdsStart` as the bp-within
    // each exon makes the inter-exon transition explicit; modelling it as
    // either `naturalGapPx` or `1 × pxPerBp` keeps the total = `width`.
    let sumBpWithin = 0;
    for (const e of exons) sumBpWithin += e.cdsEnd - e.cdsStart;

    let pxPerBp: number;
    let transitionPx: number;
    if (this._mode === 'cds-with-introns') {
      transitionPx = naturalGapPx;
      const exonPx = Math.max(0, this._width - nGaps * transitionPx);
      pxPerBp = sumBpWithin > 0 ? exonPx / sumBpWithin : 0;
    } else {
      const intervalBp = sumBpWithin + nGaps;
      pxPerBp = intervalBp > 0 ? this._width / intervalBp : 0;
      transitionPx = pxPerBp;
    }

    const exonRects: ExonBaseline[] = [];
    const gapRects: GapBaseline[] = [];
    let x = 0;
    for (let i = 0; i < exons.length; i++) {
      const e = exons[i]!;
      const bp = e.cdsEnd - e.cdsStart;
      const xStart = x;
      const xEnd = xStart + bp * pxPerBp;
      exonRects.push({ exonIdx: i, xStart, xEnd, width: xEnd - xStart });
      x = xEnd;
      if (i < exons.length - 1) {
        gapRects.push({
          exonIdxA: i,
          exonIdxB: i + 1,
          xStart: x,
          xEnd: x + transitionPx,
          width: transitionPx,
        });
        x += transitionPx;
      }
    }
    snapRightEdge(exonRects, this._width);

    return {
      exons: exonRects,
      gaps: gapRects,
      pxPerBp,
      gapPx: this._mode === 'cds-with-introns' ? naturalGapPx : 0,
      totalWidth: this._width,
    };
  }

  private computeProteinBaseline(exons: readonly Exon[]): BaselineGeometry {
    // Protein mode is purely linear in aa: `aa = 1` sits at `x = 0` and the
    // last residue lands at `x = width`. Per-exon rects are derived from each
    // exon's aa endpoints so tracks still get baseline xStart/width per exon
    // for CSS-variable publication.
    //
    // Adjacent exons interact one of two ways biologically:
    //   1. The codon spans the boundary — `cdsToProtein(exon_i.cdsEnd) ===
    //      cdsToProtein(exon_{i+1}.cdsStart)` — they share an aa, so their
    //      rects are naturally adjacent in the (aa - 1) * pxPerAa model.
    //   2. The codon ends cleanly on the boundary — exon_i's last aa N, exon_
    //      {i+1}'s first aa N+1. The (aa - 1) * pxPerAa model would place exon
    //      i's rect ending at (N - 1) * pxPerAa and exon i+1's starting at
    //      N * pxPerAa, leaving one residue's worth of empty space between
    //      them. That gap has no exon assignment, no biological meaning, and
    //      shows up on screen as inconsistent spacing across the gene.
    //   To kill case 2, snap each exon's aaEnd up to the next exon's aaStart
    //   so consecutive exons always meet at a single lattice point.
    const aaLen = Math.floor(this.mapper.transcript.cdsLength / 3);
    const intervals = Math.max(1, aaLen - 1);
    const pxPerAa = this._width / intervals;

    const aaStarts: number[] = [];
    const aaEnds: number[] = [];
    for (let i = 0; i < exons.length; i++) {
      const e = exons[i]!;
      aaStarts.push(this.mapper.cdsToProtein(e.cdsStart) ?? 1);
      aaEnds.push(this.mapper.cdsToProtein(e.cdsEnd) ?? aaStarts[i]!);
    }
    for (let i = 0; i < exons.length - 1; i++) {
      if (aaEnds[i]! < aaStarts[i + 1]!) {
        aaEnds[i] = aaStarts[i + 1]!;
      }
    }

    const exonRects: ExonBaseline[] = [];
    const gapRects: GapBaseline[] = [];
    for (let i = 0; i < exons.length; i++) {
      const xStart = (aaStarts[i]! - 1) * pxPerAa;
      const xEnd = (aaEnds[i]! - 1) * pxPerAa;
      exonRects.push({ exonIdx: i, xStart, xEnd, width: xEnd - xStart });
      if (i < exons.length - 1) {
        // Zero-width "gap" in protein mode — the boundary aa is the lattice
        // point shared between adjacent exons (post-snap). Tracks that draw
        // gap decorations skip these zero entries (gapPx === 0).
        gapRects.push({ exonIdxA: i, exonIdxB: i + 1, xStart: xEnd, xEnd, width: 0 });
      }
    }
    snapRightEdge(exonRects, this._width);

    return {
      exons: exonRects,
      gaps: gapRects,
      pxPerBp: pxPerAa,
      gapPx: 0,
      totalWidth: this._width,
    };
  }

  /**
   * Ruler position (CDS bp in CDS modes, aa in protein mode) → baseline
   * screen-x in fit-gene coordinates. For positions outside every exon —
   * including the padding range and intronic CDS coords that don't belong
   * to any exon — extrapolates linearly using the first / last exon's
   * baseline `pxPerBp`. Never returns null; tracks rely on this so their
   * geometry never disappears at the edges.
   */
  cdsToBaselineX(rulerPos: number): number {
    return this.frame().rulerToBaselineX(rulerPos);
  }

  /** Inverse of {@link cdsToBaselineX}. Maps a baseline screen-x back to a
   *  ruler position by locating the containing exon (or extrapolating off
   *  the ends). The return is fractional; callers round if they want a
   *  discrete CDS bp / aa value. */
  baselineXToRuler(S: number): number {
    return this.frame().baselineXToRuler(S);
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
    this._publishStorm();
    const s = this._attached.style;
    s.setProperty('--vv-zoom', this.zoom().toString());
    s.setProperty('--vv-pan-x', '0px');
    s.setProperty('--vv-intron-scale', this._intronScale.toString());

    const frame = this.frame();
    const geom = frame.baseline;

    // Exon content scales uniformly with the live zoom; inter-exon gaps DO
    // NOT — they stay at their baseline pixel width regardless of zoom level
    // so Pfam / InterPro segments in adjacent exons stay visually close at
    // high zoom (otherwise the gap visually overpowers the segment widths).
    // See `ProjectionFrame.exonLayout` / `computeExonLayout` for the math.
    const layout = frame.exonLayout();
    const exonScale = layout.exonScale;
    for (const eb of geom.exons) {
      const currentX = layout.exonCurrentX[eb.exonIdx]!;
      s.setProperty(`--vv-exon-x-${eb.exonIdx}`, `${currentX}px`);
      s.setProperty(`--vv-exon-scale-x-${eb.exonIdx}`, exonScale.toString());
      s.setProperty(`--vv-exon-w-${eb.exonIdx}`, `${eb.width}px`);
    }

    // Per-gap current-x sits at the upstream exon's `currentXEnd`; scale-x
    // folds in `intronScale` so collapsed modes (cds-spliced, protein) shrink
    // the gap-content to zero width without affecting the gap's screen
    // width — that's controlled by `exonScale` only applying to exon content.
    for (const gap of geom.gaps) {
      const aEb = geom.exons[gap.exonIdxA]!;
      const aXEnd = layout.exonCurrentX[gap.exonIdxA]! + aEb.width * exonScale;
      s.setProperty(`--vv-intron-x-${gap.exonIdxA}`, `${aXEnd}px`);
      // intron scale-x = intronScale (not multiplied by zoom): the inter-exon
      // `<g>` carries the polyline at baseline gap width; in cds-spliced or
      // protein modes intronScale = 0 collapses it to zero.
      s.setProperty(
        `--vv-intron-scale-x-${gap.exonIdxA}`,
        this._intronScale.toString(),
      );
      s.setProperty(`--vv-intron-w-${gap.exonIdxA}`, `${gap.width}px`);
    }
  }

  /** Zoom scalar relative to fit-gene. >1 = zoomed in. */
  zoom(): number {
    const naturalSpan = defaultRangeFor(this._mode, this.mapper);
    const naturalLen = naturalSpan[1] - naturalSpan[0];
    const currentLen = this._range[1] - this._range[0];
    return currentLen > 0 ? naturalLen / currentLen : 1;
  }

  // ---- Point projection --------------------------------------------------

  cdsToScreen(cPos: number, offset: number): number | null {
    if (offset !== 0) return null;
    if (this._mode === 'protein') return null;
    const baselineX = this.cdsToBaselineX(cPos);
    return this.applyZoomClamped(baselineX);
  }

  proteinToScreen(aa: number): number | null {
    if (this._mode === 'protein') {
      return this.applyZoomClamped(this.cdsToBaselineX(aa));
    }
    const cPos = this.mapper.proteinToCds(aa);
    return this.cdsToScreen(cPos, 0);
  }

  genomicToScreen(chr: string, pos: number): number | null {
    const cds = this.mapper.genomicToCds(chr, pos);
    if (!cds) return null;
    return this.cdsToScreen(cds.cPos, cds.offset);
  }

  /** Project a baseline screen-x onto the current screen, returning null if
   *  it falls outside [0, width] — preserves the "out of view → null"
   *  contract that older callers (cursor anchoring, hit testing) rely on.
   *  Uses the same fixed-gap layout as `publish()` so cursor positions /
   *  hit-tests line up with rendered pixels. */
  private applyZoomClamped(baselineX: number): number | null {
    const x = this.frame().baselineToCurrent(baselineX);
    if (x === null) return null;
    if (x < -1e-6 || x > this._width + 1e-6) return null;
    return x;
  }

  /** Public face of {@link ProjectionFrame.currentToBaseline} (Slice 26).
   *  The interface method never returns null — falls through to
   *  extrapolated baseline-x past the last exon's right edge so the overview
   *  track can mark its window even when the user has panned past the
   *  gene's 3' end into the padding zone. */
  screenToBaselineX(currentX: number): number {
    return this.frame().currentToBaseline(currentX) ?? 0;
  }

  screenToCds(x: number): CdsPosition | null {
    if (x < 0 || x > this._width) return null;
    if (this._mode === 'protein') return null;
    const ruler = this.screenToRulerBaseline(x);
    return { cPos: Math.round(ruler), offset: 0 };
  }

  screenToProtein(x: number): number | null {
    if (this._mode === 'protein') {
      if (x < 0 || x > this._width) return null;
      return Math.round(this.screenToRulerBaseline(x));
    }
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
   *  screen x. Used as the anchor for cursor-anchored zoom. */
  rulerAtScreen(x: number): number | null {
    if (x < 0 || x > this._width) return null;
    return this.screenToRulerBaseline(x);
  }

  private screenToRulerBaseline(x: number): number {
    const baselineX = this.frame().currentToBaseline(x);
    if (baselineX === null) return this._range[0];
    return this.baselineXToRuler(baselineX);
  }

  // ---- Range projection --------------------------------------------------

  /**
   * Project a CDS range onto the **baseline** (fit-gene) frame, fragmenting
   * at exon boundaries. Tracks render their feature rects against this frame
   * — widths and x attributes don't change on pan or zoom. The wrapping
   * exon-group `<g>` carries the live translate + scale.
   */
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

    for (let k = 0; k < exonHits.length; k++) {
      const hit = exonHits[k]!;
      const seg = this.cdsRangeToBaselineSegment(hit.cdsLo, hit.cdsHi, hit.idx);
      if (seg) segments.push(seg);
      if (k > 0) {
        const prev = exonHits[k - 1]!;
        droppedIntronicCount += 1;
        droppedRanges.push({
          kind: 'intronic',
          exonIdxA: prev.idx,
          exonIdxB: hit.idx,
        });
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
    let droppedIntronicCount = 0;

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

    // CDS / protein ranges are contiguous in their own ruler, but each consecutive
    // exon pair the range touches is separated on screen by an intron decoration.
    // Reporting one intronic drop per crossed gap mirrors projectGenomicRange so
    // tracks can aggregate hidden-feature counts uniformly regardless of coord
    // system.
    const proteinMode = this._mode === 'protein';
    const proteinGeom = proteinMode ? this.baselineGeometry() : null;
    for (let k = 0; k < hits.length; k++) {
      const h = hits[k]!;
      const seg = this.cdsRangeToBaselineSegment(h.lo, h.hi, h.idx);
      if (seg) {
        if (proteinMode && proteinGeom) {
          // The baseline snaps each exon's right edge up to the next exon's
          // aaStart so the exon ribbons tile without gaps; segments that
          // reach the right edge of their exon must follow the same snap or
          // they leave a one-residue hole between adjacent fragments of the
          // same domain (cdsToProtein rounds down to the last whole codon).
          // Same applies on the left edge: a segment that starts at the
          // exon's cdsStart should anchor to the previous exon's snapped
          // right edge (== this exon's xStart) so the boundary is shared.
          const exon = exons[h.idx]!;
          const eb = proteinGeom.exons[h.idx];
          if (eb) {
            if (h.hi === exon.cdsEnd && h.idx < exons.length - 1) {
              seg.xEnd = eb.xEnd;
            }
            if (h.lo === exon.cdsStart) {
              seg.xStart = eb.xStart;
            }
          }
        }
        segments.push(seg);
      }
      if (k > 0) {
        const prev = hits[k - 1]!;
        droppedIntronicCount += 1;
        droppedRanges.push({
          kind: 'intronic',
          exonIdxA: prev.idx,
          exonIdxB: h.idx,
        });
      }
    }

    return {
      segments,
      droppedIntronicCount,
      droppedExonicCount: 0,
      droppedRanges,
    };
  }

  private cdsRangeToBaselineSegment(
    cdsLo: number,
    cdsHi: number,
    exonIdx: number,
  ): RangeSegment | null {
    // `projectExonic` matches ranges against exon boundaries in CDS bp space
    // (because exon.cdsStart/cdsEnd are CDS bp). But baseline-x in protein
    // mode is linear in aa, not CDS — `cdsToBaselineX` expects aa input there
    // (see its doc comment "CDS bp in CDS modes, aa in protein mode"). Convert
    // before lookup so a CDS-coord range projected in protein mode lands at
    // the right aa positions instead of treating cPos as an aa index.
    let lo = cdsLo;
    let hi = cdsHi;
    if (this._mode === 'protein') {
      lo = this.mapper.cdsToProtein(cdsLo) ?? lo;
      hi = this.mapper.cdsToProtein(cdsHi) ?? hi;
    }
    const xStart = this.cdsToBaselineX(lo);
    const xEnd = this.cdsToBaselineX(hi);
    return { xStart, xEnd, exonIdx };
  }

  // ---- Geometry ----------------------------------------------------------

  /**
   * Live piecewise geometry derived from baseline + current range. Returns
   * the visible portion of each exon clipped to `[0, width]` for tracks that
   * still want explicit visible-segment information. New code should prefer
   * {@link baselineGeometry} + the published CSS variables.
   */
  cdsGeometry(): CdsGeometry {
    const frame = this.frame();
    const geom = frame.baseline;
    const [lo, hi] = this._range;
    const S_lo = frame.rulerToBaselineX(lo);
    const zoom = frame.zoomFactor();
    const exons = this.mapper.transcript.exons;

    const segments: ExonScreenSegment[] = [];
    for (const eb of geom.exons) {
      const xStart = (eb.xStart - S_lo) * zoom;
      const xEnd = (eb.xEnd - S_lo) * zoom;
      const visibleStart = Math.max(0, xStart);
      const visibleEnd = Math.min(this._width, xEnd);
      if (visibleEnd <= visibleStart) continue;
      const e = exons[eb.exonIdx]!;
      const cdsLo = Math.max(e.cdsStart, lo);
      const cdsHi = Math.min(e.cdsEnd, hi);
      segments.push({ exonIdx: eb.exonIdx, cdsLo, cdsHi, xStart, xEnd });
    }
    return { segments, pxPerBp: zoom * geom.pxPerBp, gapPx: zoom * geom.gapPx };
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

/** Snap the last exon's right edge to the figure width to eliminate the
 *  trailing floating-point drift from accumulated `xStart += bp * pxPerBp`
 *  steps. Without this the C-terminus / 3'-end can land at e.g.
 *  720.0000000000001 and trip the "x > width" guard in `screenToCds`. */
function snapRightEdge(exonRects: ExonBaseline[], width: number): void {
  const last = exonRects[exonRects.length - 1];
  if (!last) return;
  if (Math.abs(last.xEnd - width) < 1e-6) {
    last.xEnd = width;
    last.width = last.xEnd - last.xStart;
  }
}

function exonicToCds(exon: { cdsStart: number; genomicStart: number; genomicEnd: number }, pos: number, strand: '+' | '-'): number {
  return strand === '+'
    ? exon.cdsStart + (pos - exon.genomicStart)
    : exon.cdsStart + (exon.genomicEnd - pos);
}

/** Convert the viewport's range from one mode's ruler to another's, preserving
 *  the visible region rather than the numeric scale. CDS ↔ CDS is identity;
 *  CDS ↔ protein routes through the mapper's codon mapping. Clamped to the
 *  destination mode's natural span so a stray cdsToProtein null doesn't leak
 *  past `[1, aaLen]`. */
function reprojectRange(
  range: readonly [number, number],
  from: ViewMode,
  to: ViewMode,
  mapper: CoordinateMapper,
): [number, number] {
  const naturalTo = defaultRangeFor(to, mapper);
  if (from === to) return [range[0], range[1]];
  const isCdsFrom = from !== 'protein';
  const isCdsTo = to !== 'protein';
  if (isCdsFrom && isCdsTo) return [range[0], range[1]];
  let lo: number;
  let hi: number;
  if (isCdsFrom && !isCdsTo) {
    // CDS bp → aa: codon containing bp b is aa = floor((b-1)/3) + 1. Use the
    // codon that contains each endpoint so the visible window covers every
    // residue overlapped by the original bp range.
    lo = Math.max(1, Math.floor((range[0] - 1) / 3) + 1);
    hi = Math.max(lo, Math.floor((range[1] - 1) / 3) + 1);
  } else {
    // aa → CDS bp: first base of codon (aa-1)*3 + 1.
    lo = (range[0] - 1) * 3 + 1;
    hi = (range[1] - 1) * 3 + 3;
  }
  lo = Math.max(naturalTo[0], Math.min(naturalTo[1], lo));
  hi = Math.max(naturalTo[0], Math.min(naturalTo[1], hi));
  if (hi <= lo) return [naturalTo[0], naturalTo[1]];
  return [lo, hi];
}
