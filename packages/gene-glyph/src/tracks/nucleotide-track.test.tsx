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

function setup(transcript: Transcript, mode: 'genome' | 'transcript' | 'protein' = 'genome') {
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

function setupWithFlanks(transcript: Transcript, flankBp = 4) {
  const mapper = createCoordinateMapper(transcript);
  const collapsedRegions = [];
  for (let i = 0; i < transcript.exons.length - 1; i++) {
    collapsedRegions.push({
      start: { cPos: transcript.exons[i]!.cdsEnd, offset: flankBp + 1 },
      end: { cPos: transcript.exons[i + 1]!.cdsStart, offset: -(flankBp + 1) },
    });
  }
  const viewport = new ViewportController({
    mapper,
    width: 600,
    mode: 'genome',
    collapsedRegions,
  });
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

  it('renders intronic flank cells when a flank source is supplied', async () => {
    const { mapper, viewport, painter, interaction } = setupWithFlanks(midGene, 4);
    const t = nucleotideTrack({
      source: 'A'.repeat(30) + 'C'.repeat(30),
      flankSource: [{ intronIdx: 0, donor: 'GTAC', acceptor: 'TTAG' }],
    });
    const data = await t.load({
      viewport,
      mapper,
      signal: new AbortController().signal,
      protein: null,
    });
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
    const flankLetters = [
      ...container.querySelectorAll<SVGTextElement>('.vv-nt-letter-flank'),
    ];
    // 4 donor + 4 acceptor = 8 flank glyphs.
    expect(flankLetters.length).toBe(8);
    const donor = flankLetters.filter(
      (l) => l.getAttribute('data-vv-flank-side') === 'donor',
    );
    const acceptor = flankLetters.filter(
      (l) => l.getAttribute('data-vv-flank-side') === 'acceptor',
    );
    expect(donor.map((l) => l.textContent).join('')).toBe('GTAC');
    expect(acceptor.map((l) => l.textContent).join('')).toBe('TTAG');
    // Donor flank glyphs ride upstream exon 0; acceptor flank glyphs ride
    // downstream exon 1 (their host exon group, since the flanks live
    // inside the adjacent exon's <g>).
    for (const l of donor) {
      expect(l.closest('.vv-exon-group')?.getAttribute('data-vv-exon-idx')).toBe('0');
    }
    for (const l of acceptor) {
      expect(l.closest('.vv-exon-group')?.getAttribute('data-vv-exon-idx')).toBe('1');
    }
  });

  it('falls back to N when the flank source is short', async () => {
    const { mapper, viewport, painter, interaction } = setupWithFlanks(midGene, 4);
    const t = nucleotideTrack({
      source: 'A'.repeat(30) + 'C'.repeat(30),
      // Donor only 2 bp instead of 4; remaining cells should fill with N.
      flankSource: [{ intronIdx: 0, donor: 'GT', acceptor: 'NNNNAG' }],
    });
    const data = await t.load({
      viewport,
      mapper,
      signal: new AbortController().signal,
      protein: null,
    });
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
    const donor = [
      ...container.querySelectorAll<SVGTextElement>(
        '.vv-nt-letter-flank[data-vv-flank-side="donor"]',
      ),
    ];
    expect(donor.map((l) => l.textContent).join('')).toBe('GTNN');
  });

  it('skips flank rendering entirely when no flank source is given', async () => {
    const { mapper, viewport, painter, interaction } = setupWithFlanks(midGene, 4);
    const t = nucleotideTrack({ source: 'A'.repeat(30) + 'C'.repeat(30) });
    const data = await t.load({
      viewport,
      mapper,
      signal: new AbortController().signal,
      protein: null,
    });
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
    expect(container.querySelectorAll('.vv-nt-letter-flank').length).toBe(0);
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
