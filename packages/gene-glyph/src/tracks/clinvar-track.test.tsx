import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { createCoordinateMapper } from '../coordinate-mapper.js';
import { createSvgPainter } from '../painter/svg-painter.js';
import type { InteractionState, Transcript } from '../types.js';
import { ViewportController } from '../viewport.js';
import {
  clinVarTrack,
  clusterClinVar,
  packStackedClinVar,
  parseClinVarSignificance,
  placeClinVarRecords,
  type ClinVarRecord,
} from './clinvar-track.js';
import { defaultClinVarSymbolEncoding } from '../symbol-encoding.js';

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

const records: ClinVarRecord[] = [
  { id: 'cv-1', label: 'c.10G>A', chr: 'chr1', pos: 1009, significance: 'pathogenic' },
  { id: 'cv-2', label: 'c.12C>T', chr: 'chr1', pos: 1011, significance: 'uncertain_significance' },
  { id: 'cv-3', label: 'c.14A>G', chr: 'chr1', pos: 1013, significance: 'likely_benign' },
  { id: 'cv-4', label: 'c.150G>A', chr: 'chr1', pos: 2049, significance: 'benign' },
  { id: 'cv-intronic', label: 'c.100+5T>C', chr: 'chr1', pos: 1104, significance: 'uncertain_significance' },
  { id: 'cv-oob', label: 'far away', chr: 'chr1', pos: 999999, significance: 'other' },
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

describe('placeClinVarRecords', () => {
  it('placeable records project onto their exons; intronic + out-of-bounds fall to unplaced', () => {
    const { viewport, mapper } = setup();
    const { placed, unplaced } = placeClinVarRecords(records, viewport, mapper);
    expect(placed.map((p) => p.record.id)).toEqual(
      expect.arrayContaining(['cv-1', 'cv-2', 'cv-3', 'cv-4']),
    );
    expect(unplaced.map((r) => r.id)).toEqual(
      expect.arrayContaining(['cv-intronic', 'cv-oob']),
    );
  });
});

describe('clusterClinVar', () => {
  it('merges placements whose screen-x distance is below the threshold', () => {
    const { viewport, mapper } = setup();
    const { placed } = placeClinVarRecords(records, viewport, mapper);
    const clusters = clusterClinVar(placed, 14);
    // cv-1, cv-2, cv-3 sit within ~4 genomic bp of each other in exon 0 so
    // they collapse to one cluster at fit-gene zoom; cv-4 lives in a
    // different exon and stays alone.
    expect(clusters.length).toBe(2);
    const multi = clusters.find((c) => c.members.length > 1);
    expect(multi).toBeDefined();
    expect(multi!.members.map((m) => m.record.id).sort()).toEqual(['cv-1', 'cv-2', 'cv-3']);
    expect(multi!.topSignificance).toBe('pathogenic');
  });

  it('zooming in breaks the cluster apart once spacing exceeds the threshold', () => {
    const { viewport, mapper } = setup();
    viewport.setRange([1, 60]);
    const { placed } = placeClinVarRecords(records, viewport, mapper);
    // Only the three early records project into the zoomed-in window; they
    // should now be far enough apart to render as individual marks.
    const clusters = clusterClinVar(placed, 14);
    expect(clusters.every((c) => c.members.length === 1)).toBe(true);
  });

  it('single-member clusters carry a `member:` id; multi-member clusters carry a `cluster:` id', () => {
    const { viewport, mapper } = setup();
    const { placed } = placeClinVarRecords(records, viewport, mapper);
    const clusters = clusterClinVar(placed, 14);
    const single = clusters.find((c) => c.members.length === 1)!;
    const multi = clusters.find((c) => c.members.length > 1)!;
    expect(single.id.startsWith('member:')).toBe(true);
    expect(multi.id.startsWith('cluster:')).toBe(true);
  });
});

describe('parseClinVarSignificance', () => {
  it.each([
    ['Pathogenic', 'pathogenic'],
    ['Likely pathogenic', 'likely_pathogenic'],
    ['Uncertain significance', 'uncertain_significance'],
    ['Likely benign', 'likely_benign'],
    ['Benign', 'benign'],
    ['Conflicting interpretations of pathogenicity', 'conflicting'],
    ['drug response', 'other'],
    ['', 'other'],
  ] as const)('maps %j to %j', (raw, expected) => {
    expect(parseClinVarSignificance(raw)).toBe(expected);
  });
});

describe('clinVarTrack', () => {
  it('loads from a static array', async () => {
    const t = clinVarTrack({ source: records });
    const { mapper, viewport } = setup();
    const data = await t.load({
      viewport,
      mapper,
      signal: new AbortController().signal,
      protein: null,
    });
    expect(data.records).toHaveLength(records.length);
  });

  it('renders one mark per cluster with the dominant-significance fill', () => {
    const t = clinVarTrack({ source: records });
    const { mapper, viewport, painter, interaction } = setup();
    const Probe = () => (
      <svg>
        {t.render({
          data: { records },
          rect: { yTop: 0, yBottom: 28 },
          viewport,
          mapper,
          interaction,
          painter,
        })}
      </svg>
    );
    const { container } = render(<Probe />);
    const marks = container.querySelectorAll<SVGGElement>('.vv-clinvar-mark');
    expect(marks.length).toBe(2);
    const cluster = container.querySelector<SVGGElement>('.vv-clinvar-mark.is-cluster')!;
    expect(cluster).not.toBeNull();
    expect(cluster.getAttribute('data-vv-cluster-size')).toBe('3');
    expect(cluster.getAttribute('data-vv-significance')).toBe('pathogenic');
  });

  it('clicking a cluster mark opens a popover with one row per member', async () => {
    const t = clinVarTrack({ source: records });
    const { mapper, viewport, painter, interaction } = setup();
    const onFeatureClick = vi.fn();
    const Probe = () => (
      <svg>
        {t.render({
          data: { records },
          rect: { yTop: 20, yBottom: 48 },
          viewport,
          mapper,
          interaction,
          painter,
          onFeatureClick,
          onFeatureHover: () => {},
        })}
      </svg>
    );
    const { container } = render(<Probe />);
    const cluster = container.querySelector<SVGGElement>('.vv-clinvar-mark.is-cluster')!;
    act(() => {
      fireEvent.click(cluster);
    });
    const popover = container.querySelector('[data-testid="clinvar-popover"]')!;
    expect(popover).not.toBeNull();
    const rows = popover.querySelectorAll('.vv-clinvar-popover-row');
    expect(rows.length).toBe(3);
    act(() => {
      fireEvent.click(rows[0]!);
    });
    expect(onFeatureClick).toHaveBeenCalledWith('cv-1');
    // Click should also close the popover.
    expect(container.querySelector('[data-testid="clinvar-popover"]')).toBeNull();
  });

  it('clicking the backdrop dismisses the popover without firing member callbacks', () => {
    const t = clinVarTrack({ source: records });
    const { mapper, viewport, painter, interaction } = setup();
    const onFeatureClick = vi.fn();
    const Probe = () => (
      <svg>
        {t.render({
          data: { records },
          rect: { yTop: 20, yBottom: 48 },
          viewport,
          mapper,
          interaction,
          painter,
          onFeatureClick,
          onFeatureHover: () => {},
        })}
      </svg>
    );
    const { container } = render(<Probe />);
    const cluster = container.querySelector<SVGGElement>('.vv-clinvar-mark.is-cluster')!;
    act(() => fireEvent.click(cluster));
    const backdrop = container.querySelector('[data-testid="clinvar-popover-backdrop"]')!;
    act(() => fireEvent.click(backdrop));
    expect(container.querySelector('[data-testid="clinvar-popover"]')).toBeNull();
    expect(onFeatureClick).not.toHaveBeenCalled();
  });

  it('clicking a single-member mark fires onFeatureClick directly (no popover)', () => {
    const t = clinVarTrack({ source: records });
    const { mapper, viewport, painter, interaction } = setup();
    const onFeatureClick = vi.fn();
    const Probe = () => (
      <svg>
        {t.render({
          data: { records },
          rect: { yTop: 20, yBottom: 48 },
          viewport,
          mapper,
          interaction,
          painter,
          onFeatureClick,
          onFeatureHover: () => {},
        })}
      </svg>
    );
    const { container } = render(<Probe />);
    const single = container.querySelector<SVGGElement>(
      '.vv-clinvar-mark:not(.is-cluster)',
    )!;
    expect(single).not.toBeNull();
    act(() => fireEvent.click(single));
    expect(onFeatureClick).toHaveBeenCalledWith('cv-4');
    expect(container.querySelector('[data-testid="clinvar-popover"]')).toBeNull();
  });

  it('exposes resolveFeature / featureLabel for the tooltip system', () => {
    const t = clinVarTrack({ source: records });
    const data = { records };
    expect(t.resolveFeature!(data, 'cv-1')).toMatchObject({ id: 'cv-1' });
    expect(t.featureLabel!(data, 'cv-1')).toContain('Pathogenic');
  });

  it('stacked render suppresses density clustering and emits one glyph per record', async () => {
    const t = clinVarTrack({
      source: records,
      stackedVariantStyle: defaultClinVarSymbolEncoding,
    });
    expect(t.heightPolicy).toBe('data-dependent');
    const { mapper, viewport, painter, interaction } = setup();
    const data = await t.load({
      viewport,
      mapper,
      signal: new AbortController().signal,
      protein: null,
    });
    expect(data.stackLayout).toBeDefined();
    // 4 placeable records, 2 intronic/oob — so 4 glyphs.
    expect(data.stackLayout!.placements.length).toBe(4);
    const Probe = () => (
      <svg>
        {t.render({
          data,
          rect: { yTop: 0, yBottom: 80 },
          viewport,
          mapper,
          interaction,
          painter,
        })}
      </svg>
    );
    const { container } = render(<Probe />);
    const glyphs = container.querySelectorAll('.vv-clinvar-mark-stacked');
    expect(glyphs).toHaveLength(4);
    // No cluster diamonds: stacking suppresses density-clustering by design.
    const clusters = container.querySelectorAll('.vv-clinvar-mark.is-cluster');
    expect(clusters).toHaveLength(0);
    // Popover is part of the cluster path and shouldn't render in stacked mode.
    const popover = container.querySelector('[data-testid="clinvar-popover"]');
    expect(popover).toBeNull();
  });

  it('packStackedClinVar groups by significance lane', () => {
    const { viewport, mapper } = setup();
    const { placed } = placeClinVarRecords(records, viewport, mapper);
    const layout = packStackedClinVar(placed, defaultClinVarSymbolEncoding, 5);
    expect(layout.rowCount).toBeGreaterThan(0);
    const lanes = new Set(layout.placements.map((p) => p.laneKey));
    // Four placeable records map to four distinct lane keys: path, vus,
    // benign (cv-3 likely_benign → benign), benign (cv-4 benign → benign).
    // So we expect 3 lane keys: path, vus, benign.
    expect(lanes).toEqual(new Set(['path', 'vus', 'benign']));
  });
});
