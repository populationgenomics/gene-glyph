import { describe, expect, it } from 'vitest';
import { createCoordinateMapper, defaultCollapsedRegions } from './coordinate-mapper.js';
import type { Transcript } from './types.js';

// Three-exon transcript on the '+' strand.
// CDS coordinates are 1-based and contiguous: exon 1 = c.1-100,
// exon 2 = c.101-250 (length 150), exon 3 = c.251-360 (length 110).
// cdsLength = 360 (120 amino acids).
const plusTranscript: Transcript = {
  geneSymbol: 'TEST',
  transcriptId: 'NM_TEST.1',
  cdsLength: 360,
  strand: '+',
  exons: [
    { number: 1, cdsStart: 1, cdsEnd: 100, genomicStart: 1000, genomicEnd: 1099, chr: 'chr1' },
    { number: 2, cdsStart: 101, cdsEnd: 250, genomicStart: 2000, genomicEnd: 2149, chr: 'chr1' },
    { number: 3, cdsStart: 251, cdsEnd: 360, genomicStart: 3000, genomicEnd: 3109, chr: 'chr1' },
  ],
};

// Same CDS layout on the '-' strand. Exons are still listed in transcript order
// (5' -> 3'), which means they descend in genomic order.
const minusTranscript: Transcript = {
  geneSymbol: 'TEST',
  transcriptId: 'NM_TEST.2',
  cdsLength: 360,
  strand: '-',
  exons: [
    { number: 1, cdsStart: 1, cdsEnd: 100, genomicStart: 3000, genomicEnd: 3099, chr: 'chr1' },
    { number: 2, cdsStart: 101, cdsEnd: 250, genomicStart: 2000, genomicEnd: 2149, chr: 'chr1' },
    { number: 3, cdsStart: 251, cdsEnd: 360, genomicStart: 1000, genomicEnd: 1109, chr: 'chr1' },
  ],
};

describe('CoordinateMapper — CDS <-> protein round trip', () => {
  const mapper = createCoordinateMapper(plusTranscript);

  it('cdsToProtein and proteinToCds compose to the identity on aa', () => {
    for (const aa of [1, 2, 17, 50, 119, 120]) {
      const cPos = mapper.proteinToCds(aa);
      expect(mapper.cdsToProtein(cPos)).toBe(aa);
    }
  });

  it('cdsToProtein returns the correct codon for each base in a codon', () => {
    // aa 5 spans cPos 13, 14, 15. All three must map back to 5.
    const first = mapper.proteinToCds(5);
    expect(first).toBe(13);
    expect(mapper.cdsToProtein(13)).toBe(5);
    expect(mapper.cdsToProtein(14)).toBe(5);
    expect(mapper.cdsToProtein(15)).toBe(5);
  });

  it('cdsToProtein returns null for UTR / out-of-bounds positions', () => {
    expect(mapper.cdsToProtein(0)).toBeNull();
    expect(mapper.cdsToProtein(-3)).toBeNull();
    expect(mapper.cdsToProtein(361)).toBeNull();
  });
});

describe('CoordinateMapper — genomic <-> CDS round trip', () => {
  it('round-trips exonic positions on the + strand', () => {
    const mapper = createCoordinateMapper(plusTranscript);
    const samples = [
      { chr: 'chr1', pos: 1000 }, // exon 1 start
      { chr: 'chr1', pos: 1099 }, // exon 1 end
      { chr: 'chr1', pos: 2075 }, // mid exon 2
      { chr: 'chr1', pos: 3000 }, // exon 3 start
      { chr: 'chr1', pos: 3109 }, // exon 3 end
    ];
    for (const s of samples) {
      const cds = mapper.genomicToCds(s.chr, s.pos);
      expect(cds).not.toBeNull();
      const back = mapper.cdsToGenomic(cds!.cPos, cds!.offset);
      expect(back).toEqual(s);
    }
  });

  it('round-trips exonic positions on the - strand', () => {
    const mapper = createCoordinateMapper(minusTranscript);
    const samples = [
      { chr: 'chr1', pos: 3099 }, // exon 1 (5'-most genomic-rightmost)
      { chr: 'chr1', pos: 3000 }, // exon 1 (other end)
      { chr: 'chr1', pos: 2075 }, // mid exon 2
      { chr: 'chr1', pos: 1109 }, // exon 3 5' edge
      { chr: 'chr1', pos: 1000 }, // exon 3 3' edge
    ];
    for (const s of samples) {
      const cds = mapper.genomicToCds(s.chr, s.pos);
      expect(cds).not.toBeNull();
      const back = mapper.cdsToGenomic(cds!.cPos, cds!.offset);
      expect(back).toEqual(s);
    }
  });

  it('produces correct CDS positions at exon boundaries (+ strand)', () => {
    const mapper = createCoordinateMapper(plusTranscript);
    expect(mapper.genomicToCds('chr1', 1000)).toEqual({ cPos: 1, offset: 0 });
    expect(mapper.genomicToCds('chr1', 1099)).toEqual({ cPos: 100, offset: 0 });
    expect(mapper.genomicToCds('chr1', 2000)).toEqual({ cPos: 101, offset: 0 });
  });

  it('maps intronic positions to a nearest-exon anchor with offset (+ strand)', () => {
    const mapper = createCoordinateMapper(plusTranscript);
    // Intron between exon 1 (genomicEnd 1099) and exon 2 (genomicStart 2000).
    // pos 1110 is 11bp into intron from the donor side -> c.100+11.
    expect(mapper.genomicToCds('chr1', 1110)).toEqual({ cPos: 100, offset: 11 });
    // pos 1995 is 5bp upstream of acceptor -> c.101-5.
    expect(mapper.genomicToCds('chr1', 1995)).toEqual({ cPos: 101, offset: -5 });
  });

  it('maps intronic positions correctly on the - strand', () => {
    const mapper = createCoordinateMapper(minusTranscript);
    // Intron between exon 1 (5' end, genomicStart 3000) and exon 2 (genomicEnd 2149).
    // pos 2990 is 10bp downstream of exon 1's 3' splice donor (5'-end in genomic terms).
    expect(mapper.genomicToCds('chr1', 2990)).toEqual({ cPos: 100, offset: 10 });
    // pos 2155 is 6bp upstream of exon 2 acceptor.
    expect(mapper.genomicToCds('chr1', 2155)).toEqual({ cPos: 101, offset: -6 });
  });

  it('round-trips intronic positions through cdsToGenomic', () => {
    const mapper = createCoordinateMapper(plusTranscript);
    const intronicSamples = [
      { chr: 'chr1', pos: 1110 },
      { chr: 'chr1', pos: 1995 },
      { chr: 'chr1', pos: 2200 },
      { chr: 'chr1', pos: 2995 },
    ];
    for (const s of intronicSamples) {
      const cds = mapper.genomicToCds(s.chr, s.pos);
      expect(cds).not.toBeNull();
      const back = mapper.cdsToGenomic(cds!.cPos, cds!.offset);
      expect(back).toEqual(s);
    }
  });

  it('returns null for positions outside any exon or intron of the transcript', () => {
    const mapper = createCoordinateMapper(plusTranscript);
    expect(mapper.genomicToCds('chr1', 500)).toBeNull(); // before transcript
    expect(mapper.genomicToCds('chr1', 5000)).toBeNull(); // after transcript
    expect(mapper.genomicToCds('chrX', 1050)).toBeNull(); // wrong chromosome
  });
});

describe('defaultCollapsedRegions — Phase 3 soft-collapse spec', () => {
  it('emits one region per intron with HGVS c. offsets `+(flankBp+1) .. -(flankBp+1)`', () => {
    const regions = defaultCollapsedRegions(plusTranscript);
    expect(regions).toHaveLength(2); // 3 exons → 2 introns
    expect(regions[0]).toEqual({
      start: { cPos: 100, offset: 11 },  // c.100+11 — first bulk bp
      end: { cPos: 101, offset: -11 },   // c.101-11 — last bulk bp
    });
    expect(regions[1]).toEqual({
      start: { cPos: 250, offset: 11 },
      end: { cPos: 251, offset: -11 },
    });
  });

  it('respects a custom flankBp (used for tests / hosts that want a different splice-site window)', () => {
    const regions = defaultCollapsedRegions(plusTranscript, 20);
    expect(regions[0]!.start.offset).toBe(21);
    expect(regions[0]!.end.offset).toBe(-21);
  });

  it('returns an empty array for single-exon transcripts (no introns to compress)', () => {
    const oneExon: Transcript = {
      geneSymbol: 'X',
      transcriptId: 'X.1',
      cdsLength: 9,
      strand: '+',
      exons: [{ number: 1, cdsStart: 1, cdsEnd: 9, genomicStart: 1, genomicEnd: 9, chr: 'chr1' }],
    };
    expect(defaultCollapsedRegions(oneExon)).toEqual([]);
  });
});
