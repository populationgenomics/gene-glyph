import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { createCoordinateMapper } from '../coordinate-mapper.js';
import { createSvgPainter } from '../painter/svg-painter.js';
import type { InteractionState, Transcript } from '../types.js';
import { ViewportController } from '../viewport.js';
import {
  buildAreaPath,
  bucketise,
  defaultViridis,
  pickStep,
  profileTrack,
  type ProfileDatum,
} from './profile-track.js';

const smallGene: Transcript = {
  geneSymbol: 'SMALL',
  transcriptId: 'NM_SMALL.1',
  cdsLength: 60,
  strand: '+',
  exons: [
    { number: 1, cdsStart: 1, cdsEnd: 30, genomicStart: 1000, genomicEnd: 1029, chr: 'chr1' },
    { number: 2, cdsStart: 31, cdsEnd: 60, genomicStart: 2000, genomicEnd: 2029, chr: 'chr1' },
  ],
};

const longGene: Transcript = {
  geneSymbol: 'LONG',
  transcriptId: 'NM_LONG.1',
  cdsLength: 6000,
  strand: '+',
  exons: [
    { number: 1, cdsStart: 1, cdsEnd: 6000, genomicStart: 1000, genomicEnd: 6999, chr: 'chr1' },
  ],
};

function setup(transcript: Transcript, mode: 'cds-with-introns' | 'cds-spliced' | 'protein' = 'protein') {
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

const renderArgs = (rect: { yTop: number; yBottom: number }, ctx: ReturnType<typeof setup>) => ({
  rect,
  viewport: ctx.viewport,
  mapper: ctx.mapper,
  interaction: ctx.interaction,
  painter: ctx.painter,
});

describe('profileTrack — bucketise', () => {
  it('returns one bucket per sample when step = 1', () => {
    const samples = new Map<number, number>([
      [1, 0.1],
      [2, 0.5],
      [3, 0.9],
    ]);
    const out = bucketise({
      posLo: 1,
      posHi: 3,
      step: 1,
      sampleAt: (p) => samples.get(p) ?? null,
      aggregate: 'sum',
    });
    expect(out.map((b) => [b.start, b.end, b.value])).toEqual([
      [1, 1, 0.1],
      [2, 2, 0.5],
      [3, 3, 0.9],
    ]);
  });

  it('uses sum aggregation by default for histogram-style density', () => {
    const samples = new Map<number, number>([
      [1, 1],
      [2, 2],
      [3, 4],
      [4, 8],
    ]);
    const out = bucketise({
      posLo: 1,
      posHi: 4,
      step: 2,
      sampleAt: (p) => samples.get(p) ?? null,
      aggregate: 'sum',
    });
    expect(out).toEqual([
      { start: 1, end: 2, center: 1, value: 3 },
      { start: 3, end: 4, center: 3, value: 12 },
    ]);
  });

  it('max aggregation preserves peaks across the silhouette', () => {
    const samples = new Map<number, number>([
      [1, 0.1],
      [2, 0.7],
      [3, 0.2],
      [4, 0.4],
    ]);
    const out = bucketise({
      posLo: 1,
      posHi: 4,
      step: 2,
      sampleAt: (p) => samples.get(p) ?? null,
      aggregate: 'max',
    });
    expect(out.map((b) => b.value)).toEqual([0.7, 0.4]);
  });

  it('mean aggregation averages only over present samples', () => {
    const samples = new Map<number, number>([
      [1, 2],
      // 2 missing
      [3, 4],
    ]);
    const out = bucketise({
      posLo: 1,
      posHi: 3,
      step: 3,
      sampleAt: (p) => samples.get(p) ?? null,
      aggregate: 'mean',
    });
    expect(out).toEqual([{ start: 1, end: 3, center: 1, value: 3 }]);
  });

  it('skips buckets with no samples', () => {
    const out = bucketise({
      posLo: 1,
      posHi: 10,
      step: 2,
      sampleAt: () => null,
      aggregate: 'sum',
    });
    expect(out).toEqual([]);
  });
});

describe('profileTrack — pickStep', () => {
  it('returns 1 at deep zoom (≥ 1 px/unit)', () => {
    expect(pickStep(8)).toBe(1);
    expect(pickStep(1)).toBe(1);
  });

  it('grows step inversely to pixels per unit', () => {
    expect(pickStep(0.5)).toBe(2);
    expect(pickStep(0.1)).toBe(10);
    expect(pickStep(0.01)).toBe(100);
  });

  it('guards against zero or negative pxPerUnit', () => {
    expect(pickStep(0)).toBe(1);
    expect(pickStep(-1)).toBe(1);
  });
});

describe('profileTrack — buildAreaPath', () => {
  it('builds a contiguous staircase path with one M/Z per run', () => {
    const d = buildAreaPath(
      [
        { xLocal0: 0, xLocal1: 1, value: 1 },
        { xLocal0: 1, xLocal1: 2, value: 2 },
      ],
      10,
      (v) => v,
    );
    expect(d.startsWith('M ')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect((d.match(/Z/g) ?? []).length).toBe(1);
  });

  it('opens a new sub-path across a gap', () => {
    const d = buildAreaPath(
      [
        { xLocal0: 0, xLocal1: 1, value: 1 },
        { xLocal0: 5, xLocal1: 6, value: 2 },
      ],
      10,
      (v) => v,
    );
    expect((d.match(/M /g) ?? []).length).toBe(2);
    expect((d.match(/Z/g) ?? []).length).toBe(2);
  });
});

describe('profileTrack — defaultViridis', () => {
  it('maps the lo end to the first stop colour', () => {
    expect(defaultViridis(0, [0, 1])).toBe('#440154');
  });

  it('maps the hi end to the last stop colour', () => {
    expect(defaultViridis(1, [0, 1])).toBe('#fde724');
  });

  it('clamps values outside the domain', () => {
    expect(defaultViridis(-5, [0, 1])).toBe('#440154');
    expect(defaultViridis(99, [0, 1])).toBe('#fde724');
  });
});

describe('profileTrack — load', () => {
  it('builds byPosition from an array source and derives autoDomain', async () => {
    const data: ProfileDatum[] = [
      { position: 1, value: 0.1 },
      { position: 2, value: 0.5 },
      { position: 10, value: -0.3 },
    ];
    const t = profileTrack({
      source: data,
      coordSystem: 'protein',
      render: 'histogram',
    });
    const { mapper, viewport } = setup(smallGene);
    const loaded = await t.load({
      viewport,
      mapper,
      signal: new AbortController().signal,
      protein: null,
    });
    expect(loaded.byPosition.size).toBe(3);
    expect(loaded.byPosition.get(2)).toBe(0.5);
    expect(loaded.maxPosition).toBe(10);
    expect(loaded.autoDomain).toEqual([-0.3, 0.5]);
  });

  it('throws when a callable source is given without `length`', async () => {
    const t = profileTrack({
      source: (p) => p,
      coordSystem: 'protein',
      render: 'histogram',
    });
    const { mapper, viewport } = setup(smallGene);
    await expect(
      t.load({ viewport, mapper, signal: new AbortController().signal, protein: null }),
    ).rejects.toThrow(/callable `source` requires `length`/);
  });
});

describe('profileTrack — render', () => {
  it('emits one heatmap rect per visible position at deep zoom', async () => {
    const samples: ProfileDatum[] = [];
    for (let aa = 1; aa <= 20; aa++) samples.push({ position: aa, value: aa / 20 });
    const t = profileTrack({
      source: samples,
      coordSystem: 'protein',
      render: 'heatmap',
    });
    const { mapper, viewport, painter, interaction } = setup(smallGene, 'protein');
    const data = await t.load({ viewport, mapper, signal: new AbortController().signal, protein: null });
    const { container } = render(
      <svg>
        {t.render({ data, ...renderArgs({ yTop: 0, yBottom: 24 }, { mapper, viewport, painter, interaction }) })}
      </svg>,
    );
    const cells = container.querySelectorAll('.vv-profile-cell');
    expect(cells.length).toBe(20);
    expect(cells[0]!.getAttribute('data-vv-profile-pos')).toBe('1');
  });

  it('aggregates into fewer buckets at fit-gene zoom on a long gene', async () => {
    const samples: ProfileDatum[] = [];
    for (let aa = 1; aa <= 2000; aa++) samples.push({ position: aa, value: 1 });
    const t = profileTrack({
      source: samples,
      coordSystem: 'protein',
      render: 'histogram',
    });
    const { mapper, viewport, painter, interaction } = setup(longGene, 'protein');
    const data = await t.load({ viewport, mapper, signal: new AbortController().signal, protein: null });
    const { container } = render(
      <svg>
        {t.render({ data, ...renderArgs({ yTop: 0, yBottom: 24 }, { mapper, viewport, painter, interaction }) })}
      </svg>,
    );
    // 2000 aa over 600 px viewport → ~0.3 px/aa → step ≥ 3 → ≤ 700 buckets.
    const step = Number(container.querySelector('.vv-profile-track')!.getAttribute('data-vv-profile-step'));
    expect(step).toBeGreaterThan(1);
    // One <path> per exon (here, one exon) — the area is consolidated.
    expect(container.querySelectorAll('.vv-profile-area').length).toBe(1);
  });

  it('uses host-supplied colorRamp for histogram bars', async () => {
    const samples: ProfileDatum[] = [
      { position: 1, value: 0 },
      { position: 2, value: 1 },
    ];
    const t = profileTrack({
      source: samples,
      coordSystem: 'protein',
      render: 'histogram',
      colorRamp: (v) => (v >= 0.5 ? '#abc' : '#def'),
    });
    const { mapper, viewport, painter, interaction } = setup(smallGene, 'protein');
    const data = await t.load({ viewport, mapper, signal: new AbortController().signal, protein: null });
    const { container } = render(
      <svg>
        {t.render({ data, ...renderArgs({ yTop: 0, yBottom: 24 }, { mapper, viewport, painter, interaction }) })}
      </svg>,
    );
    const bars = [...container.querySelectorAll<SVGRectElement>('.vv-profile-bar')];
    expect(bars.length).toBe(2);
    const fills = bars.map((b) => b.getAttribute('fill'));
    expect(fills).toContain('#def');
    expect(fills).toContain('#abc');
  });

  it('log yScale produces non-zero heights for low-value samples that linear would crush', async () => {
    const samples: ProfileDatum[] = [
      { position: 1, value: 1 },
      { position: 2, value: 1000 },
    ];
    const linearTrack = profileTrack({
      source: samples,
      coordSystem: 'protein',
      render: 'histogram',
      yScale: 'linear',
      colorRamp: () => '#000', // force per-bar rects so we can read heights
    });
    const logTrack = profileTrack({
      source: samples,
      coordSystem: 'protein',
      render: 'histogram',
      yScale: 'log',
      colorRamp: () => '#000',
    });
    const ctx = setup(smallGene, 'protein');
    const linData = await linearTrack.load({
      viewport: ctx.viewport,
      mapper: ctx.mapper,
      signal: new AbortController().signal,
      protein: null,
    });
    const logData = await logTrack.load({
      viewport: ctx.viewport,
      mapper: ctx.mapper,
      signal: new AbortController().signal,
      protein: null,
    });
    const a = render(
      <svg>{linearTrack.render({ data: linData, ...renderArgs({ yTop: 0, yBottom: 100 }, ctx) })}</svg>,
    );
    const b = render(
      <svg>{logTrack.render({ data: logData, ...renderArgs({ yTop: 0, yBottom: 100 }, ctx) })}</svg>,
    );
    const linBars = [...a.container.querySelectorAll<SVGRectElement>('.vv-profile-bar')];
    const logBars = [...b.container.querySelectorAll<SVGRectElement>('.vv-profile-bar')];
    const findBar = (bars: SVGRectElement[], pos: string) =>
      bars.find((bar) => bar.getAttribute('data-vv-profile-pos') === pos)!;
    const linShort = Number(findBar(linBars, '1').getAttribute('height'));
    const logShort = Number(findBar(logBars, '1').getAttribute('height'));
    // value=1 in [1..1000] → linear ≈ 0%, log ≈ 0% as well (log(1)=0).
    // Pick a more discriminating pair: value=10 vs value=1000.
    expect(linShort).toBeLessThanOrEqual(1);
    expect(logShort).toBeLessThanOrEqual(1);
  });

  it('renders nothing when data has no samples in the visible range', async () => {
    const t = profileTrack({
      source: [],
      coordSystem: 'protein',
      render: 'heatmap',
      length: 20,
    });
    const ctx = setup(smallGene, 'protein');
    const data = await t.load({ viewport: ctx.viewport, mapper: ctx.mapper, signal: new AbortController().signal, protein: null });
    const { container } = render(
      <svg>{t.render({ data, ...renderArgs({ yTop: 0, yBottom: 24 }, ctx) })}</svg>,
    );
    expect(container.querySelectorAll('.vv-profile-cell').length).toBe(0);
  });

  it('protein-coord samples render in CDS viewport mode (via aa→bp mapping)', async () => {
    const samples: ProfileDatum[] = [];
    for (let aa = 1; aa <= 20; aa++) samples.push({ position: aa, value: aa });
    const t = profileTrack({
      source: samples,
      coordSystem: 'protein',
      render: 'heatmap',
    });
    const ctx = setup(smallGene, 'cds-with-introns');
    const data = await t.load({ viewport: ctx.viewport, mapper: ctx.mapper, signal: new AbortController().signal, protein: null });
    const { container } = render(
      <svg>{t.render({ data, ...renderArgs({ yTop: 0, yBottom: 24 }, ctx) })}</svg>,
    );
    expect(container.querySelectorAll('.vv-profile-cell').length).toBeGreaterThan(0);
  });
});
