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
