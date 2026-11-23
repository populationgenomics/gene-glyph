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
