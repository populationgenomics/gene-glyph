import {
  buildSegments,
  computeSegmentLayout,
  type Segment,
  type SegmentLayout,
} from './segments.js';
import type { BaselineGeometry, ViewMode } from './types.js';

/** Per-exon CDS bp bounds used by the frame for ruler ↔ baseline mapping in
 *  CDS modes. Protein-mode projection is linear in aa and doesn't consult
 *  these. The controller passes a view over the mapper's transcript exons
 *  so the frame stays mapper-free. */
export interface FrameExon {
  readonly cdsStart: number;
  readonly cdsEnd: number;
}

/** Per-render layout derived from `(baseline, range, width, mode)`. Each
 *  exon gets a current-frame screen-x and a shared `exonScale` applied to
 *  baseline widths. Backwards-compatible view over the underlying
 *  {@link SegmentLayout}; CSS publication reads this shape unchanged. */
export interface ExonLayout {
  readonly exonScale: number;
  readonly exonCurrentX: readonly number[];
}

export interface ProjectionFrameInit {
  baseline: BaselineGeometry;
  range: readonly [number, number];
  width: number;
  mode: ViewMode;
  /** CDS bp bounds for each baseline exon, indexed by `exonIdx`. */
  exons: readonly FrameExon[];
}

/**
 * Pure value object describing the projection from ruler-space (CDS bp in
 * CDS modes, aa in protein mode) through baseline-x (fit-gene screen pixels)
 * to current screen-x for one `(baseline, range, width, mode)` tuple.
 *
 * Internally, the math walks a `Segment[]` — a single ordered sequence
 * of exonic and intron-collapsed display intervals — so the four
 * mode-aware paths (CDS bp / aa rulers, scaled-vs-fixed gap behaviour)
 * collapse to one segment walk. Holds no mapper and no mutable state
 * beyond memoised intermediates.
 */
export class ProjectionFrame {
  readonly baseline: BaselineGeometry;
  readonly range: readonly [number, number];
  readonly width: number;
  readonly mode: ViewMode;
  private readonly _segments: readonly Segment[];
  private _layout: SegmentLayout | null = null;
  private _exonLayout: ExonLayout | null = null;
  private _S_lo: number | null = null;
  private _S_hi: number | null = null;

  constructor(init: ProjectionFrameInit) {
    this.baseline = init.baseline;
    this.range = init.range;
    this.width = init.width;
    this.mode = init.mode;
    this._segments = buildSegments(init.baseline, init.exons, init.mode);
  }

  /** Ruler → baseline screen-x. CDS bp in CDS modes, aa in protein mode.
   *  Always returns a finite value: extrapolates linearly using the
   *  baseline's global `pxPerBp` past the gene's edges, and interpolates
   *  linearly across any collapsed-intron segment so the mapping stays
   *  continuous in `rulerPos`. The segment walk is mode-agnostic — exon
   *  segments and gap segments both contribute the same kind of linear
   *  interpolation; only their scale rule under live zoom differs. */
  rulerToBaselineX(rulerPos: number): number {
    const segments = this._segments;
    if (segments.length === 0) return 0;
    const first = segments[0]!;
    if (rulerPos < first.rulerStart) {
      return first.xStart - (first.rulerStart - rulerPos) * this.baseline.pxPerBp;
    }
    for (const seg of segments) {
      if (rulerPos <= seg.rulerEnd) {
        const rulerSpan = seg.rulerEnd - seg.rulerStart;
        if (rulerSpan <= 0) return seg.xStart;
        const t = (rulerPos - seg.rulerStart) / rulerSpan;
        return seg.xStart + t * seg.width;
      }
    }
    const last = segments[segments.length - 1]!;
    return last.xEnd + (rulerPos - last.rulerEnd) * this.baseline.pxPerBp;
  }

  /** Inverse of {@link rulerToBaselineX}. Maps baseline screen-x back to
   *  a ruler position by locating the containing segment. Return is
   *  fractional; callers round if they want a discrete CDS bp / aa
   *  value. Gap segments interpolate a "fictitious ruler" between the
   *  bracketing exons' boundaries — that's load-bearing for pan-animation
   *  continuity but not biologically meaningful (callers that need to
   *  distinguish exonic vs gap hits should not rely on this method). */
  baselineXToRuler(S: number): number {
    const segments = this._segments;
    if (segments.length === 0 || this.baseline.pxPerBp === 0) return 0;
    const first = segments[0]!;
    if (S < first.xStart) {
      return first.rulerStart - (first.xStart - S) / this.baseline.pxPerBp;
    }
    for (const seg of segments) {
      if (S <= seg.xEnd) {
        if (seg.width <= 0) return seg.rulerStart;
        const t = (S - seg.xStart) / seg.width;
        return seg.rulerStart + t * (seg.rulerEnd - seg.rulerStart);
      }
    }
    const last = segments[segments.length - 1]!;
    return last.rulerEnd + (S - last.xEnd) / this.baseline.pxPerBp;
  }

  /** Baseline screen-x → live screen-x. Each segment's screen width
   *  follows its {@link Segment.scaleRule}: `linear` segments scale with
   *  {@link SegmentLayout.linearScale}; `fixed-budget` segments stay at
   *  their baseline pixel width. */
  baselineToCurrent(baselineX: number): number | null {
    const segments = this._segments;
    if (segments.length === 0) return null;
    const { S_lo, S_hi } = this.bounds();
    if (S_hi - S_lo <= 0) return null;
    const layout = this.segmentLayout();
    const scale = layout.linearScale;

    const first = segments[0]!;
    if (baselineX < first.xStart) {
      // Padding before segment 0 — extrapolate using `linearScale`.
      return layout.segmentCurrentX[0]! - (first.xStart - baselineX) * scale;
    }
    for (const seg of segments) {
      if (baselineX <= seg.xEnd) {
        return baselineToCurrentInSegment(seg, layout.segmentCurrentX[seg.index]!, baselineX, scale);
      }
    }
    const last = segments[segments.length - 1]!;
    const lastCurrent = layout.segmentCurrentX[last.index]!;
    const lastWidth = segmentScreenWidth(last, scale);
    return lastCurrent + lastWidth + (baselineX - last.xEnd) * scale;
  }

  /** Inverse of {@link baselineToCurrent}: live screen-x → baseline-x. */
  currentToBaseline(currentX: number): number | null {
    const segments = this._segments;
    if (segments.length === 0) return null;
    const { S_lo, S_hi } = this.bounds();
    if (S_hi - S_lo <= 0) return null;
    const layout = this.segmentLayout();
    const scale = layout.linearScale;
    if (scale <= 0) return null;

    const first = segments[0]!;
    const firstCurrent = layout.segmentCurrentX[first.index]!;
    if (currentX < firstCurrent) {
      return first.xStart - (firstCurrent - currentX) / scale;
    }
    for (const seg of segments) {
      const cur = layout.segmentCurrentX[seg.index]!;
      const segScreen = segmentScreenWidth(seg, scale);
      const curEnd = cur + segScreen;
      if (currentX <= curEnd) {
        if (segScreen <= 0) return seg.xStart;
        return currentToBaselineInSegment(seg, cur, currentX, scale);
      }
    }
    const last = segments[segments.length - 1]!;
    const lastCurrent = layout.segmentCurrentX[last.index]!;
    const lastWidth = segmentScreenWidth(last, scale);
    const lastEnd = lastCurrent + lastWidth;
    return last.xEnd + (currentX - lastEnd) / scale;
  }

  /** Live screen-space zoom factor: `width / visibleBaselineSpan`. Distinct
   *  from the controller's ruler-space `zoom()` (= `naturalLen / currentLen`),
   *  which is what gets published as `--vv-zoom`. The two differ in
   *  `genome` mode whenever the visible range crosses an inter-exon
   *  gap — gap baseline pixels don't scale, so the screen-space factor is
   *  smaller than the ruler-space one. Degenerate ranges report 1. */
  zoomFactor(): number {
    const { S_lo, S_hi } = this.bounds();
    const span = S_hi - S_lo;
    if (span <= 0) return 1;
    return this.width / span;
  }

  /** Per-render exon layout — `{exonScale, exonCurrentX[exonIdx]}` derived
   *  from the underlying segment layout. Backwards-compatible view; CSS
   *  publication consumes this shape unchanged. Memoised on first call. */
  exonLayout(): ExonLayout {
    if (this._exonLayout) return this._exonLayout;
    const layout = this.segmentLayout();
    const exonCount = this.baseline.exons.length;
    const exonCurrentX = new Array<number>(exonCount).fill(0);
    for (const seg of this._segments) {
      if (seg.kind === 'exon' && seg.exonIdx !== undefined) {
        exonCurrentX[seg.exonIdx] = layout.segmentCurrentX[seg.index]!;
      }
    }
    this._exonLayout = { exonScale: layout.linearScale, exonCurrentX };
    return this._exonLayout;
  }

  /** Internal segment layout — shared `linearScale` plus per-segment
   *  current-frame screen-x. Memoised on first call. */
  private segmentLayout(): SegmentLayout {
    if (this._layout) return this._layout;
    const { S_lo, S_hi } = this.bounds();
    this._layout = computeSegmentLayout(this._segments, S_lo, S_hi, this.width);
    return this._layout;
  }

  private bounds(): { S_lo: number; S_hi: number } {
    if (this._S_lo !== null && this._S_hi !== null) {
      return { S_lo: this._S_lo, S_hi: this._S_hi };
    }
    this._S_lo = this.rulerToBaselineX(this.range[0]);
    this._S_hi = this.rulerToBaselineX(this.range[1]);
    return { S_lo: this._S_lo, S_hi: this._S_hi };
  }
}

/** Effective screen width of a segment at the given linear scale. For
 *  fixed-budget intron segments with embedded flanks, the donor and
 *  acceptor flanks scale linearly while the bulk between them stays at
 *  its baseline pixel budget. */
function segmentScreenWidth(seg: Segment, linearScale: number): number {
  if (seg.scaleRule === 'linear') return seg.width * linearScale;
  const donor = seg.donorFlankWidth ?? 0;
  const acceptor = seg.acceptorFlankWidth ?? 0;
  const bulkWidth = Math.max(0, seg.width - donor - acceptor);
  return (donor + acceptor) * linearScale + bulkWidth;
}

/** Map a baseline-x inside a segment to its live screen-x. Splits the
 *  fixed-budget gap with embedded flanks into three zones: donor
 *  (linear), bulk (fixed), acceptor (linear). */
function baselineToCurrentInSegment(
  seg: Segment,
  segCurrentX: number,
  baselineX: number,
  linearScale: number,
): number {
  if (seg.scaleRule === 'linear') {
    return segCurrentX + (baselineX - seg.xStart) * linearScale;
  }
  const donor = seg.donorFlankWidth ?? 0;
  const acceptor = seg.acceptorFlankWidth ?? 0;
  if (donor === 0 && acceptor === 0) {
    // Pure fixed-budget — no flanks. Linear within the segment in
    // baseline units (i.e., 1:1 baseline → screen).
    return segCurrentX + (baselineX - seg.xStart);
  }
  const local = baselineX - seg.xStart;
  if (local <= donor) {
    return segCurrentX + local * linearScale;
  }
  const bulkBaselineStart = donor;
  const bulkBaselineEnd = seg.width - acceptor;
  if (local <= bulkBaselineEnd) {
    return (
      segCurrentX +
      donor * linearScale +
      (local - bulkBaselineStart)
    );
  }
  const bulkWidth = bulkBaselineEnd - bulkBaselineStart;
  return (
    segCurrentX +
    donor * linearScale +
    bulkWidth +
    (local - bulkBaselineEnd) * linearScale
  );
}

/** Inverse of {@link baselineToCurrentInSegment}: map a live screen-x
 *  inside a segment back to its baseline-x. */
function currentToBaselineInSegment(
  seg: Segment,
  segCurrentX: number,
  currentX: number,
  linearScale: number,
): number {
  if (seg.scaleRule === 'linear') {
    return seg.xStart + (currentX - segCurrentX) / linearScale;
  }
  const donor = seg.donorFlankWidth ?? 0;
  const acceptor = seg.acceptorFlankWidth ?? 0;
  if (donor === 0 && acceptor === 0) {
    return seg.xStart + (currentX - segCurrentX);
  }
  const local = currentX - segCurrentX;
  const donorScreen = donor * linearScale;
  if (local <= donorScreen) {
    return seg.xStart + local / linearScale;
  }
  const bulkWidth = seg.width - donor - acceptor;
  const bulkScreenEnd = donorScreen + bulkWidth;
  if (local <= bulkScreenEnd) {
    return seg.xStart + donor + (local - donorScreen);
  }
  return (
    seg.xStart +
    seg.width -
    acceptor +
    (local - bulkScreenEnd) / linearScale
  );
}
