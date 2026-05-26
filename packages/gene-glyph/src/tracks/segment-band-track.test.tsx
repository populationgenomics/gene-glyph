import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { createCoordinateMapper } from '../coordinate-mapper.js';
import { createSvgPainter } from '../painter/svg-painter.js';
import type { InteractionState, Transcript } from '../types.js';
import { ViewportController } from '../viewport.js';
import {
  segmentBandTrack,
  type SegmentBandDatum,
} from './segment-band-track.js';

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

function setup(mode: 'genome' | 'transcript' | 'protein' = 'protein') {
  const mapper = createCoordinateMapper(transcript);
  const viewport = new ViewportController({ mapper, width: 600, mode });
  const painter = createSvgPainter({ mode: 'screen' });
  const interaction: InteractionState = {
    hoveredFeatureId: null,
    selectedFeatureIds: new Set(),
    brushRange: null,
  };
  return { mapper, viewport, painter, interaction };
}

type RmcCategory = 'low' | 'high';

const palette: Record<RmcCategory, string> = {
  low: '#fee2e2',
  high: '#7f1d1d',
};

describe('segmentBandTrack', () => {
  it('sorts segments by start at load time', async () => {
    const data: SegmentBandDatum<RmcCategory>[] = [
      { start: 50, end: 70, category: 'low' },
      { start: 5, end: 20, category: 'high' },
      { start: 30, end: 40, category: 'low' },
    ];
    const t = segmentBandTrack({ source: data, coordSystem: 'protein', palette });
    const ctx = setup();
    const loaded = await t.load({
      viewport: ctx.viewport,
      mapper: ctx.mapper,
      signal: new AbortController().signal,
      protein: null,
    });
    expect(loaded.segments.map((s) => s.start)).toEqual([5, 30, 50]);
  });

  it('calls onOverlapWarning for overlapping inputs', async () => {
    const data: SegmentBandDatum<RmcCategory>[] = [
      { start: 1, end: 30, category: 'low' },
      { start: 25, end: 40, category: 'high' },
      { start: 50, end: 60, category: 'low' },
    ];
    const onOverlapWarning = vi.fn();
    const t = segmentBandTrack({
      source: data,
      coordSystem: 'protein',
      palette,
      onOverlapWarning,
    });
    const ctx = setup();
    await t.load({
      viewport: ctx.viewport,
      mapper: ctx.mapper,
      signal: new AbortController().signal,
      protein: null,
    });
    expect(onOverlapWarning).toHaveBeenCalledTimes(1);
    expect(onOverlapWarning.mock.calls[0]![0]!.start).toBe(1);
    expect(onOverlapWarning.mock.calls[0]![1]!.start).toBe(25);
  });

  it('renders one rect per intersected exon for a span that bridges exons', async () => {
    const data: SegmentBandDatum<RmcCategory>[] = [
      // aa 30..40 → CDS 88..120 → spans exon 0 (cdsEnd=100) and exon 1.
      { start: 30, end: 40, category: 'high' },
    ];
    const t = segmentBandTrack({ source: data, coordSystem: 'protein', palette });
    const ctx = setup('genome');
    const loaded = await t.load({
      viewport: ctx.viewport,
      mapper: ctx.mapper,
      signal: new AbortController().signal,
      protein: null,
    });
    const { container } = render(
      <svg>
        {t.render({
          data: loaded,
          rect: { yTop: 0, yBottom: 14 },
          viewport: ctx.viewport,
          mapper: ctx.mapper,
          interaction: ctx.interaction,
          painter: ctx.painter,
        })}
      </svg>,
    );
    const rects = container.querySelectorAll('.vv-segment-band-rect');
    expect(rects.length).toBe(2);
  });

  it('skips rendering a segment whose category is absent from the palette', async () => {
    const data: SegmentBandDatum<string>[] = [
      // aa 5..10 fits inside exon 0 (CDS 13..30).
      { start: 5, end: 10, category: 'mystery' },
      { start: 15, end: 25, category: 'low' },
    ];
    const t = segmentBandTrack({
      source: data,
      coordSystem: 'protein',
      palette: palette as Record<string, string>,
    });
    const ctx = setup();
    const loaded = await t.load({
      viewport: ctx.viewport,
      mapper: ctx.mapper,
      signal: new AbortController().signal,
      protein: null,
    });
    const { container } = render(
      <svg>
        {t.render({
          data: loaded,
          rect: { yTop: 0, yBottom: 14 },
          viewport: ctx.viewport,
          mapper: ctx.mapper,
          interaction: ctx.interaction,
          painter: ctx.painter,
        })}
      </svg>,
    );
    const rects = container.querySelectorAll('.vv-segment-band-rect');
    expect(rects.length).toBe(1);
  });

  it('only emits a label when the segment is wider than minLabelWidthPx', async () => {
    const data: SegmentBandDatum<RmcCategory>[] = [
      { start: 1, end: 100, category: 'high', label: 'wide' },
      { start: 101, end: 102, category: 'low', label: 'narrow' },
    ];
    const t = segmentBandTrack({
      source: data,
      coordSystem: 'protein',
      palette,
      showLabels: true,
      minLabelWidthPx: 50,
    });
    const ctx = setup();
    const loaded = await t.load({
      viewport: ctx.viewport,
      mapper: ctx.mapper,
      signal: new AbortController().signal,
      protein: null,
    });
    const { container } = render(
      <svg>
        {t.render({
          data: loaded,
          rect: { yTop: 0, yBottom: 14 },
          viewport: ctx.viewport,
          mapper: ctx.mapper,
          interaction: ctx.interaction,
          painter: ctx.painter,
        })}
      </svg>,
    );
    const labels = container.querySelectorAll('.vv-segment-band-label');
    expect(labels.length).toBe(1);
    expect(labels[0]!.textContent).toBe('wide');
  });

  it('resolves feature labels via the standard track hook', async () => {
    const data: SegmentBandDatum<RmcCategory>[] = [
      { id: 'rmc-A', start: 5, end: 20, category: 'high', label: 'Region A' },
    ];
    const t = segmentBandTrack({ source: data, coordSystem: 'protein', palette });
    const ctx = setup();
    const loaded = await t.load({
      viewport: ctx.viewport,
      mapper: ctx.mapper,
      signal: new AbortController().signal,
      protein: null,
    });
    expect(t.featureLabel?.(loaded, 'rmc-A')).toBe('Region A (5–20)');
    expect(t.resolveFeature?.(loaded, 'rmc-A')).toEqual(data[0]);
  });
});
