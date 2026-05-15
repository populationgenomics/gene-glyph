/**
 * Lane packing: assign each input interval to the lowest-index lane such that
 * no two items in the same lane overlap. A small horizontal `gap` may be
 * required between consecutive items in the same lane so labels don't crash.
 *
 * Used by any track that wants to lay out a flat list of intervals as a fixed
 * number of stacked rows; InterPro is the first caller, but the API is kept
 * generic so user-annotation, ClinVar-cluster, and brush-bound tracks can
 * reuse it. Ported from lit-manager's `packLanes`.
 */

export interface LaneInput<T> {
  item: T;
  xStart: number;
  xEnd: number;
}

export interface PackedItem<T> {
  item: T;
  lane: number;
  xStart: number;
  xEnd: number;
}

export interface PackResult<T> {
  items: PackedItem<T>[];
  laneCount: number;
}

export function packLanes<T>(inputs: LaneInput<T>[], gap = 0): PackResult<T> {
  // Sort by xStart so the sweep can place items greedily into the first
  // lane whose previous end (plus gap) clears the new start.
  const sorted = inputs
    .slice()
    .sort((a, b) => a.xStart - b.xStart || a.xEnd - b.xEnd);
  const laneEnds: number[] = [];
  const items: PackedItem<T>[] = [];
  for (const it of sorted) {
    let lane = -1;
    for (let i = 0; i < laneEnds.length; i++) {
      if (laneEnds[i]! + gap <= it.xStart) {
        lane = i;
        break;
      }
    }
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(it.xEnd);
    } else {
      laneEnds[lane] = it.xEnd;
    }
    items.push({ item: it.item, lane, xStart: it.xStart, xEnd: it.xEnd });
  }
  return { items, laneCount: laneEnds.length };
}
