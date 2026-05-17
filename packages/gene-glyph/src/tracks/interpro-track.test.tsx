import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { createCoordinateMapper } from '../coordinate-mapper.js';
import { createSvgPainter } from '../painter/svg-painter.js';
import type {
  InteractionState,
  ProteinAnnotations,
  ProteinDomain,
  Transcript,
} from '../types.js';
import { ViewportController } from '../viewport.js';
import { interProTrack, type InterProSubTrackData } from './interpro-track.js';

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

const domains: ProteinDomain[] = [
  // Two overlapping family entries — should lane-pack into 2 lanes.
  {
    aaStart: 5,
    aaEnd: 30,
    source: 'InterPro',
    sourceId: 'IPR0001',
    shortName: 'F1',
    description: 'Family 1',
    entryType: 'family',
  },
  {
    aaStart: 20,
    aaEnd: 50,
    source: 'InterPro',
    sourceId: 'IPR0002',
    shortName: 'F2',
    description: 'Family 2',
    entryType: 'family',
  },
  // Single non-overlapping domain entry — 1 lane.
  {
    aaStart: 60,
    aaEnd: 90,
    source: 'InterPro',
    sourceId: 'IPR0003',
    shortName: 'D1',
    description: 'Domain 1',
    entryType: 'domain',
  },
  // A Pfam entry — should be filtered out by the default source filter.
  {
    aaStart: 10,
    aaEnd: 40,
    source: 'Pfam',
    sourceId: 'PF0001',
    shortName: 'X',
    description: 'Pfam entry',
    entryType: 'family',
  },
];

const protein: ProteinAnnotations = {
  uniprotAcc: 'P00000',
  length: 100,
  domains,
};

function setup() {
  const mapper = createCoordinateMapper(transcript);
  const viewport = new ViewportController({ mapper, width: 720, mode: 'cds-with-introns' });
  const painter = createSvgPainter({ mode: 'screen' });
  const interaction: InteractionState = {
    hoveredFeatureId: null,
    selectedFeatureIds: new Set(),
    brushRange: null,
  };
  return { mapper, viewport, painter, interaction };
}

describe('interProTrack', () => {
  it('builds a TrackGroup with one sub-track per requested entry-type', () => {
    const group = interProTrack({ groups: ['family', 'domain'] });
    expect(group.kind).toBe('group');
    expect(group.label).toBe('InterPro');
    expect(group.tracks.map((t) => t.id)).toEqual(['interpro-family', 'interpro-domain']);
    for (const t of group.tracks) {
      expect(t.coordSystem).toBe('protein');
    }
  });

  it('filters domains by source and entry-type when loading', async () => {
    const { viewport, mapper } = setup();
    const group = interProTrack({ groups: ['family', 'domain'] });
    const family = group.tracks[0]!;
    const domain = group.tracks[1]!;
    const familyData = (await family.load({ viewport, mapper, signal: new AbortController().signal, protein })) as InterProSubTrackData;
    const domainData = (await domain.load({ viewport, mapper, signal: new AbortController().signal, protein })) as InterProSubTrackData;
    expect(familyData.domains.map((d) => d.shortName).sort()).toEqual(['F1', 'F2']);
    expect(domainData.domains.map((d) => d.shortName)).toEqual(['D1']);
  });

  it('lane-packs overlapping entries within an entry-type', async () => {
    const { viewport, mapper } = setup();
    const group = interProTrack({ groups: ['family'] });
    const family = group.tracks[0]!;
    const data = (await family.load({ viewport, mapper, signal: new AbortController().signal, protein })) as InterProSubTrackData;
    expect(data.laneCount).toBe(2);
    const byId = new Map(data.placements.map((p) => [p.domain.sourceId, p.lane]));
    expect(byId.get('IPR0001')).not.toBe(byId.get('IPR0002'));
  });

  it('reports height proportional to lane count and zero when no domains', async () => {
    const { viewport, mapper } = setup();
    const group = interProTrack({ groups: ['family', 'repeat'], laneHeight: 20 });
    const family = group.tracks[0]!;
    const repeat = group.tracks[1]!;
    const familyData = (await family.load({ viewport, mapper, signal: new AbortController().signal, protein })) as InterProSubTrackData;
    const repeatData = (await repeat.load({ viewport, mapper, signal: new AbortController().signal, protein })) as InterProSubTrackData;
    expect(family.height({ data: familyData, viewport, hint: { maxPx: 500 } }).px).toBe(40);
    expect(repeat.height({ data: repeatData, viewport, hint: { maxPx: 500 } }).px).toBe(0);
  });

  it('renders one rect per intersected exon for each placed domain (style: rect)', async () => {
    const { mapper, viewport, painter, interaction } = setup();
    const group = interProTrack({ groups: ['domain'], style: 'rect' });
    const domainTrack = group.tracks[0]!;
    const data = (await domainTrack.load({ viewport, mapper, signal: new AbortController().signal, protein })) as InterProSubTrackData;

    function Probe() {
      return (
        <svg>
          {domainTrack.render({
            data,
            rect: { yTop: 0, yBottom: 16 },
            viewport,
            mapper,
            interaction,
            painter,
          })}
        </svg>
      );
    }

    const { container } = render(<Probe />);
    // D1 spans aa 60..90 → CDS 178..270 → exons 1 and 2 (2 segments).
    expect(container.querySelectorAll('.vv-interpro-rect').length).toBeGreaterThanOrEqual(2);
    // One inter-exon linker for the exon 1 → exon 2 boundary.
    expect(container.querySelectorAll('.vv-interpro-linker')).toHaveLength(1);
  });

  it('default style is "minimal" — line + end-cap ticks, no filled rect', async () => {
    const { mapper, viewport, painter, interaction } = setup();
    const group = interProTrack({ groups: ['domain'] });
    const domainTrack = group.tracks[0]!;
    const data = (await domainTrack.load({ viewport, mapper, signal: new AbortController().signal, protein })) as InterProSubTrackData;

    function Probe() {
      return (
        <svg>
          {domainTrack.render({
            data,
            rect: { yTop: 0, yBottom: 22 },
            viewport,
            mapper,
            interaction,
            painter,
          })}
        </svg>
      );
    }

    const { container } = render(<Probe />);
    // D1 has 2 visible segments → 2 lines. Plus a left + right end-cap on
    // the first / last segments (2 caps total per domain). No vv-interpro-rect.
    expect(container.querySelectorAll('.vv-interpro-rect')).toHaveLength(0);
    expect(container.querySelectorAll('.vv-interpro-line').length).toBeGreaterThanOrEqual(2);
    expect(container.querySelectorAll('.vv-interpro-cap')).toHaveLength(2);
    // Still one linker across the intron gap.
    expect(container.querySelectorAll('.vv-interpro-linker')).toHaveLength(1);
  });

  it('exposes the entry-type label on each sub-track for gutter consumption', () => {
    const group = interProTrack({ groups: ['family', 'domain', 'repeat'] });
    expect(group.tracks.map((t) => t.label)).toEqual(['Family', 'Domain', 'Repeat']);
  });

  it('minimal-style label is left-aligned to the domain start (text-anchor: start)', async () => {
    const { mapper, viewport, painter, interaction } = setup();
    const group = interProTrack({ groups: ['domain'] });
    const domainTrack = group.tracks[0]!;
    const data = (await domainTrack.load({ viewport, mapper, signal: new AbortController().signal, protein })) as InterProSubTrackData;

    function Probe() {
      return (
        <svg>
          {domainTrack.render({
            data,
            rect: { yTop: 0, yBottom: 22 },
            viewport,
            mapper,
            interaction,
            painter,
          })}
        </svg>
      );
    }

    const { container } = render(<Probe />);
    const labels = container.querySelectorAll<SVGTextElement>('.vv-interpro-label');
    expect(labels.length).toBeGreaterThanOrEqual(1);
    for (const l of labels) {
      expect(l.getAttribute('text-anchor')).toBe('start');
      expect(l.getAttribute('dominant-baseline')).toBe('hanging');
    }
  });
});
