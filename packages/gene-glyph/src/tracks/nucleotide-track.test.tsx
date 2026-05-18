import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { createCoordinateMapper } from '../coordinate-mapper.js';
import { createSvgPainter } from '../painter/svg-painter.js';
import type { InteractionState, Transcript } from '../types.js';
import { ViewportController } from '../viewport.js';
import { nucleotideTrack } from './nucleotide-track.js';

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

function setup(transcript: Transcript, mode: 'cds-with-introns' | 'cds-spliced' | 'protein' = 'cds-with-introns') {
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

describe('nucleotideTrack', () => {
  it('reports zero height below the px-per-bp threshold (fit-gene zoom)', () => {
    // 60 bp over 600 px ≈ 10 px/bp at fit-gene, but inter-exon gap eats
    // some width — push the gene long enough that fit-gene is below 8 px/bp.
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
    const t = nucleotideTrack({ source: 'A'.repeat(600) });
    expect(t.height({ data: null, viewport, hint: { maxPx: 200 } }).px).toBe(0);
  });

  it('grows to letterFont + topPad above the threshold', () => {
    const { viewport } = setup(tinyGene);
    // 12 bp / 600 px → 50 px/bp at fit-gene, well above default 8 px/bp.
    const t = nucleotideTrack({ source: 'ACGTACGTACGT' });
    expect(t.height({ data: null, viewport, hint: { maxPx: 200 } })).toEqual({
      px: 12 + 2,
      didTruncate: false,
    });
  });

  it('reports zero height in protein mode regardless of zoom', () => {
    const { viewport } = setup(tinyGene, 'protein');
    const t = nucleotideTrack({ source: 'ACGTACGTACGT' });
    expect(t.height({ data: null, viewport, hint: { maxPx: 200 } }).px).toBe(0);
  });

  it('renders one letter per visible CDS bp with the correct fill', async () => {
    const { mapper, viewport, painter, interaction } = setup(tinyGene);
    const t = nucleotideTrack({ source: 'ACGTACGTACGT' });
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
    const letters = [...container.querySelectorAll<SVGTextElement>('.vv-nt-letter')];
    expect(letters.length).toBe(12);
    expect(letters.map((l) => l.textContent).join('')).toBe('ACGTACGTACGT');
    // First letter should land at bp 1.
    expect(letters[0]!.getAttribute('data-vv-cds-pos')).toBe('1');
    expect(letters[0]!.getAttribute('data-vv-nt')).toBe('A');
  });

  it("renders nothing below the threshold even when load() has run", async () => {
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
    const t = nucleotideTrack({ source: 'A'.repeat(600) });
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
    expect(container.querySelectorAll('.vv-nt-letter').length).toBe(0);
  });

  it('renders nothing in protein mode', async () => {
    const { mapper, viewport, painter, interaction } = setup(tinyGene, 'protein');
    const t = nucleotideTrack({ source: 'ACGTACGTACGT' });
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
    expect(container.querySelectorAll('.vv-nt-letter').length).toBe(0);
  });

  it('letters land inside the per-exon group of their bp', async () => {
    const { mapper, viewport, painter, interaction } = setup(midGene);
    const t = nucleotideTrack({ source: 'A'.repeat(30) + 'C'.repeat(30) });
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
    const allLetters = [...container.querySelectorAll<SVGTextElement>('.vv-nt-letter')];
    expect(allLetters.length).toBe(60);
    for (const l of allLetters) {
      const exonGroup = l.closest('.vv-exon-group');
      expect(exonGroup).not.toBeNull();
      const exonIdx = Number(exonGroup!.getAttribute('data-vv-exon-idx'));
      const pos = Number(l.getAttribute('data-vv-cds-pos'));
      // bp 1..30 → exon 0, bp 31..60 → exon 1.
      const expectedExon = pos <= 30 ? 0 : 1;
      expect(exonIdx).toBe(expectedExon);
    }
  });

  it('falls back to N for unknown letters in the source string', async () => {
    const { mapper, viewport, painter, interaction } = setup(tinyGene);
    const t = nucleotideTrack({ source: 'ACG?ACGTACGT' });
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
    const letters = [...container.querySelectorAll<SVGTextElement>('.vv-nt-letter')];
    expect(letters[3]!.textContent).toBe('N');
    expect(letters[3]!.getAttribute('data-vv-nt')).toBe('N');
  });

  it('honours a host-supplied palette override', async () => {
    const { mapper, viewport, painter, interaction } = setup(tinyGene);
    const t = nucleotideTrack({
      source: 'ACGTACGTACGT',
      palette: { A: '#abc123' },
    });
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
    const firstA = container.querySelector<SVGTextElement>('.vv-nt-letter[data-vv-nt="A"]');
    expect(firstA?.getAttribute('fill')).toBe('#abc123');
  });
});
