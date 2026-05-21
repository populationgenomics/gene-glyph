import type { BaselineGeometry, ViewMode } from './types.js';
import type { FrameExon } from './projection-frame.js';

/** Display behaviour of a segment under live zoom.
 *
 *  - **`linear`**: the segment's screen width scales with the live zoom
 *    factor. Exon bodies in every mode use this. Intronic regions in
 *    `transcript` and `protein` also use this — they collapse to a
 *    one-bp transition that scales with the surrounding exon content.
 *  - **`fixed-budget`**: the segment's screen width stays constant under
 *    zoom. The inter-exon gap in `genome` is fixed-budget so
 *    Pfam / InterPro segments in adjacent exons stay visually close at
 *    deep zoom; the gap content (dashed-intron polyline + breathing
 *    room) is allotted a constant pixel budget regardless of how zoomed
 *    in the user is. */
export type SegmentScaleRule = 'linear' | 'fixed-budget';

/** One linear or collapsed display segment, ordered 5'→3' across the
 *  figure. Each segment owns:
 *  - a baseline-x interval `[xStart, xEnd]` (fit-gene screen pixels),
 *  - a ruler interval `[rulerStart, rulerEnd]` in the active mode's
 *    coords (CDS bp in CDS modes, aa in protein mode),
 *  - a {@link SegmentScaleRule} that controls how the screen width
 *    behaves under zoom.
 *
 *  Segments are the geometry primitive the {@link ProjectionFrame}'s
 *  math operates on; today there are two kinds (`exon`, `intron-
 *  collapsed`), but the type is designed to admit richer kinds in
 *  future phases (`splice-site`, `expanded-intron`, etc.) without
 *  reshaping the layout math. */
export interface Segment {
  /** Position in the segment array. Stable for the lifetime of the
   *  baseline; the layout math indexes by this. */
  index: number;
  /** Segment kind. `exon` is an exon body. `intron-collapsed` is the
   *  inter-exon gap (today's intron-decoration target). `intron-flank`
   *  is a Phase 3 splice-site-preservation piece — linear-scale bp
   *  adjacent to an exon's 3' or 5' end, biologically intronic. */
  kind: 'exon' | 'intron-collapsed' | 'intron-flank';
  /** For exon segments, the exon's index in the transcript. For intron-
   *  collapsed segments, undefined. */
  exonIdx?: number;
  /** For intron-collapsed segments, the bracketing exon indices. */
  exonIdxA?: number;
  exonIdxB?: number;
  /** For intron-flank segments, which side of the intron this piece
   *  lives on. `donor` sits at the upstream (5') end; `acceptor` at the
   *  downstream (3') end. */
  flankSide?: 'donor' | 'acceptor';
  /** For `intron-collapsed` segments with Phase 3 splice-site flanks:
   *  the baseline width of the donor flank (on the upstream side of
   *  the intron) and the acceptor flank (downstream side). The bulk
   *  sits between them. Donor and acceptor portions scale with the
   *  live linear scale; the bulk remains at its fixed pixel budget.
   *  Both default to 0 for legacy / non-flank segments — the whole
   *  width then follows `scaleRule`. */
  donorFlankWidth?: number;
  acceptorFlankWidth?: number;
  /** Ruler endpoints in active-mode units. Exon segments cover their
   *  exonic CDS bp range (CDS modes) or their aa range (protein). Intron-
   *  collapsed segments interpolate ruler position linearly from upstream
   *  exon's ruler end to downstream exon's ruler start — the fictitious
   *  ruler that powers pan-animation continuity through the gap. */
  rulerStart: number;
  rulerEnd: number;
  /** Baseline (fit-gene) screen-x interval. */
  xStart: number;
  xEnd: number;
  width: number;
  scaleRule: SegmentScaleRule;
}

/** Derive the segment array for a precomputed baseline. Today's baseline
 *  carries `exons[]` and `gaps[]` separately; this folds them into a
 *  single ordered sequence with explicit scale rules. The frame's math
 *  works uniformly over the result regardless of mode — protein-mode's
 *  zero-width gap segments degenerate cleanly under the segment walk
 *  rather than needing a separate code path.
 *
 *  `mode` decides how ruler endpoints are sourced:
 *  - CDS modes: rulerStart/rulerEnd come from `FrameExon.cdsStart/cdsEnd`
 *    for exon segments; for intron-collapsed segments they're the
 *    bracketing exons' bounds.
 *  - protein: rulerStart/rulerEnd are derived from each exon's
 *    `xStart / pxPerBp + 1` (aa equivalent) so segment-walk arithmetic
 *    matches today's `(rulerPos - 1) * pxPerBp` linear formula. */
export function buildSegments(
  baseline: BaselineGeometry,
  exons: readonly FrameExon[],
  mode: ViewMode,
): Segment[] {
  const segments: Segment[] = [];
  if (baseline.exons.length === 0) return segments;

  // Cell-width invariant: bp/aa N occupies the cell `[N-0.5, N+0.5]` on
  // the ruler axis. To make the segment's linear interpolation place
  // bp/aa N's *centre* at its cell centre, the segment must span from
  // the leftmost cell's left edge (`firstUnit - 0.5`) to the rightmost
  // cell's right edge (`lastUnit + 0.5`) on the ruler axis. Otherwise
  // the interpolation would place bp/aa N at its cell's *left edge*,
  // off by half a unit.
  const exonRuler = (i: number): readonly [number, number] => {
    if (mode === 'protein') {
      const eb = baseline.exons[i]!;
      const pxPerAa = baseline.pxPerBp;
      // Invert the protein-mode baseline: xStart = (aaStart-1)*pxPerAa,
      // xEnd = aaEnd*pxPerAa. Recover the aa endpoints, then widen by
      // ±0.5 to bracket the full cell range.
      const denom = pxPerAa > 0 ? pxPerAa : 1;
      const aaStart = eb.xStart / denom + 1;
      const aaEnd = eb.xEnd / denom;
      return [aaStart - 0.5, aaEnd + 0.5];
    }
    const e = exons[i]!;
    return [e.cdsStart - 0.5, e.cdsEnd + 0.5];
  };

  // Gaps are fixed-budget when the baseline reserves explicit gap pixels
  // (genome); in transcript and protein the gap shares the
  // linear ruler with the surrounding exons.
  const gapScale: SegmentScaleRule = baseline.gapPx > 0 ? 'fixed-budget' : 'linear';

  // Phase 3: each intron is one ruler-walk segment covering the whole
  // intron in both ruler and baseline-x. The flank/bulk substructure
  // lives in baseline.flanks (a parallel array) and is used by the
  // layout math + rendering — not by the ruler walk, which would suffer
  // synthetic-ruler ambiguity at exon boundaries if flanks were
  // separate segments.
  let idx = 0;
  for (let i = 0; i < baseline.exons.length; i++) {
    const eb = baseline.exons[i]!;
    const [rulerStart, rulerEnd] = exonRuler(i);
    segments.push({
      index: idx++,
      kind: 'exon',
      exonIdx: eb.exonIdx,
      rulerStart,
      rulerEnd,
      xStart: eb.xStart,
      xEnd: eb.xEnd,
      width: eb.width,
      scaleRule: 'linear',
    });
    if (i < baseline.exons.length - 1) {
      const gap = baseline.gaps[i]!;
      const [, upstreamRulerEnd] = exonRuler(i);
      const [downstreamRulerStart] = exonRuler(i + 1);
      const perGapScale: SegmentScaleRule = gap.scaleRule ?? gapScale;
      // Per-side flank widths embedded inside this gap (Phase 3). When
      // present, the gap's `scaleRule === 'fixed-budget'` applies only
      // to the bulk between the flanks; each flank portion scales with
      // `linearScale` via the layout math.
      let donorFlankWidth = 0;
      let acceptorFlankWidth = 0;
      for (const flank of baseline.flanks ?? []) {
        if (flank.intronIdx !== i) continue;
        if (flank.side === 'donor') donorFlankWidth = flank.width;
        else acceptorFlankWidth = flank.width;
      }
      segments.push({
        index: idx++,
        kind: 'intron-collapsed',
        exonIdxA: gap.exonIdxA,
        exonIdxB: gap.exonIdxB,
        rulerStart: upstreamRulerEnd,
        rulerEnd: downstreamRulerStart,
        xStart: gap.xStart,
        xEnd: gap.xEnd,
        width: gap.width,
        scaleRule: perGapScale,
        donorFlankWidth: donorFlankWidth > 0 ? donorFlankWidth : undefined,
        acceptorFlankWidth:
          acceptorFlankWidth > 0 ? acceptorFlankWidth : undefined,
      });
    }
  }
  return segments;
}

/** Per-render screen-space placement derived from `(segments, S_lo, S_hi,
 *  width)`. Mirrors today's {@link ExonLayout}: a single shared
 *  `linearScale` applied to segments with `scaleRule === 'linear'`, plus
 *  per-segment current-frame screen-x. Fixed-budget segments stay at
 *  baseline width. */
export interface SegmentLayout {
  /** Shared scale factor for `linear` segments. Equivalent to today's
   *  `exonLayout.exonScale`. Renamed because intron-collapsed segments
   *  also use it in transcript / protein modes. */
  readonly linearScale: number;
  /** Scale factor applied to the padding region outside the segment
   *  array (before `segments[0].xStart` / after the last segment's
   *  xEnd). In modes with fixed-budget segments (genome) this is 1:1
   *  so padding doesn't double-count with the fixed gap budget — and
   *  the figure's right edge stays anchored to `width` even when
   *  panned into the padding. In modes without fixed-budget segments
   *  (transcript / protein) it equals `linearScale` so padding scales
   *  with the exons. */
  readonly paddingScale: number;
  /** Per-segment screen-x of the segment's left edge. Indexed by
   *  {@link Segment.index}. */
  readonly segmentCurrentX: readonly number[];
}

/** Map a visible baseline range `[S_lo, S_hi]` to per-segment screen-x
 *  positions such that:
 *
 *    1. S_lo lands at screen-x = 0.
 *    2. S_hi lands at screen-x = width.
 *    3. Every visible `fixed-budget` segment occupies exactly its
 *       baseline width on screen (so the gap content stays at a constant
 *       pixel budget regardless of zoom — same load-bearing property as
 *       today's `gapsScale === false` branch).
 *
 *  Partitions the visible baseline into "linear" (always scales) +
 *  "fixed-budget" (frozen). Reserves the fixed pixels in screen space
 *  and solves for the `linearScale` that makes the linear content fill
 *  the remainder. Walks left + right from a pivot segment so per-segment
 *  positions stay stable as the user pans across a gap.
 *
 *  Padding outside the gene's segments uses the same rule as
 *  `fixed-budget` gaps when any are present, preserving today's
 *  `gapPx === 0 ? * exonScale : direct` asymmetry exactly. (Phase 1
 *  keeps current behaviour bit-for-bit; later phases can revisit the
 *  padding rule explicitly.) */
export function computeSegmentLayout(
  segments: readonly Segment[],
  S_lo: number,
  S_hi: number,
  width: number,
): SegmentLayout {
  const out = new Array<number>(segments.length).fill(0);
  if (segments.length === 0) {
    return { linearScale: 1, paddingScale: 1, segmentCurrentX: out };
  }

  // Internal sub-region bounds for a fixed-budget intron segment. The
  // bulk sits in the middle, flanked by donor (upstream) and acceptor
  // (downstream) flank pixels. For non-flank segments, donor/acceptor
  // are both 0 and the bulk spans the whole segment.
  const bulkRange = (seg: Segment): { start: number; end: number } => {
    const donor = seg.donorFlankWidth ?? 0;
    const acceptor = seg.acceptorFlankWidth ?? 0;
    return { start: seg.xStart + donor, end: seg.xEnd - acceptor };
  };

  let visibleFixedBaseline = 0;
  let anyFixed = false;
  for (const seg of segments) {
    if (seg.scaleRule !== 'fixed-budget') continue;
    const bulk = bulkRange(seg);
    if (bulk.end <= bulk.start) continue;
    anyFixed = true;
    const lo = Math.max(bulk.start, S_lo);
    const hi = Math.min(bulk.end, S_hi);
    if (hi > lo) visibleFixedBaseline += hi - lo;
  }
  // Padding zones — visible baseline outside any segment. In `anyFixed`
  // mode the pivot logic places the padding 1:1 (baseline-px == screen-px)
  // because mixing scaled padding with fixed-budget bulks produced a
  // visible drift past the figure right edge. Account for that 1:1 budget
  // here, otherwise `linearScale` over-shoots and the visible content
  // extends past `width`.
  const firstX = segments[0]!.xStart;
  const lastX = segments[segments.length - 1]!.xEnd;
  const paddingBaseline = anyFixed
    ? Math.max(0, firstX - S_lo) + Math.max(0, S_hi - lastX)
    : 0;
  const visibleScalingBaseline = Math.max(
    1e-9,
    S_hi - S_lo - visibleFixedBaseline - paddingBaseline,
  );
  const linearScale = Math.max(
    1e-9,
    (width - visibleFixedBaseline - paddingBaseline) / visibleScalingBaseline,
  );
  // anyFixed → padding is 1:1; otherwise it scales with linearScale.
  const paddingScale = anyFixed ? 1 : linearScale;

  const segmentScreenWidth = (seg: Segment): number => {
    if (seg.scaleRule === 'linear') return seg.width * linearScale;
    // Fixed-budget with optional embedded flanks: bulk stays at fixed
    // pixels, flanks scale linearly.
    const donor = seg.donorFlankWidth ?? 0;
    const acceptor = seg.acceptorFlankWidth ?? 0;
    const bulkWidth = Math.max(0, seg.width - donor - acceptor);
    return (donor + acceptor) * linearScale + bulkWidth;
  };

  const pivotIdx = pivotSegmentIdx(segments, S_lo);
  const pivot = segments[pivotIdx]!;
  let pivotCurrentX: number;
  if (S_lo >= pivot.xStart) {
    // S_lo inside pivot segment — anchor pivot.xStart at
    // `-(S_lo - pivot.xStart) × segment-scale` so that the visible part
    // of the pivot starts at screen-x = 0.
    pivotCurrentX =
      pivot.scaleRule === 'linear'
        ? -(S_lo - pivot.xStart) * linearScale
        : -(S_lo - pivot.xStart);
  } else {
    // S_lo upstream of the pivot — this only happens when S_lo is in
    // the padding zone before segment 0 (every gap is a real segment,
    // so a gap-position S_lo lands inside *that* gap segment, not
    // upstream of the first exon). Padding extrapolation uses
    // `paddingScale`: 1:1 in modes with fixed-budget segments (the
    // visible padding baseline is already accounted for in the
    // `width - paddingBaseline` numerator of `linearScale`, so
    // applying `linearScale` here would double-count), and
    // `linearScale` in modes without fixed-budget segments.
    const baselineUpstream = pivot.xStart - S_lo;
    pivotCurrentX = baselineUpstream * paddingScale;
  }
  out[pivot.index] = pivotCurrentX;

  let cursor = pivotCurrentX + segmentScreenWidth(pivot);
  for (let i = pivotIdx + 1; i < segments.length; i++) {
    out[i] = cursor;
    cursor += segmentScreenWidth(segments[i]!);
  }
  cursor = pivotCurrentX;
  for (let i = pivotIdx - 1; i >= 0; i--) {
    cursor -= segmentScreenWidth(segments[i]!);
    out[i] = cursor;
  }

  return { linearScale, paddingScale, segmentCurrentX: out };
}

/** Find the segment containing `baselineX`, or the first segment whose
 *  right edge is at or past it if `baselineX` precedes every segment.
 *  Falls through to the last segment when `baselineX` lies past the
 *  3' end. */
function pivotSegmentIdx(segments: readonly Segment[], baselineX: number): number {
  if (segments.length === 0) return 0;
  for (let i = 0; i < segments.length; i++) {
    if (baselineX <= segments[i]!.xEnd) return i;
  }
  return segments.length - 1;
}
