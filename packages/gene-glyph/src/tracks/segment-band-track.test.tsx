import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createCoordinateMapper } from '../coordinate-mapper.js';
import { createSvgPainter } from '../painter/svg-painter.js';
import type { InteractionState, Track, Transcript } from '../types.js';
import { GeneGlyph } from '../viewer.js';
import { ViewportController } from '../viewport.js';
import {
  segmentBandTrack,
  type SegmentBandDatum,
  type SegmentBandTrackConfig,
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

// Mirror of `transcript` on the minus strand: exon 1 (CDS 1..100) is the
// genomically highest.
const minusTranscript: Transcript = {
  geneSymbol: 'TEST',
  transcriptId: 'NM_TESTMINUS.1',
  cdsLength: 300,
  strand: '-',
  exons: [
    { number: 1, cdsStart: 1, cdsEnd: 100, genomicStart: 3000, genomicEnd: 3099, chr: 'chr1' },
    { number: 2, cdsStart: 101, cdsEnd: 200, genomicStart: 2000, genomicEnd: 2099, chr: 'chr1' },
    { number: 3, cdsStart: 201, cdsEnd: 300, genomicStart: 1000, genomicEnd: 1099, chr: 'chr1' },
  ],
};

interface RenderedRect {
  exonIdx: number;
  x: number;
  width: number;
}

/** Load and render a band track; return its rects in exon-local
 *  baseline px (width 600 over 300 CDS bp → 2 px/bp without UTR). */
async function renderBandRects(
  track: ReturnType<typeof segmentBandTrack<RmcCategory>>,
  tx: Transcript,
  mode: 'genome' | 'transcript' | 'protein',
): Promise<RenderedRect[]> {
  const mapper = createCoordinateMapper(tx);
  const viewport = new ViewportController({ mapper, width: 600, mode });
  const loaded = await track.load({
    viewport,
    mapper,
    signal: new AbortController().signal,
    protein: null,
  });
  const { container } = render(
    <svg>
      {track.render({
        data: loaded,
        rect: { yTop: 0, yBottom: 14 },
        viewport,
        mapper,
        interaction: { hoveredFeatureId: null, selectedFeatureIds: new Set(), brushRange: null },
        painter: createSvgPainter({ mode: 'screen' }),
      })}
    </svg>,
  );
  return [...container.querySelectorAll('.vv-segment-band-rect')].map((el) => ({
    exonIdx: Number(el.closest('[data-vv-exon-idx]')!.getAttribute('data-vv-exon-idx')),
    x: Number(el.getAttribute('x')),
    width: Number(el.getAttribute('width')),
  }));
}

function genomicBand(chr: string, start: number, end: number) {
  return segmentBandTrack<RmcCategory>({
    source: [{ chr, start, end, category: 'high' }],
    coordSystem: 'genomic',
    palette,
  });
}

describe('segmentBandTrack — genomic coordinates', () => {
  it('splits a plus-strand span across an intron into one piece per exon', async () => {
    // chr1:1050..2049 → CDS 51..100 in exon 1, CDS 101..150 in exon 2.
    const rects = await renderBandRects(genomicBand('chr1', 1050, 2049), transcript, 'transcript');
    expect(rects).toEqual([
      { exonIdx: 0, x: 100, width: 100 },
      { exonIdx: 1, x: 0, width: 100 },
    ]);
  });

  it('maps a minus-strand span in genomic order onto transcript order', async () => {
    // chr1:2050..3049 → CDS 51..100 in exon 1 (genomic 3000..3049) and
    // CDS 101..150 in exon 2 (genomic 2050..2099).
    const rects = await renderBandRects(
      genomicBand('chr1', 2050, 3049),
      minusTranscript,
      'transcript',
    );
    expect(rects).toEqual([
      { exonIdx: 0, x: 100, width: 100 },
      { exonIdx: 1, x: 0, width: 100 },
    ]);
  });

  it('draws every exon a span covers and none of the introns between them', async () => {
    const rects = await renderBandRects(genomicBand('chr1', 1050, 3049), transcript, 'transcript');
    expect(rects).toEqual([
      { exonIdx: 0, x: 100, width: 100 },
      { exonIdx: 1, x: 0, width: 200 },
      { exonIdx: 2, x: 0, width: 100 },
    ]);
  });

  it.each([
    { name: "5' end", start: 900, end: 1019, expected: { exonIdx: 0, x: 0, width: 40 } },
    { name: "3' end", start: 3080, end: 3200, expected: { exonIdx: 2, x: 160, width: 40 } },
  ])('clips a span overhanging the $name of the transcript', async ({ start, end, expected }) => {
    const rects = await renderBandRects(genomicBand('chr1', start, end), transcript, 'transcript');
    expect(rects).toEqual([expected]);
  });

  it('clips a span upstream of the CDS at the CDS start rather than drawing into the UTR cap', async () => {
    // 100 bp 5'UTR drawn at quarter scale: 325 display bp over 600 px.
    const withUtr: Transcript = {
      ...transcript,
      exons: transcript.exons.map((e, i) => (i === 0 ? { ...e, utr5Bp: 100 } : e)),
    };
    const rects = await renderBandRects(genomicBand('chr1', 900, 1019), withUtr, 'transcript');
    expect(rects).toHaveLength(1);
    expect(rects[0]!.exonIdx).toBe(0);
    expect(rects[0]!.x).toBe(0);
    expect(rects[0]!.width).toBeCloseTo(36.923, 2);
  });

  it.each([
    { name: "5' UTR", start: 950, end: 990 },
    { name: "3' UTR", start: 3110, end: 3150 },
  ])('draws nothing for a span strictly inside the $name', async ({ start, end }) => {
    // UTR caps are drawn but carry no genomic positions: 5'UTR genomically
    // below exon 1's CDS start, 3'UTR above exon 3's CDS end (plus strand).
    const withUtr: Transcript = {
      ...transcript,
      exons: transcript.exons.map((e, i) =>
        i === 0 ? { ...e, utr5Bp: 100 } : i === 2 ? { ...e, utr3Bp: 100 } : e,
      ),
    };
    const rects = await renderBandRects(genomicBand('chr1', start, end), withUtr, 'transcript');
    expect(rects).toEqual([]);
  });

  it.each([
    { name: 'entirely intronic', chr: 'chr1', start: 1200, end: 1800 },
    { name: 'upstream of the transcript', chr: 'chr1', start: 100, end: 900 },
    { name: 'on another chromosome', chr: 'chr2', start: 1050, end: 2049 },
  ])('draws nothing for a span $name', async ({ chr, start, end }) => {
    const rects = await renderBandRects(genomicBand(chr, start, end), transcript, 'genome');
    expect(rects).toEqual([]);
  });

  it.each(['genome', 'transcript', 'protein'] as const)(
    'draws a genomic span where the equivalent CDS span draws in %s mode',
    async (mode) => {
      const cds = segmentBandTrack<RmcCategory>({
        source: [{ start: 51, end: 150, category: 'high' }],
        coordSystem: 'cds',
        palette,
      });
      const genomicRects = await renderBandRects(
        genomicBand('chr1', 2050, 3049),
        minusTranscript,
        mode,
      );
      expect(genomicRects).toHaveLength(2);
      expect(genomicRects).toEqual(await renderBandRects(cds, minusTranscript, mode));
    },
  );

  it('warns only about overlapping spans on the same chromosome', async () => {
    const onOverlapWarning = vi.fn();
    const t = segmentBandTrack<RmcCategory>({
      source: [
        { chr: 'chr1', start: 1000, end: 1050, category: 'low' },
        { chr: 'chr2', start: 1040, end: 1060, category: 'low' },
        { chr: 'chr1', start: 1050, end: 1070, category: 'high' },
      ],
      coordSystem: 'genomic',
      palette,
      onOverlapWarning,
    });
    const mapper = createCoordinateMapper(transcript);
    await t.load({
      viewport: new ViewportController({ mapper, width: 600, mode: 'genome' }),
      mapper,
      signal: new AbortController().signal,
      protein: null,
    });
    expect(onOverlapWarning).toHaveBeenCalledTimes(1);
    expect(onOverlapWarning.mock.calls[0]![0]).toMatchObject({ chr: 'chr1', start: 1000 });
    expect(onOverlapWarning.mock.calls[0]![1]).toMatchObject({ chr: 'chr1', start: 1050 });
  });

  it('names the chromosome in the default feature label', async () => {
    const t = segmentBandTrack<RmcCategory>({
      source: [
        { id: 'fam-2', chr: 'chr1', start: 1050, end: 2049, category: 'high', label: 'Family 2' },
      ],
      coordSystem: 'genomic',
      palette,
    });
    const mapper = createCoordinateMapper(transcript);
    const loaded = await t.load({
      viewport: new ViewportController({ mapper, width: 600, mode: 'transcript' }),
      mapper,
      signal: new AbortController().signal,
      protein: null,
    });
    expect(t.featureLabel?.(loaded, 'fam-2')).toBe('Family 2 (chr1:1050–2049)');
  });

  it('keeps un-id’d spans with equal coordinates on different chromosomes apart', async () => {
    const t = segmentBandTrack<RmcCategory>({
      source: [
        { chr: 'chr1', start: 1050, end: 2049, category: 'high', label: 'On chr1' },
        { chr: 'chr17', start: 1050, end: 2049, category: 'high', label: 'On chr17' },
      ],
      coordSystem: 'genomic',
      palette,
    });
    const loaded = await loadBands(t, transcript);
    expect(t.featureLabel?.(loaded, 'chr17:1050-2049-high')).toBe('On chr17 (chr17:1050–2049)');
  });
});

async function loadBands<D>(
  track: Track<SegmentBandTrackConfig<RmcCategory>, D>,
  tx: Transcript,
): Promise<D> {
  const mapper = createCoordinateMapper(tx);
  return track.load({
    viewport: new ViewportController({ mapper, width: 600, mode: 'transcript' }),
    mapper,
    signal: new AbortController().signal,
    protein: null,
  });
}

describe('segmentBandTrack — overlap detection', () => {
  it('reports a span overlapping an earlier long span past a nested one', async () => {
    const onOverlapWarning = vi.fn();
    const t = segmentBandTrack<RmcCategory>({
      source: [
        { id: 'long', start: 100, end: 500, category: 'low' },
        { id: 'nested-a', start: 150, end: 200, category: 'high' },
        { id: 'nested-b', start: 300, end: 400, category: 'high' },
      ],
      coordSystem: 'cds',
      palette,
      onOverlapWarning,
    });
    await loadBands(t, transcript);
    const pairs = onOverlapWarning.mock.calls.map(([a, b]) => [a.id, b.id]);
    expect(pairs).toEqual([
      ['long', 'nested-a'],
      ['long', 'nested-b'],
    ]);
  });

  it('orders and overlap-checks a reversed span by its lower bound', async () => {
    const onOverlapWarning = vi.fn();
    const t = segmentBandTrack<RmcCategory>({
      source: [
        { id: 'after', start: 60, end: 70, category: 'low' },
        { id: 'reversed', start: 65, end: 10, category: 'high' },
      ],
      coordSystem: 'cds',
      palette,
      onOverlapWarning,
    });
    const loaded = await loadBands(t, transcript);
    expect(loaded.segments.map((s) => s.id)).toEqual(['reversed', 'after']);
    expect(onOverlapWarning).toHaveBeenCalledTimes(1);
    expect(onOverlapWarning.mock.calls[0]![0]!.id).toBe('reversed');
  });
});

describe('segmentBandTrack — protein mode at a split codon', () => {
  // Codon 34 is CDS 100..102: base 100 in exon 1, bases 101..102 in exon 2.
  // Protein mode draws aa 34 in exon 1 (cells: 600 px / 100 aa = 6 px).
  it.each([
    {
      name: 'cds',
      track: segmentBandTrack<RmcCategory>({
        source: [{ start: 101, end: 102, category: 'high' }],
        coordSystem: 'cds',
        palette,
      }),
    },
    { name: 'genomic', track: genomicBand('chr1', 2000, 2001) },
  ])('draws a $name span over only the downstream bases at the codon’s cell', async ({ track }) => {
    const rects = await renderBandRects(track, transcript, 'protein');
    expect(rects).toEqual([{ exonIdx: 0, x: 198, width: 6 }]);
  });
});

/** JSDOM has no SVG screen-CTM; the tooltip positions itself through it. */
function stubScreenCtm(container: HTMLElement): void {
  const svg = container.querySelector<SVGSVGElement>('svg.vv-figure')!;
  const wrap = container.querySelector<HTMLDivElement>('.vv-figure-wrap')!;
  wrap.getBoundingClientRect = () =>
    ({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 60, width: 600, height: 60 }) as DOMRect;
  const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  svg.createSVGPoint = () =>
    ({
      x: 0,
      y: 0,
      matrixTransform(this: { x: number; y: number }) {
        return { x: this.x, y: this.y };
      },
    }) as unknown as SVGPoint;
  svg.getScreenCTM = () => identity as unknown as DOMMatrix;
}

async function flushTrackLoads(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('segmentBandTrack — in GeneGlyph', () => {
  const bands = () =>
    segmentBandTrack<RmcCategory>({
      id: 'regions',
      source: [
        { id: 'fam-2', chr: 'chr1', start: 1050, end: 2049, category: 'high', label: 'Family 2' },
      ],
      coordSystem: 'genomic',
      palette,
    });

  it('shows the default tooltip when a band is hovered', async () => {
    const { container } = render(
      <GeneGlyph transcript={transcript} mode="transcript" tracks={[bands()]} />,
    );
    await flushTrackLoads();
    stubScreenCtm(container);
    const band = container.querySelector('[data-vv-feature-id="fam-2"]')!;
    fireEvent.mouseEnter(band);
    await waitFor(() => {
      expect(container.querySelector('.vv-tooltip')?.textContent).toBe('Family 2 (chr1:1050–2049)');
    });
  });

  it('reports a band click through onFeatureClick with the band’s id', async () => {
    const onFeatureClick = vi.fn();
    const { container } = render(
      <GeneGlyph
        transcript={transcript}
        mode="transcript"
        tracks={[bands()]}
        onFeatureClick={onFeatureClick}
      />,
    );
    await flushTrackLoads();
    fireEvent.click(container.querySelector('[data-vv-feature-id="fam-2"]')!);
    expect(onFeatureClick).toHaveBeenCalledWith('fam-2', 'regions');
  });

  it('lists a span with no drawable base as unplaced, and not a partly drawable one', async () => {
    const withUtr: Transcript = {
      ...transcript,
      exons: transcript.exons.map((e, i) => (i === 0 ? { ...e, utr5Bp: 100 } : e)),
    };
    const track = segmentBandTrack<RmcCategory>({
      id: 'regions',
      source: [
        { id: 'utr-only', chr: 'chr1', start: 950, end: 990, category: 'low', label: 'UTR del' },
        { id: 'partial', chr: 'chr1', start: 950, end: 1019, category: 'high' },
      ],
      coordSystem: 'genomic',
      palette,
    });
    render(<GeneGlyph transcript={withUtr} mode="transcript" tracks={[track]} />);
    await flushTrackLoads();
    const unplaced = screen.getByTestId('regions-unplaced');
    expect(unplaced.querySelector('.vv-unplaced-label')?.textContent).toBe('Unplaced (1)');
    const chips = [...unplaced.querySelectorAll('[data-vv-feature-id]')];
    expect(chips.map((c) => c.getAttribute('data-vv-feature-id'))).toEqual(['utr-only']);
  });
});
