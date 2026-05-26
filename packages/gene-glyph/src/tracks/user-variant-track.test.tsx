import { describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import { createCoordinateMapper } from '../coordinate-mapper.js';
import { createSvgPainter } from '../painter/svg-painter.js';
import type { InteractionState, Transcript } from '../types.js';
import { ViewportController } from '../viewport.js';
import {
  userVariantFromRecord,
  userVariantTrack,
  type UserVariantRecord,
} from './user-variant-track.js';

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

const records: UserVariantRecord[] = [
  { id: '1-1009-C-A', chr: 'chr1', pos: 1009, label: '1-1009-C-A' },
  { id: '1-2049-G-T', chr: 'chr1', pos: 2049 },
];

function setup() {
  const mapper = createCoordinateMapper(transcript);
  const viewport = new ViewportController({ mapper, width: 720, mode: 'genome' });
  const painter = createSvgPainter({ mode: 'screen' });
  const interaction: InteractionState = {
    hoveredFeatureId: null,
    selectedFeatureIds: new Set(),
    brushRange: null,
  };
  return { mapper, viewport, painter, interaction };
}

describe('userVariantTrack', () => {
  it('loads via the eager-array source path and renders one row per record', async () => {
    const { viewport, mapper, painter, interaction } = setup();
    const track = userVariantTrack({ source: records, markRadius: 4 });
    const data = await track.load({ viewport, mapper, signal: new AbortController().signal, protein: null });
    expect(data.records).toHaveLength(2);
    // The stacked layout packs both records into the same lane block;
    // they sit far apart so they fit in row 0.
    expect(data.stackLayout?.rowCount).toBe(1);

    const rect = { yTop: 0, yBottom: 28 };
    const ui = track.render({
      data,
      rect,
      viewport,
      mapper,
      interaction,
      painter,
    });
    const { container } = render(<svg>{ui as React.ReactNode}</svg>);
    const marks = container.querySelectorAll('.vv-clinvar-mark');
    expect(marks.length).toBe(2);
    // Each glyph carries the user-variant id straight through (no
    // adapter renaming).
    const ids = Array.from(marks).map((m) => m.getAttribute('data-vv-feature-id'));
    expect(ids).toEqual(expect.arrayContaining(['1-1009-C-A', '1-2049-G-T']));
  });

  it('resolveFeature / featureLabel hand back the host-shaped record (no synthetic significance)', async () => {
    const { viewport, mapper } = setup();
    const track = userVariantTrack({ source: records });
    const data = await track.load({ viewport, mapper, signal: new AbortController().signal, protein: null });
    const r = track.resolveFeature!(data, '1-1009-C-A');
    expect(r).toMatchObject({ id: '1-1009-C-A', chr: 'chr1', pos: 1009 });
    expect((r as object)).not.toHaveProperty('significance');
    expect(track.featureLabel!(data, '1-1009-C-A')).toBe('1-1009-C-A');
  });

  it('renders multi-bp variants with a horizontal span line', async () => {
    const { viewport, mapper, painter, interaction } = setup();
    const track = userVariantTrack({
      source: [{ id: '1-1010-AAAA-A', chr: 'chr1', pos: 1010, refLen: 4 }],
    });
    const data = await track.load({ viewport, mapper, signal: new AbortController().signal, protein: null });
    const ui = track.render({
      data,
      rect: { yTop: 0, yBottom: 28 },
      viewport,
      mapper,
      interaction,
      painter,
    });
    const { container } = render(<svg>{ui as React.ReactNode}</svg>);
    expect(container.querySelector('.vv-clinvar-span')).not.toBeNull();
  });

  it('supports DataSource-shaped sources', async () => {
    const { viewport, mapper } = setup();
    let calls = 0;
    const track = userVariantTrack({
      source: {
        id: 'user-variants',
        cacheKey: () => 'k',
        async query() {
          calls += 1;
          return [{ id: '1-1009-C-A', chr: 'chr1', pos: 1009 }];
        },
      },
    });
    const data = await track.load({ viewport, mapper, signal: new AbortController().signal, protein: null });
    expect(calls).toBe(1);
    expect(data.records).toHaveLength(1);
    expect(data.records[0]!.id).toBe('1-1009-C-A');
  });

  it('records whose chr / pos miss every exon drop silently from the figure', async () => {
    const { viewport, mapper, painter, interaction } = setup();
    const track = userVariantTrack({
      source: [
        { id: '2-100-C-T', chr: 'chr2', pos: 100 }, // wrong chr
        { id: '1-999999-C-T', chr: 'chr1', pos: 999999 }, // way past last exon
        { id: '1-1009-C-A', chr: 'chr1', pos: 1009 }, // on exon 1
      ],
    });
    const data = await track.load({ viewport, mapper, signal: new AbortController().signal, protein: null });
    const ui = track.render({
      data,
      rect: { yTop: 0, yBottom: 28 },
      viewport,
      mapper,
      interaction,
      painter,
    });
    const { container } = render(<svg>{ui as React.ReactNode}</svg>);
    const marks = container.querySelectorAll('.vv-clinvar-mark');
    expect(marks.length).toBe(1);
    expect(marks[0]!.getAttribute('data-vv-feature-id')).toBe('1-1009-C-A');
  });

  it('userVariantFromRecord round-trips the adapted record', async () => {
    const { viewport, mapper } = setup();
    const original: UserVariantRecord = {
      id: '1-1009-C-A',
      chr: 'chr1',
      pos: 1009,
      meta: { raw: '1-1009-C-A' },
    };
    const track = userVariantTrack({ source: [original] });
    const data = await track.load({ viewport, mapper, signal: new AbortController().signal, protein: null });
    expect(data.records[0]).toBeDefined();
    const recovered = userVariantFromRecord(data.records[0]!);
    expect(recovered).toEqual(original);
  });

  // Smoke-act through a viewport tick so the layout/render path doesn't
  // explode against a stale viewport snapshot.
  it('keeps rendering after a viewport zoom', async () => {
    const { viewport, mapper, painter, interaction } = setup();
    const track = userVariantTrack({ source: records });
    const data = await track.load({ viewport, mapper, signal: new AbortController().signal, protein: null });
    act(() => {
      viewport.setMode('transcript');
    });
    const ui = track.render({
      data,
      rect: { yTop: 0, yBottom: 28 },
      viewport,
      mapper,
      interaction,
      painter,
    });
    const { container } = render(<svg>{ui as React.ReactNode}</svg>);
    expect(container.querySelectorAll('.vv-clinvar-mark').length).toBe(2);
  });
});
