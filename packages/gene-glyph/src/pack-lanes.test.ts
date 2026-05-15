import { describe, expect, it } from 'vitest';
import { packLanes } from './pack-lanes.js';

describe('packLanes', () => {
  it('places non-overlapping intervals in a single lane', () => {
    const result = packLanes([
      { item: 'a', xStart: 0, xEnd: 10 },
      { item: 'b', xStart: 20, xEnd: 30 },
      { item: 'c', xStart: 40, xEnd: 50 },
    ]);
    expect(result.laneCount).toBe(1);
    expect(result.items.map((i) => i.lane)).toEqual([0, 0, 0]);
  });

  it('stacks overlapping intervals into separate lanes', () => {
    const result = packLanes([
      { item: 'a', xStart: 0, xEnd: 30 },
      { item: 'b', xStart: 10, xEnd: 40 },
      { item: 'c', xStart: 20, xEnd: 50 },
    ]);
    expect(result.laneCount).toBe(3);
    const byItem = new Map(result.items.map((i) => [i.item, i.lane]));
    expect(byItem.get('a')).toBe(0);
    expect(byItem.get('b')).toBe(1);
    expect(byItem.get('c')).toBe(2);
  });

  it('reuses an earlier lane once it has cleared', () => {
    const result = packLanes([
      { item: 'a', xStart: 0, xEnd: 10 },
      { item: 'b', xStart: 5, xEnd: 20 },
      { item: 'c', xStart: 12, xEnd: 25 },
    ]);
    // a (lane 0) finishes at 10; c can take lane 0 again because 10 <= 12.
    const byItem = new Map(result.items.map((i) => [i.item, i.lane]));
    expect(byItem.get('a')).toBe(0);
    expect(byItem.get('b')).toBe(1);
    expect(byItem.get('c')).toBe(0);
    expect(result.laneCount).toBe(2);
  });

  it('honours a gap requirement between items in the same lane', () => {
    // Without a gap these would share lane 0; with gap=5 the second item is
    // pushed to a new lane because 10 + 5 > 12.
    const result = packLanes(
      [
        { item: 'a', xStart: 0, xEnd: 10 },
        { item: 'b', xStart: 12, xEnd: 20 },
      ],
      5,
    );
    expect(result.laneCount).toBe(2);
  });

  it('returns an empty result for empty input', () => {
    expect(packLanes([])).toEqual({ items: [], laneCount: 0 });
  });
});
