import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { createCoordinateMapper, defaultCollapsedRegions } from '../coordinate-mapper.js';
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

  describe('multi-bp spans', () => {
    // Minus-strand fixture mirroring HBB's shape — three exons with a
    // 100bp intron between each, CDS starts on the genomic-high side
    // of exon 1 so genomic-end of a deletion at r.pos maps to a LOWER
    // CDS coord. This is the geometry that triggers the HGVS-anchor
    // and intron-flank-aware placement paths.
    const minusStrand: Transcript = {
      geneSymbol: 'NEG',
      transcriptId: 'NM_NEG.1',
      cdsLength: 300,
      strand: '-',
      exons: [
        // Exon 1: c.1–100 at genomic 2900–2999 (transcript-5')
        { number: 1, cdsStart: 1, cdsEnd: 100, genomicStart: 2900, genomicEnd: 2999, chr: 'chr1' },
        // Exon 2: c.101–200 at genomic 1900–1999
        { number: 2, cdsStart: 101, cdsEnd: 200, genomicStart: 1900, genomicEnd: 1999, chr: 'chr1' },
        // Exon 3: c.201–300 at genomic 900–999 (transcript-3')
        { number: 3, cdsStart: 201, cdsEnd: 300, genomicStart: 900, genomicEnd: 999, chr: 'chr1' },
      ],
    };
    function negSetup() {
      const mapper = createCoordinateMapper(minusStrand);
      const viewport = new ViewportController({
        mapper,
        width: 720,
        mode: 'genome',
        // Match what the viewer wires up by default — without this the
        // baseline geometry has no flanks and intronic offsets can't be
        // projected.
        collapsedRegions: defaultCollapsedRegions(minusStrand),
      });
      return { mapper, viewport };
    }

    it('multi-bp variant entirely within one exon draws a rightward span and no arrow', () => {
      const { viewport, mapper } = negSetup();
      // 5 bp deletion entirely inside exon 2. On minus strand: r.pos at
      // genomic 1995 maps to c.105 (high CDS in exon 2); r.pos+4 at
      // 1999 maps to c.101 (low CDS in exon 2). Anchor = c.101, line
      // extends right to c.105.
      const rec: ClinVarRecord = {
        id: 'cv-multibp-exonic',
        label: 'c.101_105del',
        chr: 'chr1', pos: 1995, refLen: 5, significance: 'pathogenic',
      };
      const { placed } = placeClinVarRecords([rec], viewport, mapper);
      expect(placed).toHaveLength(1);
      const p = placed[0]!;
      expect(p.cPos).toBe(101); // anchor at HGVS-start
      expect(p.endBaselineX).toBeGreaterThan(p.baselineX); // line goes right
      expect(p.truncatedSide).toBeUndefined();
    });

    it('multi-bp variant whose intronic end fits inside the visible flank gets a real span and no arrow', () => {
      const { viewport, mapper } = negSetup();
      // 8 bp deletion: 3 bp into intron 1 (acceptor side of exon 2) +
      // 5 bp into exon 2. On minus strand the variant's genomic-high
      // end is at the intron — within the 10 bp flank, so projectable.
      // r.pos at genomic 1995 = c.105. r.pos+7 at 2002 = c.101 - 3
      // (in acceptor flank). HGVS-anchor = c.101-3.
      const rec: ClinVarRecord = {
        id: 'cv-multibp-flank',
        label: 'c.101-3_105del',
        chr: 'chr1', pos: 1995, refLen: 8, significance: 'pathogenic',
      };
      const { placed } = placeClinVarRecords([rec], viewport, mapper);
      expect(placed).toHaveLength(1);
      const p = placed[0]!;
      expect(p.endBaselineX).toBeGreaterThan(p.baselineX);
      expect(p.truncatedSide).toBeUndefined();
    });

    it('multi-bp variant overshooting the visible flank into the chevron gets truncated:left', () => {
      const { viewport, mapper } = negSetup();
      // 25 bp deletion: 20 bp into intron 1 + 5 bp into exon 2.
      // The intronic 20 bp exceeds flank.bp (10) — the anchor docks
      // at the acceptor flank's outer edge and `truncatedSide = 'left'`
      // tells the renderer to draw the arrow stub.
      const rec: ClinVarRecord = {
        id: 'cv-multibp-overshoot',
        label: 'c.101-20_105del',
        chr: 'chr1', pos: 1995, refLen: 25, significance: 'pathogenic',
      };
      const { placed } = placeClinVarRecords([rec], viewport, mapper);
      expect(placed).toHaveLength(1);
      const p = placed[0]!;
      expect(p.truncatedSide).toBe('left');
      expect(p.endBaselineX).toBeGreaterThan(p.baselineX);
    });

    it('intronic anchor in transcript mode docks at the splice-site cPos with truncated=true', () => {
      // Same 25 bp deletion (intronic anchor 20 bp into intron 1 from
      // exon 2's acceptor) but now in transcript mode — the intron is
      // fully collapsed, no flank to dock in. Without the splice-site
      // fallback the variant would unplace entirely. With it, the
      // marker sits at c.101 (exon 2's transcript-5' edge) and
      // truncatedSide = 'left' tells the renderer to draw the chevron
      // pointing into the collapsed intron.
      const mapper = createCoordinateMapper(minusStrand);
      const viewport = new ViewportController({
        mapper,
        width: 720,
        mode: 'transcript',
        collapsedRegions: defaultCollapsedRegions(minusStrand),
      });
      const rec: ClinVarRecord = {
        id: 'cv-intronic-transcript-mode',
        label: 'c.101-20_105del',
        chr: 'chr1', pos: 1995, refLen: 25, significance: 'pathogenic',
      };
      const { placed } = placeClinVarRecords([rec], viewport, mapper);
      expect(placed).toHaveLength(1);
      const p = placed[0]!;
      expect(p.cPos).toBe(101); // splice-site dock, not the intronic c.101-20
      expect(p.truncatedSide).toBe('left');
      expect(p.endBaselineX).toBeGreaterThan(p.baselineX);
    });

    it('multi-bp variant whose far end overshoots the entire transcript flags the boundary side', () => {
      const { viewport, mapper } = negSetup();
      // 5000 bp deletion: r.pos at genomic 1990 (in exon 2, c.110);
      // r.pos + 4999 at 6989 — past every exon on the genomic-high
      // side. On minus-strand that overshoots the transcript-5' end,
      // so endHgvs gets synthesised at the outer UTR edge (= 1 -
      // utr5Bp). With no utr5Bp set, that's cPos = 1; the line still
      // covers the in-figure CDS extent and truncatedSide = 'left'
      // flags the off-figure overshoot.
      const rec: ClinVarRecord = {
        id: 'cv-past-transcript',
        label: 'huge deletion past 5\' end',
        chr: 'chr1', pos: 1990, refLen: 5000, significance: 'pathogenic',
      };
      const { placed } = placeClinVarRecords([rec], viewport, mapper);
      expect(placed).toHaveLength(1);
      const p = placed[0]!;
      expect(p.cPos).toBe(1); // synthesised anchor at the boundary (no UTR in fixture)
      expect(p.truncatedSide).toBe('left');
      expect(p.endBaselineX).toBeGreaterThan(p.baselineX);
    });

    it('past-transcript overshoot extends through the visible 5\'UTR cap when utr5Bp is set', () => {
      // Same fixture, but exon 0 carries a 50bp 5'UTR. The
      // synthesised anchor now sits at cPos = 1 - 50 = -49 (the
      // outermost visible position) so the line covers the whole
      // visible UTR cap, not just the CDS.
      const txWithUtr: Transcript = {
        ...minusStrand,
        exons: minusStrand.exons.map((e, i) => i === 0 ? { ...e, utr5Bp: 50 } : e),
      };
      const mapper = createCoordinateMapper(txWithUtr);
      const viewport = new ViewportController({
        mapper,
        width: 720,
        mode: 'genome',
        collapsedRegions: defaultCollapsedRegions(txWithUtr),
      });
      const rec: ClinVarRecord = {
        id: 'cv-past-transcript-utr',
        label: 'huge deletion past 5\' UTR',
        chr: 'chr1', pos: 1990, refLen: 5000, significance: 'pathogenic',
      };
      const { placed } = placeClinVarRecords([rec], viewport, mapper);
      expect(placed).toHaveLength(1);
      const p = placed[0]!;
      expect(p.cPos).toBe(-49); // 1 - utr5Bp
      expect(p.truncatedSide).toBe('left');
      expect(p.endBaselineX).toBeGreaterThan(p.baselineX);
    });

    it('multi-bp variant spanning multiple exons docks at the host exon edge and flags truncated:right', () => {
      const { viewport, mapper } = negSetup();
      // 1010 bp deletion crossing intron 1 entirely. On minus strand:
      // r.pos at genomic 1990 = c.110 (mid exon 2); r.pos + 1009 at
      // 2999 = c.1 (start of exon 1). Anchor = c.1 (exon 0); far =
      // c.110 (exon 1). Host = anchor's exon (exon 0); far gets
      // clipped to exon 0's donor flank edge and truncatedSide =
      // 'right'.
      const rec: ClinVarRecord = {
        id: 'cv-multibp-crossexon',
        label: 'c.1_110del',
        chr: 'chr1', pos: 1990, refLen: 1010, significance: 'pathogenic',
      };
      const { placed } = placeClinVarRecords([rec], viewport, mapper);
      expect(placed).toHaveLength(1);
      const p = placed[0]!;
      expect(p.exonIdx).toBe(0); // host is anchor's exon
      expect(p.truncatedSide).toBe('right');
      expect(p.endBaselineX).toBeGreaterThan(p.baselineX);
    });
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

  describe('filter prop (RD-1102)', () => {
    it('cluster path drops records that fail the predicate before clustering', () => {
      // Without a filter the three exon-1 records (pathogenic + VUS + likely
      // benign) collapse into a single cluster at fit-gene zoom. A filter
      // that keeps only pathogenic survivors leaves a lone singleton mark
      // in that region — no cluster, since the other two records are gone.
      const t = clinVarTrack({
        source: records,
        filter: (r) => r.significance === 'pathogenic',
      });
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
      // cv-1 is the only pathogenic survivor; cv-4 (benign) is filtered out.
      expect(marks.length).toBe(1);
      expect(marks[0]!.getAttribute('data-vv-feature-id')).toBe('cv-1');
      expect(container.querySelector('.vv-clinvar-mark.is-cluster')).toBeNull();
    });

    it('swapping the filter on the same track id re-clusters the surviving set', async () => {
      const { mapper, viewport, painter, interaction } = setup();
      const renderProbe = (track: ReturnType<typeof clinVarTrack>) => (
        <svg>
          {track.render({
            data: { records },
            rect: { yTop: 0, yBottom: 28 },
            viewport,
            mapper,
            interaction,
            painter,
          })}
        </svg>
      );
      const tAll = clinVarTrack({ source: records });
      const { container, rerender } = render(renderProbe(tAll));
      expect(container.querySelectorAll('.vv-clinvar-mark').length).toBe(2);
      expect(container.querySelector('.vv-clinvar-mark.is-cluster')).not.toBeNull();

      // Tighten the filter to a single significance class — host-side
      // pattern of recreating the track config with a new predicate.
      const tStrict = clinVarTrack({
        source: records,
        filter: (r) => r.significance === 'pathogenic',
      });
      rerender(renderProbe(tStrict));
      const marks = container.querySelectorAll('.vv-clinvar-mark');
      expect(marks.length).toBe(1);
      expect(container.querySelector('.vv-clinvar-mark.is-cluster')).toBeNull();
    });

    it('stacked render re-packs against the filtered set instead of the cached layout', async () => {
      const t = clinVarTrack({
        source: records,
        stackedVariantStyle: defaultClinVarSymbolEncoding,
        filter: (r) => r.significance === 'pathogenic' || r.significance === 'benign',
      });
      const { mapper, viewport, painter, interaction } = setup();
      // load() applies the filter before packing so `height()` (which reads
      // `stackLayout.rowCount`) reserves space for the visible rows only.
      // The render path re-packs as a safety net — same filter, same layout.
      const data = await t.load({
        viewport,
        mapper,
        signal: new AbortController().signal,
        protein: null,
      });
      expect(data.stackLayout!.placements.length).toBe(2);
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
      // cv-1 (pathogenic) + cv-4 (benign) survive; the VUS and likely-benign
      // entries drop out of the live-packed layout.
      expect(glyphs).toHaveLength(2);
      const ids = Array.from(glyphs)
        .map((g) => g.getAttribute('data-vv-feature-id'))
        .sort();
      expect(ids).toEqual(['cv-1', 'cv-4']);
    });
  });

  it('packStackedClinVar groups by significance lane', () => {
    const { viewport, mapper } = setup();
    const { placed } = placeClinVarRecords(records, viewport, mapper);
    const layout = packStackedClinVar(placed, defaultClinVarSymbolEncoding, viewport, 5);
    expect(layout.rowCount).toBeGreaterThan(0);
    const lanes = new Set(layout.placements.map((p) => p.laneKey));
    // Four placeable records map to four distinct lane keys: path, vus,
    // benign (cv-3 likely_benign → benign), benign (cv-4 benign → benign).
    // So we expect 3 lane keys: path, vus, benign.
    expect(lanes).toEqual(new Set(['path', 'vus', 'benign']));
  });
});
