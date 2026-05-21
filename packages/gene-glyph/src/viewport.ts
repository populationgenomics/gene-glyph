import { createStormDetector } from './debug-leash.js';
import { ProjectionFrame } from './projection-frame.js';
import type {
  AnchorTarget,
  BaselineGeometry,
  CdsPosition,
  CollapsedRegion,
  CoordinateMapper,
  DroppedRange,
  Exon,
  ExonBaseline,
  FlankBaseline,
  GapBaseline,
  GenomicPosition,
  Position,
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
  /** Phase 3 soft-collapse spec — drives per-intron flank widths in
   *  `genome` mode. `[]` (empty) leaves every intron fully linear at the
   *  baseline `pxPerBp` (the "raw genome" view); `undefined` lets the
   *  controller fall back to no-spec behaviour (each intron is one
   *  fixed-budget segment, matching pre-Phase-3 layout). */
  collapsedRegions?: readonly CollapsedRegion[];
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
  return mode === 'genome' ? 1 : 0;
}

export class ViewportController implements Viewport {
  private _mode: ViewMode;
  /** Canonical viewport state: the visible window in *baseline* (display)
   *  coordinates. Stored as `[S_lo, S_hi]` in fit-gene baseline pixels.
   *  The figure renders this slice of the baseline to current-x [0, width].
   *
   *  Pan operates directly on this state — shifting both ends by the same
   *  baseline-x delta — so the visible span (and therefore zoom) is
   *  invariant by construction, and the round-trip through the ruler that
   *  used to lose information at fixed-budget gap boundaries is gone.
   *  Ruler positions are computed via `range` when needed for display or
   *  for the public API. */
  private _baselineWindow: [number, number];
  /** Cached ruler view of `_baselineWindow`. Recomputed whenever the
   *  baseline window changes; consumers of `range` get the snapped-to-
   *  cell-boundary ruler equivalent, which is exact when both endpoints
   *  sit in exonic regions and snaps to the nearest exon boundary when an
   *  endpoint sits inside a fixed-budget gap. */
  private _rangeCache: [number, number] | null = null;
  private _width: number;
  private _intronScale: number;
  private _attached: CssTarget | null = null;
  private _baseline: BaselineGeometry | null = null;
  private _baselineKey: string | null = null;
  private _frame: ProjectionFrame | null = null;
  private _collapsedRegions: readonly CollapsedRegion[];
  private _publishStorm = createStormDetector('ViewportController.publish');
  private _listeners = new Set<() => void>();
  readonly mapper: CoordinateMapper;

  constructor(init: ViewportControllerInit) {
    this.mapper = init.mapper;
    this._mode = init.mode ?? 'genome';
    this._width = init.width;
    this._intronScale = init.intronScale ?? defaultIntronScale(this._mode);
    this._collapsedRegions = init.collapsedRegions ?? [];
    // Eagerly compute the canonical baseline window from the seed ruler
    // range. Doing this in the constructor (rather than lazily) avoids
    // a circular dependency: the lazy frame() needs `_baselineWindow`,
    // and the lazy ruler→baseline conversion needs frame().
    const seedRange = init.range ?? defaultRangeFor(this._mode, this.mapper);
    this._baselineWindow = this.rulerRangeToBaselineWindow(seedRange);
  }

  /** Convert a ruler range to its baseline-window equivalent, using a
   *  throwaway frame so we don't rely on `_baselineWindow` (which may not
   *  exist yet during construction / reseat). The throwaway frame's
   *  ruler→baseline math depends only on segments, not on a window. */
  private rulerRangeToBaselineWindow(
    range: readonly [number, number],
  ): [number, number] {
    const baseline = this.baselineGeometry();
    const tmp = new ProjectionFrame({
      baseline,
      baselineWindow: [0, baseline.totalWidth],
      width: this._width,
      mode: this._mode,
      exons: this.mapper.transcript.exons,
    });
    return [
      tmp.rulerToBaselineX(range[0] - 0.5),
      tmp.rulerToBaselineX(range[1] + 0.5),
    ];
  }

  // ---- Read-only state ---------------------------------------------------

  get mode(): ViewMode {
    return this._mode;
  }

  get intronScale(): number {
    return this._intronScale;
  }

  /** Visible ruler range (CDS bp / aa). Derived from `_baselineWindow`.
   *  Round-trip-exact with `setRange` for ranges whose endpoints fall in
   *  exonic regions; snaps to the nearest cell boundary when an endpoint
   *  falls inside a fixed-budget gap (where the synthetic ruler has zero
   *  span and the inverse is ambiguous). */
  get range(): readonly [number, number] {
    if (this._rangeCache) return this._rangeCache;
    const [sLo, sHi] = this.baselineWindow();
    this._rangeCache = [
      this.baselineXToRuler(sLo) + 0.5,
      this.baselineXToRuler(sHi) - 0.5,
    ];
    return this._rangeCache;
  }

  /** Visible baseline window `[S_lo, S_hi]` in fit-gene display pixels.
   *  This is the canonical viewport state — `range` is derived from it. */
  baselineWindow(): readonly [number, number] {
    return this._baselineWindow;
  }

  get width(): number {
    return this._width;
  }

  // ---- Mutators ----------------------------------------------------------

  setMode(mode: ViewMode): void {
    if (mode === this._mode) return;
    const prevMode = this._mode;
    // Convert the current visible window via the ruler so the BIOLOGICAL
    // window is preserved across the mode switch. Baseline geometry
    // differs across modes, so we go through ruler as an intermediate.
    const prevRange = this.range;
    const newRange = reprojectRange(prevRange, prevMode, mode, this.mapper);
    this._mode = mode;
    this._intronScale = defaultIntronScale(mode);
    this.invalidateBaseline();
    this._rangeCache = null;
    // Re-seed the canonical baseline window in the NEW mode's geometry.
    this._baselineWindow = this.rulerRangeToBaselineWindow(newRange);
    this.publish();
    this.notify();
  }

  setRange(range: readonly [number, number]): void {
    const current = this.range;
    if (current[0] === range[0] && current[1] === range[1]) return;
    // Convert the supplied ruler range into the canonical baseline window.
    // Also cache the input range verbatim so `range` returns the exact
    // value the caller passed in — the rulerToBaselineX → baselineXToRuler
    // round-trip is mathematically identity inside exons but has tiny
    // floating-point drift that breaks controlled-prop equality.
    this._baselineWindow = this.rulerRangeToBaselineWindow(range);
    this._rangeCache = [range[0], range[1]];
    this._frame = null;
    this.publish();
    this.notify();
  }

  /** Direct baseline-window setter — bypasses the ruler round-trip so pan
   *  gestures don't lose information at fixed-budget gap boundaries. The
   *  `_rangeCache` is invalidated; subsequent `range` reads derive the
   *  ruler equivalent from the new window. */
  setBaselineWindow(window: readonly [number, number]): void {
    const current = this.baselineWindow();
    if (current[0] === window[0] && current[1] === window[1]) return;
    this._baselineWindow = [window[0], window[1]];
    this._rangeCache = null;
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

  /** Same as {@link clampRange}, but operating directly on baseline (display)
   *  coordinates. Pan and zoom in `use-viewport-interactions` use this so the
   *  clamp doesn't round-trip through the ruler — which would lose information
   *  at fixed-budget gap boundaries where the synthetic ruler has zero span.
   *
   *  Padded bounds are sized to match {@link paddedBounds} in ruler-space
   *  (5% of natural ruler length on each side), translated through the
   *  segment walk so the clamp boundary lines up with the same biological
   *  position the ruler-space clamp would pick. */
  clampBaselineWindow(
    window: readonly [number, number],
    opts: { minZoom?: number; maxZoom: number },
  ): [number, number] {
    const [pLoRuler, pHiRuler] = this.paddedBounds();
    const naturalSpan = this.baselineGeometry().totalWidth;
    const pLo = this.cdsToBaselineX(pLoRuler - 0.5);
    const pHi = this.cdsToBaselineX(pHiRuler + 0.5);
    const minLen = Math.max(1, naturalSpan / opts.maxZoom);
    const maxLen =
      opts.minZoom && opts.minZoom > 0
        ? Math.min(pHi - pLo, naturalSpan / opts.minZoom)
        : pHi - pLo;

    let [lo, hi] = window[0] <= window[1] ? [window[0], window[1]] : [window[1], window[0]];
    const len = Math.max(minLen, Math.min(maxLen, hi - lo));
    const centre = (lo + hi) / 2;
    lo = centre - len / 2;
    hi = centre + len / 2;

    if (len >= pHi - pLo) {
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
    // Baseline geometry depends on width, so the canonical baseline
    // window must be recomputed in the new baseline's units. Preserve
    // the visible RULER range across the width change.
    const prevRange = this.range;
    this._width = width;
    this.invalidateBaseline();
    this._rangeCache = null;
    this._baselineWindow = this.rulerRangeToBaselineWindow(prevRange);
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
      baselineWindow: this.baselineWindow(),
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

    // Resolve per-intron flank widths from the soft-collapse spec. In
    // genome mode each spec'd intron contributes a donor + acceptor
    // flank (bp count from the region's intronic offsets) which take
    // their own linear-scale baseline pixels; the bulk between them
    // takes the fixed-budget `naturalGapPx`. Introns not covered by
    // the spec keep the legacy single-gap shape (one fixed-budget
    // segment, no flanks). In transcript mode the spec is subsumed by
    // hard collapse, so flank widths fall back to 0.
    const flankWidths =
      this._mode === 'genome'
        ? this.resolveFlankWidths()
        : new Array<{ donorBp: number; acceptorBp: number }>(nGaps).fill({
            donorBp: 0,
            acceptorBp: 0,
          });

    // Cell-width invariant: each CDS bp occupies a cell of width
    // `pxPerBp`; bp N spans `[(N - cdsStart) * pxPerBp + exon.xStart,
    // (N - cdsStart + 1) * pxPerBp + exon.xStart]` inside its host
    // exon, with its centre at the half-step. The bp count in each
    // exon body is therefore `cdsEnd - cdsStart + 1`. Flank bp inside
    // genome-mode splice-site zones use the same `pxPerBp` (so an
    // intronic c.N+M bp tiles cell-for-cell with the adjacent exonic
    // bp). Transcript mode collapses each intron to a zero-width
    // junction — the boundary between the last cell of exon i and the
    // first cell of exon i+1 is a single x-coordinate.
    let linearBp = 0;
    for (const e of exons) linearBp += e.cdsEnd - e.cdsStart + 1;
    let fixedBudgetPx = 0;
    let nLegacyGaps = 0; // introns with no flanks → legacy gap shape
    for (const fw of flankWidths) {
      linearBp += fw.donorBp + fw.acceptorBp;
      if (fw.donorBp > 0 || fw.acceptorBp > 0) {
        fixedBudgetPx += naturalGapPx; // bulk for this spec'd intron
      } else {
        nLegacyGaps += 1;
      }
    }

    let pxPerBp: number;
    let transitionPx: number;
    if (this._mode === 'genome') {
      // Legacy (un-spec'd) gaps also consume the fixed-budget pool so
      // a pre-Phase-3-style empty spec degenerates to the historical
      // layout shape (fixed-budget bulk between exons).
      const totalFixed = fixedBudgetPx + nLegacyGaps * naturalGapPx;
      const linearPx = Math.max(0, this._width - totalFixed);
      pxPerBp = linearBp > 0 ? linearPx / linearBp : 0;
      transitionPx = naturalGapPx;
    } else {
      // Transcript mode: zero-width junction between exons. Consecutive
      // bp cells tile [0, width] with no symbolic intron pixel.
      pxPerBp = linearBp > 0 ? this._width / linearBp : 0;
      transitionPx = 0;
    }

    const exonRects: ExonBaseline[] = [];
    const gapRects: GapBaseline[] = [];
    const flankRects: FlankBaseline[] = [];
    let x = 0;
    for (let i = 0; i < exons.length; i++) {
      const e = exons[i]!;
      const bpCount = e.cdsEnd - e.cdsStart + 1;
      const xStart = x;
      const xEnd = xStart + bpCount * pxPerBp;
      exonRects.push({ exonIdx: i, xStart, xEnd, width: xEnd - xStart });
      x = xEnd;
      if (i < exons.length - 1) {
        const fw = flankWidths[i] ?? { donorBp: 0, acceptorBp: 0 };
        const hasFlanks = fw.donorBp > 0 || fw.acceptorBp > 0;
        if (hasFlanks && this._mode === 'genome') {
          // Phase 3: the gap spans the WHOLE intron in baseline-x, with
          // the donor/acceptor flanks stored separately so per-segment
          // layout can apply linear scale to them while leaving the
          // central bulk (transitionPx) at its fixed pixel budget. Each
          // flank's bp count translates to a cell-width allotment at
          // the shared `pxPerBp` so intronic bp cells tile with exonic
          // ones across the boundary.
          const donorWidth = fw.donorBp * pxPerBp;
          const acceptorWidth = fw.acceptorBp * pxPerBp;
          const gapXStart = x;
          if (fw.donorBp > 0) {
            flankRects.push({
              intronIdx: i,
              side: 'donor',
              bp: fw.donorBp,
              xStart: x,
              xEnd: x + donorWidth,
              width: donorWidth,
            });
          }
          x += donorWidth + transitionPx;
          if (fw.acceptorBp > 0) {
            flankRects.push({
              intronIdx: i,
              side: 'acceptor',
              bp: fw.acceptorBp,
              xStart: x,
              xEnd: x + acceptorWidth,
              width: acceptorWidth,
            });
          }
          x += acceptorWidth;
          gapRects.push({
            exonIdxA: i,
            exonIdxB: i + 1,
            xStart: gapXStart,
            xEnd: x,
            width: x - gapXStart,
            scaleRule: 'fixed-budget',
          });
        } else if (this._mode === 'genome') {
          gapRects.push({
            exonIdxA: i,
            exonIdxB: i + 1,
            xStart: x,
            xEnd: x + transitionPx,
            width: transitionPx,
            scaleRule: 'fixed-budget',
          });
          x += transitionPx;
        } else {
          // Transcript mode: zero-width junction. Adjacent exons share
          // their boundary at a single x-coordinate.
          gapRects.push({
            exonIdxA: i,
            exonIdxB: i + 1,
            xStart: x,
            xEnd: x,
            width: 0,
            scaleRule: 'linear',
          });
        }
      }
    }
    snapRightEdge(exonRects, this._width);

    return {
      exons: exonRects,
      gaps: gapRects,
      flanks: flankRects,
      pxPerBp,
      gapPx: this._mode === 'genome' ? naturalGapPx : 0,
      totalWidth: this._width,
    };
  }

  /** Resolve per-intron flank widths from the active soft-collapse spec.
   *  A region anchored on `upstream.cdsEnd` with positive offset is
   *  treated as the start of the bulk; the donor flank covers the bp
   *  between the exon's 3' end and the bulk start (i.e., the first
   *  `start.offset - 1` intronic bp). Likewise for the acceptor flank
   *  on the downstream-exon side. Introns with no matching region
   *  fall back to the legacy "single fixed-budget gap, no flanks"
   *  layout via the caller's `nLegacyGaps` counter. */
  private resolveFlankWidths(): Array<{ donorBp: number; acceptorBp: number }> {
    const exons = this.mapper.transcript.exons;
    const result: Array<{ donorBp: number; acceptorBp: number }> = [];
    for (let i = 0; i < exons.length - 1; i++) {
      const upstream = exons[i]!;
      const downstream = exons[i + 1]!;
      let donorBp = 0;
      let acceptorBp = 0;
      for (const region of this._collapsedRegions) {
        if (
          region.start.cPos === upstream.cdsEnd &&
          region.start.offset > 0
        ) {
          donorBp = Math.max(donorBp, region.start.offset - 1);
        }
        if (
          region.end.cPos === downstream.cdsStart &&
          region.end.offset < 0
        ) {
          acceptorBp = Math.max(acceptorBp, -region.end.offset - 1);
        }
      }
      result.push({ donorBp, acceptorBp });
    }
    return result;
  }

  private computeProteinBaseline(exons: readonly Exon[]): BaselineGeometry {
    // Cell-width invariant (matched in CDS modes below): each residue
    // occupies a cell of width `pxPerAa`. Aa N spans `[(N-1)*pxPerAa,
    // N*pxPerAa]` with its centre at `(N - 0.5) * pxPerAa`; aa 1's left
    // edge lands at x=0 and the last residue's right edge at x=width.
    // Total width = aaLen * pxPerAa.
    //
    // Codon-spanning exon boundaries: the upstream exon ends cleanly on
    // its last whole codon. When `aaEnds[i] == aaStarts[i+1]` (codon
    // straddles), the shared codon is assigned to the upstream exon and
    // the downstream exon starts at the next aa. When there's a gap
    // (`aaEnds[i] + 1 < aaStarts[i+1]`), the upstream exon's aaEnd is
    // snapped UP so the two exon rects sit directly adjacent.
    const aaLen = Math.floor(this.mapper.transcript.cdsLength / 3);
    const pxPerAa = aaLen > 0 ? this._width / aaLen : 0;

    const aaStarts: number[] = [];
    const aaEnds: number[] = [];
    for (let i = 0; i < exons.length; i++) {
      const e = exons[i]!;
      aaStarts.push(this.mapper.cdsToProtein(e.cdsStart) ?? 1);
      const rawEnd = this.mapper.cdsToProtein(e.cdsEnd) ?? aaStarts[i]!;
      // Clamp to aaLen so a trailing partial codon (when cdsLength isn't
      // a multiple of 3) doesn't push the last exon past `width`.
      aaEnds.push(Math.min(rawEnd, aaLen > 0 ? aaLen : rawEnd));
    }
    for (let i = 0; i < exons.length - 1; i++) {
      if (aaEnds[i]! + 1 < aaStarts[i + 1]!) {
        // Clean codon boundary with a gap (upstream ends on aa N, downstream
        // starts on aa N+2). Snap upstream up so the rects tile.
        aaEnds[i] = aaStarts[i + 1]! - 1;
      } else if (aaEnds[i]! >= aaStarts[i + 1]!) {
        // Codon-spanning boundary — the shared aa's codon's first bp is in
        // the upstream exon, so upstream owns the cell; downstream skips
        // that aa. Variant placement keys exon ownership off the cell's
        // baseline-x rather than the bp position (see `placeVariant`),
        // so a CDS-coord variant on a downstream bp of a spanning codon
        // still anchors to the cell-owner.
        aaStarts[i + 1] = aaEnds[i]! + 1;
      }
    }

    const exonRects: ExonBaseline[] = [];
    const gapRects: GapBaseline[] = [];
    for (let i = 0; i < exons.length; i++) {
      const xStart = (aaStarts[i]! - 1) * pxPerAa;
      const xEnd = aaEnds[i]! * pxPerAa;
      exonRects.push({ exonIdx: i, xStart, xEnd, width: xEnd - xStart });
      if (i < exons.length - 1) {
        // Zero-width "gap" in protein mode — consecutive exons tile
        // cell-for-cell, so the boundary is a single x-coordinate. Tracks
        // that draw gap decorations skip these zero entries (gapPx === 0).
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

    // Per-gap current-x is the bulk's screen position. In Phase 3 the
    // gap covers the whole intron in baseline-x (donor flank + bulk +
    // acceptor flank), but the intron-decoration `<g>` should sit on
    // the bulk only — the polyline, soft-collapse marks, etc. all
    // belong inside the compressed region, with the flanks living
    // inside the adjacent exon groups (rendered separately by
    // exon-track). Lookup flanks-by-intron so we can offset the
    // publication into the bulk.
    const flanksByIntron = new Map<number, { donor: number; acceptor: number }>();
    for (const flank of geom.flanks ?? []) {
      const cur = flanksByIntron.get(flank.intronIdx) ?? { donor: 0, acceptor: 0 };
      if (flank.side === 'donor') cur.donor = flank.width;
      else cur.acceptor = flank.width;
      flanksByIntron.set(flank.intronIdx, cur);
    }
    for (const gap of geom.gaps) {
      const flanks = flanksByIntron.get(gap.exonIdxA) ?? { donor: 0, acceptor: 0 };
      const bulkBaselineStart = gap.xStart + flanks.donor;
      const bulkBaselineWidth = Math.max(
        0,
        gap.width - flanks.donor - flanks.acceptor,
      );
      const gapCurrentX = frame.baselineToCurrent(bulkBaselineStart) ?? 0;
      s.setProperty(`--vv-intron-x-${gap.exonIdxA}`, `${gapCurrentX}px`);
      // intron scale-x = intronScale (not multiplied by zoom): the inter-exon
      // `<g>` carries the polyline at baseline gap width; in transcript or
      // protein modes intronScale = 0 collapses it to zero.
      s.setProperty(
        `--vv-intron-scale-x-${gap.exonIdxA}`,
        this._intronScale.toString(),
      );
      s.setProperty(`--vv-intron-w-${gap.exonIdxA}`, `${bulkBaselineWidth}px`);
    }
  }

  /** Zoom scalar relative to fit-gene. >1 = zoomed in. */
  zoom(): number {
    const naturalSpan = defaultRangeFor(this._mode, this.mapper);
    const naturalLen = naturalSpan[1] - naturalSpan[0];
    const [lo, hi] = this.range;
    const currentLen = hi - lo;
    return currentLen > 0 ? naturalLen / currentLen : 1;
  }

  // ---- Point projection --------------------------------------------------

  /**
   * Project a {@link Position} (any coord system) onto fit-gene baseline-x.
   * Single entry point — the mode-dependent ruler conversion happens once
   * here instead of at every callsite. Returns `null` for unplaceable
   * coords: intronic CDS positions (`offset !== 0`), genomic positions
   * off the transcript, and protein positions whose codon is outside the
   * CDS.
   */
  toBaselineX(pos: Position): number | null {
    switch (pos.kind) {
      case 'cds': {
        if (pos.offset !== 0) return null;
        // The frame's ruler is mode-dependent (CDS bp in CDS modes, aa
        // in protein mode). Convert once at the boundary so callers
        // never need a `(mode, coordSystem)` branch.
        if (this._mode === 'protein') {
          const aa = this.mapper.cdsToProtein(pos.cPos);
          if (aa === null) return null;
          return this.cdsToBaselineX(aa);
        }
        return this.cdsToBaselineX(pos.cPos);
      }
      case 'protein': {
        if (this._mode === 'protein') return this.cdsToBaselineX(pos.aa);
        // CDS modes: route through resolveCds so a protein coord lands
        // at the codon's centre bp (3N-1), the same anchor the aa-track
        // letter uses. proteinToCds — which returns the codon's first bp
        // (3N-2) — is the wrong choice here; it's the lo-bound of a
        // range, not a single-position anchor.
        const cds = this.mapper.resolveCds(pos);
        if (!cds) return null;
        return this.cdsToBaselineX(cds.cPos);
      }
      case 'genomic': {
        const cds = this.mapper.genomicToCds(pos.chr, pos.pos);
        if (!cds) return null;
        return this.toBaselineX({ kind: 'cds', cPos: cds.cPos, offset: cds.offset });
      }
    }
  }

  /** Project a {@link Position} onto current screen-x. Composes
   *  {@link toBaselineX} with the live zoom-and-clip mapping. */
  toScreen(pos: Position): number | null {
    const baselineX = this.toBaselineX(pos);
    if (baselineX === null) return null;
    return this.applyZoomClamped(baselineX);
  }

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
    // Codon centre — see the `case 'protein'` branch of toBaselineX.
    const cds = this.mapper.resolveCds({ kind: 'protein', aa });
    if (!cds) return null;
    return this.cdsToScreen(cds.cPos, cds.offset);
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

  /** Public view of the live exon-content scale — the screen width that 1
   *  baseline-px of exon takes at the current zoom. See the docstring on
   *  `Viewport.exonScale` for the contract. */
  exonScale(): number {
    return this.frame().exonLayout().exonScale;
  }

  /**
   * Inverse of {@link toScreen}: project a current screen-x back into a
   * {@link Position} of the requested coord system. Returns `null` when
   * `x` falls outside the visible range or the resulting position can't
   * be expressed in the requested kind (e.g., genomic coords for a gap
   * position with no transcript-bp it corresponds to).
   *
   * Round-trip property: `screenToPosition(toScreen(p)!, p.kind)` recovers
   * `p` up to the active mode's precision (sub-codon detail is lost in
   * protein mode for `kind: 'cds'`, since three CDS bp share one aa).
   * The forward and inverse paths share the same ruler conversion, so
   * the two directions can't diverge.
   */
  screenToPosition<K extends 'cds' | 'protein' | 'genomic'>(
    x: number,
    kind: K,
  ): Extract<Position, { kind: K }> | null {
    if (x < 0 || x > this._width) return null;
    const ruler = Math.round(this.screenToRulerBaseline(x));
    // In protein mode, `ruler` is an aa index; the canonical CDS bp for
    // aa N is the codon centre (bp 3N-1), so `{kind:'cds'}` and
    // `{kind:'genomic'}` inversions of a protein-mode click both land
    // on the middle bp rather than the first. Keeps the round-trip with
    // toScreen({kind:'protein', aa:N}) consistent.
    const aaToCenterCds = (aa: number) => (aa - 1) * 3 + 2;
    switch (kind) {
      case 'cds': {
        const cPos = this._mode === 'protein' ? aaToCenterCds(ruler) : ruler;
        return { kind: 'cds', cPos, offset: 0 } as Extract<Position, { kind: K }>;
      }
      case 'protein': {
        const aa = this._mode === 'protein' ? ruler : this.mapper.cdsToProtein(ruler);
        if (aa === null) return null;
        return { kind: 'protein', aa } as Extract<Position, { kind: K }>;
      }
      case 'genomic': {
        const cPos = this._mode === 'protein' ? aaToCenterCds(ruler) : ruler;
        const g = this.mapper.cdsToGenomic(cPos, 0);
        if (!g) return null;
        return { kind: 'genomic', chr: g.chr, pos: g.pos } as Extract<Position, { kind: K }>;
      }
    }
    // Exhaustive switch above; this is unreachable but TS doesn't infer that
    // for a generic parameter.
    return null;
  }

  screenToCds(x: number): CdsPosition | null {
    const pos = this.screenToPosition(x, 'cds');
    return pos === null ? null : { cPos: pos.cPos, offset: pos.offset };
  }

  screenToProtein(x: number): number | null {
    const pos = this.screenToPosition(x, 'protein');
    return pos === null ? null : pos.aa;
  }

  screenToGenomic(x: number): GenomicPosition | null {
    const pos = this.screenToPosition(x, 'genomic');
    return pos === null ? null : { chr: pos.chr, pos: pos.pos };
  }

  /** Ruler coordinate (CDS bp in CDS modes, aa in protein mode) at the given
   *  screen x. Used as the anchor for cursor-anchored zoom. */
  rulerAtScreen(x: number): number | null {
    if (x < 0 || x > this._width) return null;
    return this.screenToRulerBaseline(x);
  }

  private screenToRulerBaseline(x: number): number {
    const baselineX = this.frame().currentToBaseline(x);
    if (baselineX === null) return this.range[0];
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

    // CDS / protein ranges are contiguous in their own ruler, but each
    // consecutive exon pair the range touches is separated on screen by an
    // intron decoration. Reporting one intronic drop per crossed gap mirrors
    // projectGenomicRange so tracks can aggregate hidden-feature counts
    // uniformly regardless of coord system. (Protein-mode tiling across
    // exon boundaries is handled inside `cdsRangeToBaselineSegment` via
    // the per-exon clamp — no special-case here.)
    for (let k = 0; k < hits.length; k++) {
      const h = hits[k]!;
      const seg = this.cdsRangeToBaselineSegment(h.lo, h.hi, h.idx);
      if (seg) segments.push(seg);
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
    // Cell-width invariant: the projected range spans from bp cdsLo's
    // LEFT cell edge to bp cdsHi's RIGHT cell edge. Using `cPos - 0.5`
    // / `cPos + 0.5` as the ruler positions lets the segment walk's
    // linear interpolation land on cell edges (each exon segment's
    // ruler spans [cdsStart - 0.5, cdsEnd + 0.5]). In protein mode the
    // ruler is aa, so we convert bp → aa first and bracket aa cells.
    //
    // At exon boundaries, the upstream exon's rulerEnd and the
    // downstream exon's rulerStart share the same ruler value, and the
    // walk picks upstream (first match wins). In transcript mode that's
    // harmless because the junction is zero-width, but in genome mode
    // upstream's xEnd sits 24+ px to the left of downstream's xStart.
    // Anchor each end to the exon's own baseline rect when the clipped
    // range reaches the exon's own boundary.
    const eb = this.baselineGeometry().exons[exonIdx];
    const exon = this.mapper.transcript.exons[exonIdx];
    if (!eb || !exon) return null;
    let xStart: number;
    let xEnd: number;
    if (this._mode === 'protein') {
      const aaLo = this.mapper.cdsToProtein(cdsLo);
      const aaHi = this.mapper.cdsToProtein(cdsHi);
      if (aaLo === null || aaHi === null) return null;
      xStart = this.cdsToBaselineX(aaLo - 0.5);
      xEnd = this.cdsToBaselineX(aaHi + 0.5);
      // A codon-spanning aa cell is owned by upstream per the snap; the
      // downstream exon's range projection clips to its own baseline rect
      // so the upstream-owned half of a boundary aa doesn't bleed into
      // the downstream segment.
      xStart = Math.max(xStart, eb.xStart);
      xEnd = Math.min(xEnd, eb.xEnd);
      if (xEnd <= xStart) return null;
    } else {
      xStart = cdsLo === exon.cdsStart ? eb.xStart : this.cdsToBaselineX(cdsLo - 0.5);
      xEnd = cdsHi === exon.cdsEnd ? eb.xEnd : this.cdsToBaselineX(cdsHi + 0.5);
    }
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
    const [lo, hi] = this.range;
    const [S_lo] = this.baselineWindow();
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
