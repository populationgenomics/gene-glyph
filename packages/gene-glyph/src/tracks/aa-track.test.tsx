import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { createCoordinateMapper } from '../coordinate-mapper.js';
import { createSvgPainter } from '../painter/svg-painter.js';
import type { InteractionState, Transcript } from '../types.js';
import { ViewportController } from '../viewport.js';
import { aaTrack, translate } from './aa-track.js';

const tinyGene: Transcript = {
  geneSymbol: 'TINY',
  transcriptId: 'NM_TINY.1',
  cdsLength: 12,
  strand: '+',
  exons: [
    { number: 1, cdsStart: 1, cdsEnd: 12, genomicStart: 1000, genomicEnd: 1011, chr: 'chr1' },
  ],
};

const midGene: Transcript = {
  geneSymbol: 'MID',
  transcriptId: 'NM_MID.1',
  cdsLength: 60,
  strand: '+',
  exons: [
    { number: 1, cdsStart: 1, cdsEnd: 30, genomicStart: 1000, genomicEnd: 1029, chr: 'chr1' },
    { number: 2, cdsStart: 31, cdsEnd: 60, genomicStart: 2000, genomicEnd: 2029, chr: 'chr1' },
  ],
};

function setup(transcript: Transcript, mode: 'cds-with-introns' | 'cds-spliced' | 'protein' = 'cds-with-introns', width = 600) {
  const mapper = createCoordinateMapper(transcript);
  const viewport = new ViewportController({ mapper, width, mode });
  const painter = createSvgPainter({ mode: 'screen' });
  const interaction: InteractionState = {
    hoveredFeatureId: null,
    selectedFeatureIds: new Set(),
    brushRange: null,
  };
  return { mapper, viewport, painter, interaction };
}

describe('translate', () => {
  it('translates a CDS via the standard genetic code', () => {
    // ATG (M), GCC (A), TGA (*).
    expect(translate('ATGGCCTGA')).toBe('MA*');
  });

  it('drops any trailing partial codon', () => {
    expect(translate('ATGGC')).toBe('M');
    expect(translate('AT')).toBe('');
  });

  it('returns X for codons containing unknown letters', () => {
    expect(translate('ATGNNNTGA')).toBe('MX*');
  });

  it('honours a non-zero reading frame', () => {
    // frame=1 → 'TGG' (W), 'CC' (drop).
    expect(translate('ATGGCC', 1)).toBe('W');
  });
});

describe('aaTrack', () => {
  it('throws when neither source is supplied', () => {
    expect(() => aaTrack({})).toThrow(/proteinSource.*nucleotideSource/);
  });

  it('reports zero height in CDS mode at fit-gene for a long gene', () => {
    const longGene: Transcript = {
      geneSymbol: 'LONG',
      transcriptId: 'NM_LONG.1',
      cdsLength: 600,
      strand: '+',
      exons: [
        { number: 1, cdsStart: 1, cdsEnd: 600, genomicStart: 1000, genomicEnd: 1599, chr: 'chr1' },
      ],
    };
    const { viewport } = setup(longGene);
    const t = aaTrack({ nucleotideSource: 'A'.repeat(600) });
    // pxPerBp ≈ 1 → pxPerAa ≈ 3, below 14 threshold.
    expect(t.height({ data: null, viewport, hint: { maxPx: 200 } }).px).toBe(0);
  });

  it('grows above the threshold (CDS mode)', () => {
    const { viewport } = setup(tinyGene);
    // 12 bp / 600 px → 50 px/bp → 150 px/aa, well above 14.
    const t = aaTrack({ nucleotideSource: 'ATGGCCTGAATGG' });
    expect(t.height({ data: null, viewport, hint: { maxPx: 200 } })).toEqual({
      px: 14,
      didTruncate: false,
    });
  });

  it('grows above the threshold (protein mode)', () => {
    const proteinGene: Transcript = {
      geneSymbol: 'P',
      transcriptId: 'NM_P.1',
      cdsLength: 60,
      strand: '+',
      exons: [
        { number: 1, cdsStart: 1, cdsEnd: 60, genomicStart: 1000, genomicEnd: 1059, chr: 'chr1' },
      ],
    };
    const { viewport } = setup(proteinGene, 'protein');
    // aaLen = 20, width 600 → 30 px/aa, above 14.
    const t = aaTrack({ proteinSource: 'MAVLIFWSTNQDKRHCGPYE' });
    expect(t.height({ data: null, viewport, hint: { maxPx: 200 } }).px).toBe(14);
  });

  it('renders one letter per visible aa in CDS mode', async () => {
    const { mapper, viewport, painter, interaction } = setup(tinyGene);
    const t = aaTrack({ nucleotideSource: 'ATGGCCTGA' });
    const data = await t.load({ viewport, mapper, signal: new AbortController().signal, protein: null });
    // 9 bp → 3 codons (M, A, *).
    expect(data.sequence).toBe('MA*');

    const { container } = render(
      <svg>
        {t.render({
          data,
          rect: { yTop: 0, yBottom: 14 },
          viewport,
          mapper,
          interaction,
          painter,
        })}
      </svg>,
    );
    const letters = [...container.querySelectorAll<SVGTextElement>('.vv-aa-letter')];
    expect(letters.length).toBe(3);
    expect(letters.map((l) => l.textContent).join('')).toBe('MA*');
    expect(letters[0]!.getAttribute('data-vv-aa-pos')).toBe('1');
  });

  it('renders one letter per aa in protein mode using the supplied protein sequence', async () => {
    const proteinGene: Transcript = {
      geneSymbol: 'P',
      transcriptId: 'NM_P.1',
      cdsLength: 60,
      strand: '+',
      exons: [
        { number: 1, cdsStart: 1, cdsEnd: 60, genomicStart: 1000, genomicEnd: 1059, chr: 'chr1' },
      ],
    };
    const { mapper, viewport, painter, interaction } = setup(proteinGene, 'protein');
    const t = aaTrack({ proteinSource: 'MAVLIFWSTNQDKRHCGPYE' });
    const data = await t.load({ viewport, mapper, signal: new AbortController().signal, protein: null });
    const { container } = render(
      <svg>
        {t.render({
          data,
          rect: { yTop: 0, yBottom: 14 },
          viewport,
          mapper,
          interaction,
          painter,
        })}
      </svg>,
    );
    const letters = [...container.querySelectorAll<SVGTextElement>('.vv-aa-letter')];
    expect(letters.length).toBe(20);
    expect(letters.map((l) => l.textContent).join('')).toBe('MAVLIFWSTNQDKRHCGPYE');
  });

  it('renders nothing below the threshold', async () => {
    const longGene: Transcript = {
      geneSymbol: 'LONG',
      transcriptId: 'NM_LONG.1',
      cdsLength: 600,
      strand: '+',
      exons: [
        { number: 1, cdsStart: 1, cdsEnd: 600, genomicStart: 1000, genomicEnd: 1599, chr: 'chr1' },
      ],
    };
    const { mapper, viewport, painter, interaction } = setup(longGene);
    const t = aaTrack({ nucleotideSource: 'A'.repeat(600) });
    const data = await t.load({ viewport, mapper, signal: new AbortController().signal, protein: null });
    const { container } = render(
      <svg>
        {t.render({
          data,
          rect: { yTop: 0, yBottom: 0 },
          viewport,
          mapper,
          interaction,
          painter,
        })}
      </svg>,
    );
    expect(container.querySelectorAll('.vv-aa-letter').length).toBe(0);
  });

  it('places aa letters inside the per-exon group of their codon-centre bp', async () => {
    const { mapper, viewport, painter, interaction } = setup(midGene);
    // 60 bp → 20 codons. Codon 10's centre is bp 29 (exon 0); codon
    // 11's centre is bp 32 (exon 1).
    const t = aaTrack({ nucleotideSource: 'A'.repeat(60) });
    const data = await t.load({ viewport, mapper, signal: new AbortController().signal, protein: null });
    const { container } = render(
      <svg>
        {t.render({
          data,
          rect: { yTop: 0, yBottom: 14 },
          viewport,
          mapper,
          interaction,
          painter,
        })}
      </svg>,
    );
    const letters = [...container.querySelectorAll<SVGTextElement>('.vv-aa-letter')];
    expect(letters.length).toBe(20);
    for (const l of letters) {
      const exonGroup = l.closest('.vv-exon-group');
      expect(exonGroup).not.toBeNull();
      const exonIdx = Number(exonGroup!.getAttribute('data-vv-exon-idx'));
      const aa = Number(l.getAttribute('data-vv-aa-pos'));
      const expectedExon = aa <= 10 ? 0 : 1;
      expect(exonIdx).toBe(expectedExon);
    }
  });

  it('truncates partial codons during derivation', async () => {
    const { mapper, viewport } = setup(tinyGene);
    // 11 bp → 3 whole codons, last 2 bp dropped.
    const t = aaTrack({ nucleotideSource: 'ATGGCCTGAAT' });
    const data = await t.load({ viewport, mapper, signal: new AbortController().signal, protein: null });
    expect(data.sequence).toBe('MA*');
  });
});
