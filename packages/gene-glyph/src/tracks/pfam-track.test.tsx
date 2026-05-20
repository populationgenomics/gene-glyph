import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { createCoordinateMapper } from '../coordinate-mapper.js';
import { createSvgPainter } from '../painter/svg-painter.js';
import type { InteractionState, ProteinAnnotations, ProteinDomain, Transcript } from '../types.js';
import { ViewportController } from '../viewport.js';
import { domainHue, fitText, pfamTrack } from './pfam-track.js';

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
  {
    // aa 5..20 → CDS 13..60 → entirely in exon 0.
    aaStart: 5,
    aaEnd: 20,
    source: 'Pfam',
    sourceId: 'PF00001',
    shortName: 'A',
    description: 'Domain A description',
    entryType: 'domain',
  },
  {
    // aa 30..40 → CDS 88..120 → spans exons 0 and 1.
    aaStart: 30,
    aaEnd: 40,
    source: 'Pfam',
    sourceId: 'PF00002',
    shortName: 'B',
    description: 'Domain B description',
    entryType: 'domain',
  },
  {
    // Should be filtered out by the default `source === 'pfam'` filter.
    aaStart: 60,
    aaEnd: 80,
    source: 'InterPro',
    sourceId: 'IPR00001',
    shortName: 'C',
    description: 'IPR record',
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
  const viewport = new ViewportController({ mapper, width: 720, mode: 'genome' });
  const painter = createSvgPainter({ mode: 'screen' });
  const interaction: InteractionState = {
    hoveredFeatureId: null,
    selectedFeatureIds: new Set(),
    brushRange: null,
  };
  return { mapper, viewport, painter, interaction };
}

describe('domainHue', () => {
  it('returns the same hue for the same key (stable)', () => {
    expect(domainHue('PF00001')).toBe(domainHue('PF00001'));
  });
  it('returns different hues for different keys (almost always)', () => {
    expect(domainHue('PF00001')).not.toBe(domainHue('PF99999'));
  });
  it('falls back to a neutral hue for empty keys', () => {
    expect(domainHue('')).toMatch(/^hsl\(/);
  });
});

describe('fitText', () => {
  it('returns the full string when it fits', () => {
    expect(fitText('short', 1000, 11)).toBe('short');
  });
  it('truncates with an ellipsis when the string overruns', () => {
    const fitted = fitText('A very long description that does not fit', 60, 11);
    expect(fitted.endsWith('…')).toBe(true);
    expect(fitted.length).toBeLessThan('A very long description that does not fit'.length);
  });
  it('returns empty when there is not even room for a few characters', () => {
    expect(fitText('hello', 5, 11)).toBe('');
  });
});

describe('pfamTrack', () => {
  it('filters protein.domains down to Pfam-sourced entries by default', async () => {
    const t = pfamTrack({});
    const data = await t.load({
      viewport: setup().viewport,
      mapper: setup().mapper,
      signal: new AbortController().signal,
      protein,
    });
    expect(data.domains.map((d) => d.shortName)).toEqual(['A', 'B']);
  });

  it('renders one segment rect per intersected exon and a linker over each gap', () => {
    const { mapper, viewport, painter, interaction } = setup();
    const t = pfamTrack({});

    function Probe() {
      return (
        <svg>
          {t.render({
            data: { domains: [domains[0]!, domains[1]!] },
            rect: { yTop: 0, yBottom: 28 },
            viewport,
            mapper,
            interaction,
            painter,
          })}
        </svg>
      );
    }

    const { container } = render(<Probe />);
    // Domain A fits in exon 0 (1 segment); Domain B spans exons 0 & 1 (2 segments).
    expect(container.querySelectorAll('.vv-pfam-rect')).toHaveLength(3);
    // One inter-exon linker for Domain B's exon 0 → exon 1 boundary.
    expect(container.querySelectorAll('.vv-pfam-linker')).toHaveLength(1);
    // Each segment rect lives inside its exon group so the per-exon transform
    // animates the rect alongside the exon at mode transitions.
    const rects = container.querySelectorAll<SVGRectElement>('.vv-pfam-rect');
    for (const r of rects) {
      expect(r.closest('.vv-exon-group')).not.toBeNull();
    }
  });

  it('renders centred labels with a tooltip carrying the full domain name', () => {
    const { mapper, viewport, painter, interaction } = setup();
    const t = pfamTrack({});

    function Probe() {
      return (
        <svg>
          {t.render({
            data: { domains: [domains[0]!] },
            rect: { yTop: 0, yBottom: 28 },
            viewport,
            mapper,
            interaction,
            painter,
          })}
        </svg>
      );
    }

    const { container } = render(<Probe />);
    const label = container.querySelector<SVGTextElement>('text.vv-pfam-label');
    expect(label).not.toBeNull();
    expect(label!.getAttribute('text-anchor')).toBe('middle');
    const title = label!.querySelector('title');
    expect(title?.textContent).toMatch(/Domain A description/);
  });

  it('returns null when there are no domains to render', () => {
    const { mapper, viewport, painter, interaction } = setup();
    const t = pfamTrack({});
    const out = t.render({
      data: { domains: [] },
      rect: { yTop: 0, yBottom: 28 },
      viewport,
      mapper,
      interaction,
      painter,
    });
    expect(out).toBeNull();
  });
});
