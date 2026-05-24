import { describe, expect, it } from 'vitest';
import { layoutTracks } from './layout-engine.js';
import { ViewportController } from './viewport.js';
import { createCoordinateMapper } from './coordinate-mapper.js';
import type {
  Track,
  TrackGroup,
  TrackHeightArgs,
  TrackHeightResult,
  Transcript,
  Viewport,
} from './types.js';

const transcript: Transcript = {
  geneSymbol: 'TEST',
  transcriptId: 'NM_TEST.1',
  cdsLength: 360,
  strand: '+',
  exons: [
    { number: 1, cdsStart: 1, cdsEnd: 100, genomicStart: 1000, genomicEnd: 1099, chr: 'chr1' },
    { number: 2, cdsStart: 101, cdsEnd: 250, genomicStart: 2000, genomicEnd: 2149, chr: 'chr1' },
    { number: 3, cdsStart: 251, cdsEnd: 360, genomicStart: 3000, genomicEnd: 3109, chr: 'chr1' },
  ],
};

function makeViewport(): Viewport {
  const mapper = createCoordinateMapper(transcript);
  return new ViewportController({ mapper, width: 720, mode: 'transcript' });
}

interface StubTrackConfig {
  id: string;
  naturalHeight: number;
  droppedCount?: number;
}

function stubTrack(cfg: StubTrackConfig): Track<StubTrackConfig, null> {
  return {
    id: cfg.id,
    coordSystem: 'cds',
    heightPolicy: 'fixed',
    async load() {
      return null;
    },
    height({ hint }: TrackHeightArgs<null>): TrackHeightResult {
      const px = Math.min(cfg.naturalHeight, hint.maxPx);
      return {
        px,
        didTruncate: px < cfg.naturalHeight,
        droppedCount: cfg.droppedCount,
      };
    },
    render() {
      return null;
    },
    toJSON() {
      return cfg;
    },
  };
}

describe('LayoutEngine — height negotiation', () => {
  it('stacks tracks top-to-bottom and computes rects from accumulated y', () => {
    const viewport = makeViewport();
    const tracks = [stubTrack({ id: 'a', naturalHeight: 30 }), stubTrack({ id: 'b', naturalHeight: 50 })];
    const result = layoutTracks({
      tracks,
      viewport,
      data: new Map(),
      totalHeightBudget: 200,
    });
    expect(result.totalHeight).toBe(80);
    expect(result.items[0]!.rect).toEqual({ yTop: 0, yBottom: 30 });
    expect(result.items[1]!.rect).toEqual({ yTop: 30, yBottom: 80 });
  });

  it('truncates tracks that exceed the remaining budget and flags didTruncate', () => {
    const viewport = makeViewport();
    const tracks = [
      stubTrack({ id: 'a', naturalHeight: 60 }),
      stubTrack({ id: 'b', naturalHeight: 80, droppedCount: 3 }),
    ];
    const result = layoutTracks({
      tracks,
      viewport,
      data: new Map(),
      totalHeightBudget: 100,
    });
    expect(result.items[0]!.didTruncate).toBe(false);
    expect(result.items[1]!.didTruncate).toBe(true);
    expect(result.items[1]!.rect.yBottom - result.items[1]!.rect.yTop).toBe(40);
    expect(result.items[1]!.droppedCount).toBe(3);
  });

  it('lays out tracks inside a group and reports group-level rect + truncation', () => {
    const viewport = makeViewport();
    const group: TrackGroup = {
      kind: 'group',
      id: 'g',
      label: 'Group',
      gapAbove: 8,
      heightBudget: 40,
      tracks: [
        stubTrack({ id: 'g-a', naturalHeight: 20 }),
        stubTrack({ id: 'g-b', naturalHeight: 30 }),
      ],
    };
    const result = layoutTracks({
      tracks: [stubTrack({ id: 'top', naturalHeight: 10 }), group],
      viewport,
      data: new Map(),
      totalHeightBudget: 200,
    });
    expect(result.items[0]!.rect).toEqual({ yTop: 0, yBottom: 10 });
    expect(result.items[1]!.rect.yTop).toBe(18); // 10 + gapAbove(8)
    expect(result.items[1]!.rect.yBottom).toBe(58); // 18 + 40 (group budget exhausted)
    expect(result.items[1]!.didTruncate).toBe(true);
    expect(result.items[1]!.children?.map((c) => c.id)).toEqual(['g-a', 'g-b']);
    expect(result.trackRects.get('g-b')?.yBottom).toBe(58);
  });

  it('swaps a folded group for its summaryTrack when present (RD-1110)', () => {
    const viewport = makeViewport();
    const group: TrackGroup = {
      kind: 'group',
      id: 'g',
      label: 'Group',
      tracks: [
        stubTrack({ id: 'detail-a', naturalHeight: 40 }),
        stubTrack({ id: 'detail-b', naturalHeight: 40 }),
      ],
      summaryTrack: stubTrack({ id: 'summary', naturalHeight: 16 }),
    };
    const result = layoutTracks({
      tracks: [group],
      viewport,
      data: new Map(),
      totalHeightBudget: 200,
      collapsedGroupIds: new Set(['g']),
    });
    // Folded → only the summary track is laid out; detail tracks have no
    // rect at all.
    expect(result.items[0]!.children?.map((c) => c.id)).toEqual(['summary']);
    expect(result.trackRects.get('summary')!.yBottom).toBe(16);
    expect(result.trackRects.has('detail-a')).toBe(false);
    expect(result.trackRects.has('detail-b')).toBe(false);
  });

  it('lays out group detail tracks when collapsedGroupIds does not include the group', () => {
    const viewport = makeViewport();
    const group: TrackGroup = {
      kind: 'group',
      id: 'g',
      label: 'Group',
      tracks: [stubTrack({ id: 'detail-a', naturalHeight: 30 })],
      summaryTrack: stubTrack({ id: 'summary', naturalHeight: 16 }),
    };
    const result = layoutTracks({
      tracks: [group],
      viewport,
      data: new Map(),
      totalHeightBudget: 200,
      collapsedGroupIds: new Set(),
    });
    expect(result.items[0]!.children?.map((c) => c.id)).toEqual(['detail-a']);
    expect(result.trackRects.has('summary')).toBe(false);
  });

  it('recurses through nested groups; folded child swaps to its summary while parent stays expanded', () => {
    const viewport = makeViewport();
    const child: TrackGroup = {
      kind: 'group',
      id: 'child',
      label: 'Child',
      tracks: [stubTrack({ id: 'child-detail', naturalHeight: 40 })],
      summaryTrack: stubTrack({ id: 'child-summary', naturalHeight: 14 }),
    };
    const parent: TrackGroup = {
      kind: 'group',
      id: 'parent',
      label: 'Parent',
      tracks: [stubTrack({ id: 'parent-leaf', naturalHeight: 10 }), child],
      summaryTrack: stubTrack({ id: 'parent-summary', naturalHeight: 18 }),
    };
    const result = layoutTracks({
      tracks: [parent],
      viewport,
      data: new Map(),
      totalHeightBudget: 200,
      collapsedGroupIds: new Set(['child']),
    });
    // Parent stays expanded → its children list includes the leaf + the
    // (still-a-group) child whose own children collapsed to its summary.
    const parentItem = result.items[0]!;
    expect(parentItem.children?.map((c) => c.id)).toEqual(['parent-leaf', 'child']);
    const childItem = parentItem.children!.find((c) => c.id === 'child')!;
    expect(childItem.kind).toBe('group');
    expect(childItem.children?.map((c) => c.id)).toEqual(['child-summary']);
    expect(result.trackRects.get('child-summary')!.yBottom - result.trackRects.get('child-summary')!.yTop).toBe(14);
    expect(result.trackRects.has('child-detail')).toBe(false);
  });

  it('folding the parent swaps the whole subtree for the parent summary, regardless of child fold state', () => {
    const viewport = makeViewport();
    const child: TrackGroup = {
      kind: 'group',
      id: 'child',
      label: 'Child',
      tracks: [stubTrack({ id: 'child-detail', naturalHeight: 40 })],
      summaryTrack: stubTrack({ id: 'child-summary', naturalHeight: 14 }),
    };
    const parent: TrackGroup = {
      kind: 'group',
      id: 'parent',
      label: 'Parent',
      tracks: [child],
      summaryTrack: stubTrack({ id: 'parent-summary', naturalHeight: 18 }),
    };
    const result = layoutTracks({
      tracks: [parent],
      viewport,
      data: new Map(),
      totalHeightBudget: 200,
      // Both parent + child are in the set, but the parent's fold wins —
      // its subtree is skipped wholesale in favour of the parent summary.
      collapsedGroupIds: new Set(['parent', 'child']),
    });
    expect(result.items[0]!.children?.map((c) => c.id)).toEqual(['parent-summary']);
    expect(result.trackRects.has('child-summary')).toBe(false);
    expect(result.trackRects.has('child-detail')).toBe(false);
  });

  it('reserves a header row at the top of each group via TrackGroup.headerHeight (RD-1110)', () => {
    const viewport = makeViewport();
    const child: TrackGroup = {
      kind: 'group',
      id: 'child',
      label: 'Child',
      headerHeight: 20,
      tracks: [stubTrack({ id: 'leaf', naturalHeight: 16 })],
    };
    const parent: TrackGroup = {
      kind: 'group',
      id: 'parent',
      label: 'Parent',
      headerHeight: 20,
      tracks: [child],
    };
    const result = layoutTracks({
      tracks: [parent],
      viewport,
      data: new Map(),
      totalHeightBudget: 200,
    });
    const parentItem = result.items[0]!;
    expect(parentItem.headerHeight).toBe(20);
    expect(parentItem.rect.yTop).toBe(0);
    // Parent body starts at 20 (parent header). Child body starts at 40
    // (parent header + child header). Leaf at 40..56.
    const childItem = parentItem.children![0]!;
    expect(childItem.rect.yTop).toBe(20);
    expect(childItem.headerHeight).toBe(20);
    const leafRect = result.trackRects.get('leaf')!;
    expect(leafRect.yTop).toBe(40);
    expect(leafRect.yBottom).toBe(56);
    expect(parentItem.rect.yBottom).toBe(56);
  });

  it('skips headerHeight reservation while a group is folded so label + summary share the row (RD-1110)', () => {
    const viewport = makeViewport();
    const group: TrackGroup = {
      kind: 'group',
      id: 'g',
      label: 'G',
      headerHeight: 22,
      tracks: [stubTrack({ id: 'detail', naturalHeight: 60 })],
      summaryTrack: stubTrack({ id: 'summary', naturalHeight: 18 }),
    };
    const result = layoutTracks({
      tracks: [group],
      viewport,
      data: new Map(),
      totalHeightBudget: 200,
      collapsedGroupIds: new Set(['g']),
    });
    // Folded group: no header reservation; summary starts flush with
    // the group's top y so the gutter chevron lines up with the strip.
    expect(result.items[0]!.headerHeight).toBe(0);
    expect(result.trackRects.get('summary')!.yTop).toBe(0);
    expect(result.trackRects.get('summary')!.yBottom).toBe(18);
  });

  it('falls back to zero rows when a folded group has no summaryTrack', () => {
    const viewport = makeViewport();
    const group: TrackGroup = {
      kind: 'group',
      id: 'g',
      label: 'Group',
      tracks: [stubTrack({ id: 'detail', naturalHeight: 40 })],
    };
    const result = layoutTracks({
      tracks: [stubTrack({ id: 'top', naturalHeight: 10 }), group],
      viewport,
      data: new Map(),
      totalHeightBudget: 200,
      collapsedGroupIds: new Set(['g']),
    });
    // Group consumes zero vertical real estate; the top track is the only
    // thing the totalHeight reflects.
    expect(result.totalHeight).toBe(10);
    expect(result.items[1]!.rect.yTop).toBe(result.items[1]!.rect.yBottom);
    expect(result.trackRects.has('detail')).toBe(false);
  });

  it('passes the remaining budget as hint.maxPx to each track', () => {
    const viewport = makeViewport();
    const seenHints: number[] = [];
    const probe: Track = {
      id: 'probe',
      coordSystem: 'cds',
      heightPolicy: 'fixed',
      async load() {
        return null;
      },
      height({ hint }) {
        seenHints.push(hint.maxPx);
        return { px: 25, didTruncate: false };
      },
      render() {
        return null;
      },
      toJSON() {
        return {};
      },
    };
    layoutTracks({
      tracks: [stubTrack({ id: 'a', naturalHeight: 30 }), probe, stubTrack({ id: 'b', naturalHeight: 40 })],
      viewport,
      data: new Map(),
      totalHeightBudget: 200,
    });
    expect(seenHints).toEqual([170]); // 200 - 30
  });
});
