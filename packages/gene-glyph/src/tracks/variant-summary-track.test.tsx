import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { createCoordinateMapper } from '../coordinate-mapper.js';
import { createSvgPainter } from '../painter/svg-painter.js';
import { ViewportController } from '../viewport.js';
import type {
  InteractionState,
  Transcript,
  ViewerVariant,
} from '../types.js';
import { variantSummaryTrack } from './variant-summary-track.js';

const transcript: Transcript = {
  geneSymbol: 'TEST',
  transcriptId: 'NM_TEST.1',
  cdsLength: 300,
  strand: '+',
  exons: [
    { number: 1, cdsStart: 1, cdsEnd: 100, genomicStart: 1000, genomicEnd: 1099, chr: 'chr1' },
    { number: 2, cdsStart: 101, cdsEnd: 200, genomicStart: 2000, genomicEnd: 2099, chr: 'chr1' },
    { number: 3, cdsStart: 201, cdsEnd: 300, genomicStart: 3000, genomicEnd: 3099, chr: 'chr1' },
  ],
};

const variants: ViewerVariant[] = [
  { id: 'v1', label: 'V1', coord: { kind: 'cds', cPos: 50, offset: 0 }, category: 'missense' },
  { id: 'v2', label: 'V2', coord: { kind: 'cds', cPos: 150, offset: 0 }, category: 'nonsense' },
  { id: 'v3-intronic', label: 'V3', coord: { kind: 'cds', cPos: 100, offset: 5 }, category: 'splice' },
];

function emptyInteraction(): InteractionState {
  return { hoveredFeatureId: null, selectedFeatureIds: new Set(), brushRange: null };
}

describe('variantSummaryTrack', () => {
  it('declares fixed height and a default of 16 px', async () => {
    const track = variantSummaryTrack({ source: variants });
    const mapper = createCoordinateMapper(transcript);
    const viewport = new ViewportController({ mapper, width: 720, mode: 'transcript' });
    const data = await track.load({
      viewport,
      mapper,
      signal: new AbortController().signal,
      protein: null,
    });
    const result = track.height({ data, viewport, hint: { maxPx: 100 } });
    expect(track.heightPolicy).toBe('fixed');
    expect(result.px).toBe(16);
    expect(result.didTruncate).toBe(false);
  });

  it('respects a custom height override', async () => {
    const track = variantSummaryTrack({ source: variants, height: 22 });
    const mapper = createCoordinateMapper(transcript);
    const viewport = new ViewportController({ mapper, width: 720, mode: 'transcript' });
    const data = await track.load({
      viewport,
      mapper,
      signal: new AbortController().signal,
      protein: null,
    });
    expect(track.height({ data, viewport, hint: { maxPx: 100 } }).px).toBe(22);
  });

  it('emits one rug tick per placed variant, category-coloured', () => {
    const mapper = createCoordinateMapper(transcript);
    const viewport = new ViewportController({ mapper, width: 720, mode: 'transcript' });
    const painter = createSvgPainter({ mode: 'screen' });
    const track = variantSummaryTrack({ source: variants });
    const data = { variants };
    const node = track.render({
      data,
      rect: { yTop: 0, yBottom: 16 },
      viewport,
      mapper,
      interaction: emptyInteraction(),
      painter,
    });
    const { container } = render(
      <svg viewBox="0 0 720 16" width={720} height={16}>
        {node}
      </svg>,
    );
    const ticks = container.querySelectorAll('.vv-variant-summary-tick');
    // v3 is intronic — partitionVariants drops it; v1 + v2 stay.
    expect(ticks).toHaveLength(2);
    const ids = [...ticks].map((t) => t.getAttribute('data-vv-feature-id')).sort();
    expect(ids).toEqual(['v1', 'v2']);
    const categories = [...ticks]
      .map((t) => t.getAttribute('data-vv-category'))
      .sort();
    expect(categories).toEqual(['missense', 'nonsense']);
  });

  it('queries a DataSource source through the viewport', async () => {
    const calls: { range: readonly [number, number] }[] = [];
    const track = variantSummaryTrack({
      source: {
        id: 'variant-summary-test',
        cacheKey: ({ range }) => `${range[0]}:${range[1]}`,
        query: async (q) => {
          calls.push({ range: q.range });
          return variants;
        },
      },
    });
    const mapper = createCoordinateMapper(transcript);
    const viewport = new ViewportController({ mapper, width: 720, mode: 'transcript' });
    const data = await track.load({
      viewport,
      mapper,
      signal: new AbortController().signal,
      protein: null,
    });
    expect(calls).toHaveLength(1);
    expect(data.variants).toHaveLength(3);
  });
});
