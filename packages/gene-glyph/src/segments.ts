import type { BaselineGeometry, ViewMode } from './types.js';
import type { Piece } from './figure-scale.js';
import type { FrameExon } from './projection-frame.js';

/** Display behaviour of a segment under live zoom.
 *
 *  - **`linear`** (mapped to FigureScale `flexible`): the segment's screen
 *    width scales with the live zoom factor. Exon bodies in every mode
 *    use this; intron flanks (splice-site preservation pieces) too.
 *  - **`fixed-budget`** (mapped to FigureScale `fixed`): the segment's
 *    screen width stays constant under zoom. The inter-exon gap bulk in
 *    `genome` is fixed-budget so Pfam / InterPro segments in adjacent
 *    exons stay visually close at deep zoom.
 */
export type SegmentScaleRule = 'linear' | 'fixed-budget';

/** One linear or fixed display segment, ordered 5'→3' across the figure.
 *
 *  Each segment owns:
 *  - a baseline-x interval `[xStart, xEnd]` (fit-gene screen pixels) —
 *    this doubles as the segment's figure-x interval for the live
 *    FigureScale layout;
 *  - a ruler interval `[rulerStart, rulerEnd]` in the active mode's
 *    coords (CDS bp in CDS modes, aa in protein mode);
 *  - a {@link SegmentScaleRule} that controls how the screen width
 *    behaves under live zoom.
 *
 *  Phase 3 splice-site flanks are first-class segments here — the
 *  legacy "flank widths embedded inside an intron-collapsed segment"
 *  encoding is gone. An intron with flanks emits three segments in
 *  order: `flank-donor` (linear), `intron-bulk` (fixed), `flank-acceptor`
 *  (linear). An intron without flanks emits a single `intron-bulk`. */
export interface Segment {
  /** Position in the segment array. Stable for the lifetime of the
   *  baseline; the layout math indexes by this. */
  index: number;
  /** Segment kind. `exon` is an exon body. `intron-bulk` is the
   *  bulk-collapsed portion of an intron (the intron-decoration target).
   *  `flank-donor` / `flank-acceptor` are linear-scale intronic pieces
   *  adjacent to the upstream / downstream exon edges (splice-site
   *  preservation). */
  kind: 'exon' | 'intron-bulk' | 'flank-donor' | 'flank-acceptor';
  /** For exon segments, the exon's index in the transcript. For intron
   *  / flank segments, undefined. */
  exonIdx?: number;
  /** For intron-bulk and flank segments, the bracketing exon indices. */
  exonIdxA?: number;
  exonIdxB?: number;
  /** Ruler endpoints in active-mode units. Exon segments cover their
   *  exonic CDS bp range (CDS modes) or their aa range (protein). Intron
   *  / flank segments share a "fictitious ruler" linearly interpolated
   *  from the upstream exon's ruler end to the downstream exon's ruler
   *  start, sliced proportionally to each piece's baseline width.
   *  Powers ruler ↔ baseline-x continuity through the gap. */
  rulerStart: number;
  rulerEnd: number;
  /** Baseline (fit-gene) screen-x interval — also the segment's figure-x
   *  interval as far as the live FigureScale layout is concerned. */
  xStart: number;
  xEnd: number;
  width: number;
  scaleRule: SegmentScaleRule;
}

/** Project a {@link Segment} onto a FigureScale {@link Piece}: figure-x
 *  is the segment's baseline-x interval, the scale rule translates
 *  flexible/fixed, and fixed pieces declare their full baseline width as
 *  their reserved display budget. */
export function segmentToPiece(seg: Segment): Piece {
  if (seg.scaleRule === 'linear') {
    return {
      figureStart: seg.xStart,
      figureEnd: seg.xEnd,
      scaleRule: 'flexible',
    };
  }
  return {
    figureStart: seg.xStart,
    figureEnd: seg.xEnd,
    scaleRule: 'fixed',
    fixedDisplayWidth: seg.width,
  };
}

/** Derive the segment array for a precomputed baseline. Today's baseline
 *  carries `exons[]` and `gaps[]` separately; this folds them into a
 *  single ordered sequence with explicit scale rules. The frame's math
 *  works uniformly over the result regardless of mode.
 *
 *  `mode` decides how ruler endpoints are sourced:
 *  - CDS modes: rulerStart/rulerEnd come from `FrameExon.cdsStart/cdsEnd`
 *    for exon segments; for intron / flank segments they're interpolated
 *    between the bracketing exons' ruler bounds.
 *  - protein: rulerStart/rulerEnd are derived from each exon's
 *    `xStart / pxPerBp + 1` (aa equivalent). */
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
  // cell's right edge (`lastUnit + 0.5`) on the ruler axis.
  const exonRuler = (i: number): readonly [number, number] => {
    if (mode === 'protein') {
      const eb = baseline.exons[i]!;
      const pxPerAa = baseline.pxPerBp;
      const denom = pxPerAa > 0 ? pxPerAa : 1;
      const aaStart = eb.xStart / denom + 1;
      const aaEnd = eb.xEnd / denom;
      return [aaStart - 0.5, aaEnd + 0.5];
    }
    const e = exons[i]!;
    return [e.cdsStart - 0.5, e.cdsEnd + 0.5];
  };

  // Gap-bulk scale rule: fixed-budget when the baseline reserved
  // explicit gap pixels (genome); linear (1:1, zero pixels) in
  // transcript / protein.
  const defaultGapScale: SegmentScaleRule = baseline.gapPx > 0 ? 'fixed-budget' : 'linear';

  // Index flanks-by-intron for the per-intron 3-piece split.
  const flanksByIntron = new Map<number, { donorWidth: number; acceptorWidth: number }>();
  for (const flank of baseline.flanks ?? []) {
    const cur = flanksByIntron.get(flank.intronIdx) ?? { donorWidth: 0, acceptorWidth: 0 };
    if (flank.side === 'donor') cur.donorWidth = flank.width;
    else cur.acceptorWidth = flank.width;
    flanksByIntron.set(flank.intronIdx, cur);
  }

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
    if (i >= baseline.exons.length - 1) continue;

    const gap = baseline.gaps[i]!;
    const flanks = flanksByIntron.get(i) ?? { donorWidth: 0, acceptorWidth: 0 };
    const gapScale: SegmentScaleRule = gap.scaleRule ?? defaultGapScale;
    const [, upstreamRulerEnd] = exonRuler(i);
    const [downstreamRulerStart] = exonRuler(i + 1);

    // Distribute the gap's synthetic ruler span across the (donor flank,
    // bulk, acceptor flank) pieces in proportion to their baseline
    // widths. This preserves the existing ruler ↔ baseline-x continuity:
    // a ruler position partway through the intron still maps to the
    // same baseline-x it did when the gap was a single segment.
    const totalGapBaseline = gap.width;
    const rulerSpan = downstreamRulerStart - upstreamRulerEnd;
    const rulerPerBaseline = totalGapBaseline > 0 ? rulerSpan / totalGapBaseline : 0;

    let cursorX = gap.xStart;
    let cursorRuler = upstreamRulerEnd;

    if (flanks.donorWidth > 0) {
      const xEnd = cursorX + flanks.donorWidth;
      const rEnd = cursorRuler + flanks.donorWidth * rulerPerBaseline;
      segments.push({
        index: idx++,
        kind: 'flank-donor',
        exonIdxA: gap.exonIdxA,
        exonIdxB: gap.exonIdxB,
        rulerStart: cursorRuler,
        rulerEnd: rEnd,
        xStart: cursorX,
        xEnd,
        width: flanks.donorWidth,
        scaleRule: 'linear',
      });
      cursorX = xEnd;
      cursorRuler = rEnd;
    }

    const bulkWidth = Math.max(0, totalGapBaseline - flanks.donorWidth - flanks.acceptorWidth);
    if (bulkWidth > 0 || gapScale === 'fixed-budget') {
      const xEnd = cursorX + bulkWidth;
      const rEnd = cursorRuler + bulkWidth * rulerPerBaseline;
      segments.push({
        index: idx++,
        kind: 'intron-bulk',
        exonIdxA: gap.exonIdxA,
        exonIdxB: gap.exonIdxB,
        rulerStart: cursorRuler,
        rulerEnd: rEnd,
        xStart: cursorX,
        xEnd,
        width: bulkWidth,
        scaleRule: gapScale,
      });
      cursorX = xEnd;
      cursorRuler = rEnd;
    }

    if (flanks.acceptorWidth > 0) {
      const xEnd = cursorX + flanks.acceptorWidth;
      const rEnd = cursorRuler + flanks.acceptorWidth * rulerPerBaseline;
      segments.push({
        index: idx++,
        kind: 'flank-acceptor',
        exonIdxA: gap.exonIdxA,
        exonIdxB: gap.exonIdxB,
        rulerStart: cursorRuler,
        rulerEnd: rEnd,
        xStart: cursorX,
        xEnd,
        width: flanks.acceptorWidth,
        scaleRule: 'linear',
      });
    }
  }
  return segments;
}
