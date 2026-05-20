import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { createCoordinateMapper } from '../coordinate-mapper.js';
import { createSvgPainter } from '../painter/svg-painter.js';
import type {
  DataSource,
  InteractionState,
  Transcript,
  ViewerVariant,
  ViewportQuery,
} from '../types.js';
import { ViewportController } from '../viewport.js';
import {
  packStackedVariants,
  partitionVariants,
  variantIntronGap,
  variantTrack,
} from './variant-track.js';
import { defaultVariantSymbolEncoding } from '../symbol-encoding.js';

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
  { id: 'v3-prot', label: 'V3', coord: { kind: 'protein', aa: 90 }, category: 'missense' },
  { id: 'v4-intronic', label: 'V4', coord: { kind: 'cds', cPos: 100, offset: 5 }, category: 'splice' },
  { id: 'v5-oob', label: 'V5', coord: { kind: 'cds', cPos: 9999, offset: 0 }, category: 'utr' },
];

function setup(opts: { interaction?: Partial<InteractionState> } = {}) {
  const mapper = createCoordinateMapper(transcript);
  const viewport = new ViewportController({ mapper, width: 720, mode: 'genome' });
  const painter = createSvgPainter({ mode: 'screen' });
  const interaction: InteractionState = {
    hoveredFeatureId: opts.interaction?.hoveredFeatureId ?? null,
    selectedFeatureIds: opts.interaction?.selectedFeatureIds ?? new Set(),
    brushRange: opts.interaction?.brushRange ?? null,
  };
  return { mapper, viewport, painter, interaction };
}

describe('partitionVariants', () => {
  it('places CDS variants whose projection lands inside an exon', () => {
    const { viewport, mapper } = setup();
    const { placed, unplaced } = partitionVariants(variants, viewport, mapper);
    const placedIds = placed.map((p) => p.variant.id);
    expect(placedIds).toEqual(expect.arrayContaining(['v1', 'v2', 'v3-prot']));
    expect(unplaced.map((v) => v.id)).toEqual(expect.arrayContaining(['v4-intronic', 'v5-oob']));
  });

  it('returns localX relative to the exon group origin', () => {
    const { viewport, mapper } = setup();
    const { placed } = partitionVariants(variants, viewport, mapper);
    const v1 = placed.find((p) => p.variant.id === 'v1');
    expect(v1).toBeDefined();
    expect(v1!.exonIdx).toBe(0);
    // Exon 0 starts at cdsStart=1 and ends at cdsEnd=100. v1 lives at cPos=50.
    // Its localX should equal the visible width of bp 1..50 inside exon 0.
    const x50 = viewport.cdsToScreen(50, 0)!;
    const x1 = viewport.cdsToScreen(1, 0)!;
    expect(v1!.localX).toBeCloseTo(x50 - x1, 5);
  });
});

describe('variantIntronGap', () => {
  it('returns the bracketing exon pair for a negative-offset variant anchored at a downstream exon', () => {
    const mapper = createCoordinateMapper(transcript);
    // c.101-3 — cPos lies in exon 1 (idx 1), offset < 0 → intron between
    // idx 0 and idx 1.
    const v: ViewerVariant = {
      id: 'x',
      label: 'x',
      coord: { kind: 'cds', cPos: 101, offset: -3 },
      category: 'splice',
    };
    expect(variantIntronGap(v, mapper)).toEqual({ exonIdxA: 0, exonIdxB: 1 });
  });

  it('returns the bracketing exon pair for a positive-offset variant anchored at an upstream exon', () => {
    const mapper = createCoordinateMapper(transcript);
    const v: ViewerVariant = {
      id: 'x',
      label: 'x',
      coord: { kind: 'cds', cPos: 100, offset: 5 },
      category: 'splice',
    };
    expect(variantIntronGap(v, mapper)).toEqual({ exonIdxA: 0, exonIdxB: 1 });
  });

  it('returns null for an exonic variant (offset 0)', () => {
    const mapper = createCoordinateMapper(transcript);
    const v: ViewerVariant = {
      id: 'x',
      label: 'x',
      coord: { kind: 'cds', cPos: 50, offset: 0 },
      category: 'missense',
    };
    expect(variantIntronGap(v, mapper)).toBeNull();
  });

  it('returns null for a protein-coord variant (always exonic)', () => {
    const mapper = createCoordinateMapper(transcript);
    const v: ViewerVariant = {
      id: 'x',
      label: 'x',
      coord: { kind: 'protein', aa: 50 },
      category: 'missense',
    };
    expect(variantIntronGap(v, mapper)).toBeNull();
  });

  it('returns null when offset would point outside the transcript', () => {
    const mapper = createCoordinateMapper(transcript);
    // Last exon (idx 2) + positive offset → no downstream intron exists.
    const v: ViewerVariant = {
      id: 'x',
      label: 'x',
      coord: { kind: 'cds', cPos: 300, offset: 5 },
      category: 'splice',
    };
    expect(variantIntronGap(v, mapper)).toBeNull();
  });
});

describe('variantTrack', () => {
  it('hiddenFeaturesByIntron aggregates intronic variants by gap', () => {
    const t = variantTrack({ source: variants });
    const mapper = createCoordinateMapper(transcript);
    const viewport = new ViewportController({ mapper, width: 720, mode: 'transcript' });
    const buckets = t.hiddenFeaturesByIntron!({
      data: { variants },
      viewport,
      mapper,
    });
    // The fixture variants include `v4-intronic` (cPos 100, offset 5) in
    // intron 0→1; no other intronic variants are defined.
    expect(buckets).toEqual([
      { exonIdxA: 0, exonIdxB: 1, count: 1, featureIds: ['v4-intronic'] },
    ]);
  });
});

describe('variantTrack', () => {
  it('loads from a static array', async () => {
    const t = variantTrack({ source: variants });
    const { mapper, viewport } = setup();
    const data = await t.load({ viewport, mapper, signal: new AbortController().signal, protein: null });
    expect(data.variants).toHaveLength(variants.length);
  });

  it('loads from a DataSource adapter', async () => {
    const queryFn = vi.fn().mockResolvedValue([variants[0]!]);
    const source: DataSource<ViewportQuery, ViewerVariant[]> = {
      id: 'mock-source',
      cacheKey: () => 'k',
      query: queryFn,
    };
    const t = variantTrack({ source });
    const { mapper, viewport } = setup();
    const data = await t.load({ viewport, mapper, signal: new AbortController().signal, protein: null });
    expect(queryFn).toHaveBeenCalledWith(
      { mode: 'genome', range: viewport.range },
      expect.anything(),
    );
    expect(data.variants).toHaveLength(1);
  });

  it('renders one .vv-variant per placed variant inside an exon group', () => {
    const t = variantTrack({ source: variants });
    const { mapper, viewport, painter, interaction } = setup();
    const Probe = () => (
      <svg>
        {t.render({
          data: { variants },
          rect: { yTop: 0, yBottom: 28 },
          viewport,
          mapper,
          interaction,
          painter,
        })}
      </svg>
    );
    const { container } = render(<Probe />);
    const placedGs = container.querySelectorAll<SVGGElement>('.vv-variant');
    // v1, v2, v3-prot are placeable; v4-intronic and v5-oob are not.
    expect(placedGs).toHaveLength(3);
    for (const g of placedGs) {
      expect(g.closest('.vv-exon-group')).not.toBeNull();
    }
  });

  it('annotates the per-feature <g> with id and category data attrs', () => {
    const t = variantTrack({ source: variants });
    const { mapper, viewport, painter, interaction } = setup();
    const Probe = () => (
      <svg>
        {t.render({
          data: { variants },
          rect: { yTop: 0, yBottom: 28 },
          viewport,
          mapper,
          interaction,
          painter,
        })}
      </svg>
    );
    const { container } = render(<Probe />);
    const v1 = container.querySelector<SVGGElement>('[data-vv-feature-id="v1"]');
    expect(v1).not.toBeNull();
    expect(v1!.getAttribute('data-vv-category')).toBe('missense');
  });

  it('applies is-hovered and is-selected classes from InteractionState', () => {
    const t = variantTrack({ source: variants });
    const { mapper, viewport, painter } = setup();
    const interaction: InteractionState = {
      hoveredFeatureId: 'v1',
      selectedFeatureIds: new Set(['v2']),
      brushRange: null,
    };
    const Probe = () => (
      <svg>
        {t.render({
          data: { variants },
          rect: { yTop: 0, yBottom: 28 },
          viewport,
          mapper,
          interaction,
          painter,
        })}
      </svg>
    );
    const { container } = render(<Probe />);
    expect(container.querySelector('[data-vv-feature-id="v1"]')?.classList.contains('is-hovered')).toBe(true);
    expect(container.querySelector('[data-vv-feature-id="v2"]')?.classList.contains('is-selected')).toBe(true);
  });

  it('stacked render emits one .vv-variant-stacked per placed variant inside an exon group', async () => {
    const t = variantTrack({
      source: variants,
      stackedVariantStyle: defaultVariantSymbolEncoding,
    });
    const { mapper, viewport, painter, interaction } = setup();
    const data = await t.load({
      viewport,
      mapper,
      signal: new AbortController().signal,
      protein: null,
    });
    const Probe = () => (
      <svg>
        {t.render({
          data,
          rect: { yTop: 0, yBottom: 60 },
          viewport,
          mapper,
          interaction,
          painter,
        })}
      </svg>
    );
    const { container } = render(<Probe />);
    const stacked = container.querySelectorAll<SVGGElement>('.vv-variant-stacked');
    expect(stacked).toHaveLength(3);
    for (const g of stacked) {
      expect(g.closest('.vv-exon-group')).not.toBeNull();
      expect(g.querySelector('.vv-variant-glyph')).not.toBeNull();
      expect(g.hasAttribute('data-vv-stack-row')).toBe(true);
    }
    const trackEl = container.querySelector<SVGGElement>('.vv-variant-track-stacked');
    expect(trackEl).not.toBeNull();
    expect(trackEl!.getAttribute('data-vv-stack-rows')).toBeTruthy();
  });

  it('stacked heightPolicy is data-dependent and height grows with row count', async () => {
    const t = variantTrack({
      source: variants,
      stackedVariantStyle: defaultVariantSymbolEncoding,
    });
    expect(t.heightPolicy).toBe('data-dependent');
    const { mapper, viewport } = setup();
    const data = await t.load({
      viewport,
      mapper,
      signal: new AbortController().signal,
      protein: null,
    });
    const h = t.height({ data, viewport, hint: { maxPx: 200 } });
    expect(h.didTruncate).toBe(false);
    expect(h.px).toBeGreaterThan(0);
  });

  it('packStackedVariants groups by lane key, then packs by baselineX', () => {
    const { mapper, viewport } = setup();
    // Three variants in the same lane (missense) at the same cPos => three rows.
    const colocated: ViewerVariant[] = [
      { id: 'a', label: 'a', coord: { kind: 'cds', cPos: 50, offset: 0 }, category: 'missense' },
      { id: 'b', label: 'b', coord: { kind: 'cds', cPos: 50, offset: 0 }, category: 'missense' },
      { id: 'c', label: 'c', coord: { kind: 'cds', cPos: 50, offset: 0 }, category: 'missense' },
      // A nonsense at the same position lands in a different lane => row 3.
      { id: 'd', label: 'd', coord: { kind: 'cds', cPos: 50, offset: 0 }, category: 'nonsense' },
    ];
    const { placed } = partitionVariants(colocated, viewport, mapper);
    const layout = packStackedVariants(placed, defaultVariantSymbolEncoding, viewport, 4);
    expect(layout.rowCount).toBe(4);
    const rows = new Map(layout.placements.map((p) => [p.variant.id, p.row]));
    // Strict lane separation — no row-sharing across different lane
    // keys. Stable lane order: `defaultVariantSymbolEncoding.laneOrder`
    // puts 'lof' before 'missense', so the nonsense variant (lane 'lof')
    // takes row 0, then the missense variants fill rows 1..3.
    expect(rows.get('d')).toBe(0);
    const missenseRows = ['a', 'b', 'c'].map((k) => rows.get(k)!).sort();
    expect(missenseRows).toEqual([1, 2, 3]);
  });

  it('packStackedVariants gives non-overlapping items in the same lane the same row', () => {
    const { mapper, viewport } = setup();
    // Two missense variants far apart should share row 0 (same lane,
    // baseline-x distance exceeds the glyph diameter).
    const apart: ViewerVariant[] = [
      { id: 'a', label: 'a', coord: { kind: 'cds', cPos: 10, offset: 0 }, category: 'missense' },
      { id: 'b', label: 'b', coord: { kind: 'cds', cPos: 290, offset: 0 }, category: 'missense' },
    ];
    const { placed } = partitionVariants(apart, viewport, mapper);
    const layout = packStackedVariants(placed, defaultVariantSymbolEncoding, viewport, 4);
    expect(layout.rowCount).toBe(1);
    for (const p of layout.placements) expect(p.row).toBe(0);
  });

  it('renderBelow exposes unplaced variants and fires hover/click callbacks', () => {
    const t = variantTrack({ source: variants });
    const { mapper, viewport, painter, interaction } = setup();
    const onFeatureHover = vi.fn();
    const onFeatureClick = vi.fn();
    const node = t.renderBelow!({
      data: { variants },
      rect: { yTop: 0, yBottom: 28 },
      viewport,
      mapper,
      interaction,
      painter,
      onFeatureHover,
      onFeatureClick,
    });
    expect(node).not.toBeNull();
    const { container } = render(<>{node}</>);
    const chips = container.querySelectorAll<HTMLLIElement>('.vv-unplaced-chip');
    expect(chips.length).toBe(2);
    fireEvent.mouseEnter(chips[0]!);
    fireEvent.click(chips[0]!);
    fireEvent.mouseLeave(chips[0]!);
    expect(onFeatureHover).toHaveBeenCalledWith(chips[0]!.dataset.vvFeatureId);
    expect(onFeatureHover).toHaveBeenCalledWith(null);
    expect(onFeatureClick).toHaveBeenCalledWith(chips[0]!.dataset.vvFeatureId);
  });
});
