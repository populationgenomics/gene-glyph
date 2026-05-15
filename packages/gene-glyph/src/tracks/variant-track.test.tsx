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
import { partitionVariants, variantTrack } from './variant-track.js';

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
  const viewport = new ViewportController({ mapper, width: 720, mode: 'cds-with-introns' });
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
      { mode: 'cds-with-introns', range: viewport.range },
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
