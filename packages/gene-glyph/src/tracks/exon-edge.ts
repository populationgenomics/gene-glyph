import type { CdsPosition, CoordinateMapper, ExonBaseline, Viewport } from '../types.js';

/** Where a feature is drawn inside an exon's group. */
export interface ExonPlacement {
  exonIdx: number;
  /** Baseline x relative to the exon group's origin. */
  localX: number;
  /** Set for a position in an intron, drawn on the exon edge facing it:
   *  `donor` is the exon's 3' edge, `acceptor` its 5' edge. */
  intronSide?: 'donor' | 'acceptor';
}

/** The exon whose drawn extent, UTR caps included, holds baseline `x`.
 *  Inclusive-left, exclusive-right so an x on a shared tile edge goes to
 *  the downstream exon; the last exon also takes its right edge. */
export function findExonByBaselineX(exons: readonly ExonBaseline[], x: number): number | null {
  const last = exons[exons.length - 1];
  for (const eb of exons) {
    const lo = eb.xStart - (eb.utr5Px ?? 0);
    const hi = eb.xEnd + (eb.utr3Px ?? 0);
    if (x >= lo && (eb === last ? x <= hi : x < hi)) return eb.exonIdx;
  }
  return null;
}

/** Place a c. position on the figure. An exonic or UTR position lands on
 *  its base; an intronic one (`offset !== 0`) on the edge of the exon base
 *  it is anchored on, facing the intron. `null` when the position is off
 *  the drawn transcript, and for an intronic position in protein mode,
 *  where an intron has no place. */
export function placeCdsPosition(
  pos: CdsPosition,
  viewport: Viewport,
  mapper: CoordinateMapper,
): ExonPlacement | null {
  if (pos.offset !== 0 && viewport.mode === 'protein') return null;
  const x = viewport.toBaselineX({ kind: 'cds', cPos: pos.cPos, offset: 0 });
  if (x === null) return null;
  const baseline = viewport.baselineGeometry();
  const exonIdx = findExonByBaselineX(baseline.exons, x);
  if (exonIdx === null) return null;
  const origin = baseline.exons[exonIdx]!.xStart;
  if (pos.offset === 0) return { exonIdx, localX: x - origin };
  const intronSide = pos.offset > 0 ? 'donor' : 'acceptor';
  const coding = pos.cPos >= 1 && pos.cPos <= mapper.transcript.cdsLength;
  const halfCell = (coding ? baseline.pxPerBp : baseline.pxPerBpOutsideCds) / 2;
  const edgeX = intronSide === 'donor' ? x + halfCell : x - halfCell;
  return { exonIdx, localX: edgeX - origin, intronSide };
}

const INTRON_MARK_PX = 5;

/** Marker for a feature drawn on an exon edge for a position in the
 *  intron beyond it: a horizontal stub at `y0` (and at `y1` when given),
 *  starting `gap` px from the feature's x and pointing into the intron.
 *  Draw it in a counter-scaled group so the stubs keep their length under
 *  zoom. */
export function intronMarkPath(
  side: 'donor' | 'acceptor',
  gap: number,
  y0: number,
  y1?: number,
): string {
  const dir = side === 'donor' ? 1 : -1;
  const x0 = dir * gap;
  const dx = dir * INTRON_MARK_PX;
  const first = `M${x0} ${y0}h${dx}`;
  return y1 === undefined ? first : `${first}M${x0} ${y1}h${dx}`;
}
