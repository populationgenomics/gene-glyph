import { describe, expect, it } from 'vitest';
import {
  createCoordinateMapper,
  defaultCollapsedRegions,
  formatCdsPosition,
} from './coordinate-mapper.js';
import type { Exon, Transcript } from './types.js';

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
      start: { cPos: 100, offset: 11 }, // c.100+11 — first bulk bp
      end: { cPos: 101, offset: -11 }, // c.101-11 — last bulk bp
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

// Exon 1 of each transcript below aligns to the genome with two indels:
// genomic bases the transcript lacks (a 2 bp genomic gap after c.50) and
// transcript bases the genome lacks (c.81-82, a 2 bp c. gap). Exons 2 and
// 3 carry no blocks and map linearly.
function withGappedExon1(base: Transcript, blocks: Exon['blocks']): Transcript {
  const [first, ...rest] = base.exons;
  return { ...base, exons: [{ ...first!, blocks }, ...rest] };
}

const plusGapped = withGappedExon1(plusTranscript, [
  { cdsStart: 1, genomicStart: 1000, length: 50 }, // c.1-50 <-> 1000-1049
  { cdsStart: 51, genomicStart: 1052, length: 30 }, // c.51-80 <-> 1052-1081
  { cdsStart: 83, genomicStart: 1082, length: 18 }, // c.83-100 <-> 1082-1099
]);

const minusGapped = withGappedExon1(minusTranscript, [
  { cdsStart: 1, genomicStart: 3050, length: 50 }, // c.1-50 <-> 3099-3050
  { cdsStart: 51, genomicStart: 3018, length: 30 }, // c.51-80 <-> 3047-3018
  { cdsStart: 83, genomicStart: 3000, length: 18 }, // c.83-100 <-> 3017-3000
]);

describe('CoordinateMapper — exons with alignment blocks', () => {
  it.each([
    [1049, 50],
    [1052, 51],
    [1081, 80],
    [1082, 83],
    [1099, 100],
  ])('maps genomic %i to c.%i through the blocks on the + strand', (pos, cPos) => {
    const mapper = createCoordinateMapper(plusGapped);
    expect(mapper.genomicToCds('chr1', pos)).toEqual({ cPos, offset: 0 });
    expect(mapper.cdsToGenomic(cPos, 0)).toEqual({ chr: 'chr1', pos });
  });

  it.each([
    [3099, 1],
    [3050, 50],
    [3047, 51],
    [3018, 80],
    [3017, 83],
    [3000, 100],
  ])('maps genomic %i to c.%i through the blocks on the - strand', (pos, cPos) => {
    const mapper = createCoordinateMapper(minusGapped);
    expect(mapper.genomicToCds('chr1', pos)).toEqual({ cPos, offset: 0 });
    expect(mapper.cdsToGenomic(cPos, 0)).toEqual({ chr: 'chr1', pos });
  });

  it.each([
    ['+', 1050],
    ['+', 1051],
    ['-', 3048],
    ['-', 3049],
  ] as const)('gives a genomic-gap base no c. position (%s strand, %i)', (strand, pos) => {
    const mapper = createCoordinateMapper(strand === '+' ? plusGapped : minusGapped);
    expect(mapper.genomicToCds('chr1', pos)).toBeNull();
  });

  it.each([
    ['+', 81],
    ['+', 82],
    ['-', 81],
    ['-', 82],
  ] as const)('gives a c.-gap position no genomic base (%s strand, c.%i)', (strand, cPos) => {
    const mapper = createCoordinateMapper(strand === '+' ? plusGapped : minusGapped);
    expect(mapper.cdsToGenomic(cPos, 0)).toBeNull();
  });

  it('resolves a genomic coord in a genomic gap to no CDS position', () => {
    const mapper = createCoordinateMapper(plusGapped);
    expect(mapper.resolveCds({ kind: 'genomic', chr: 'chr1', pos: 1050 })).toBeNull();
  });

  it('keeps intronic offsets anchored on the exon edges', () => {
    const plus = createCoordinateMapper(plusGapped);
    expect(plus.genomicToCds('chr1', 1105)).toEqual({ cPos: 100, offset: 6 });
    expect(plus.cdsToGenomic(100, 6)).toEqual({ chr: 'chr1', pos: 1105 });
    const minus = createCoordinateMapper(minusGapped);
    expect(minus.genomicToCds('chr1', 2995)).toEqual({ cPos: 100, offset: 5 });
    expect(minus.cdsToGenomic(100, 5)).toEqual({ chr: 'chr1', pos: 2995 });
  });

  it.each([
    [
      'overlapping in c.',
      [
        { cdsStart: 1, genomicStart: 1000, length: 50 },
        { cdsStart: 50, genomicStart: 1052, length: 30 },
      ],
      /overlaps or precedes/,
    ],
    [
      'listed against transcript order',
      [
        { cdsStart: 51, genomicStart: 1052, length: 30 },
        { cdsStart: 1, genomicStart: 1000, length: 50 },
      ],
      /overlaps or precedes/,
    ],
    ['past the exon end in c.', [{ cdsStart: 90, genomicStart: 1080, length: 20 }], /outside c\./],
    [
      'past the exon end on the genome',
      [{ cdsStart: 1, genomicStart: 1090, length: 20 }],
      /outside 1000-1099/,
    ],
    ['of zero length', [{ cdsStart: 1, genomicStart: 1000, length: 0 }], /length 0/],
    ['that are empty', [], /blocks is empty/],
  ])('rejects blocks %s', (_name, blocks, message) => {
    expect(() => createCoordinateMapper(withGappedExon1(plusTranscript, blocks))).toThrow(message);
  });

  it('rejects - strand blocks listed in ascending genomic order', () => {
    const ascending = withGappedExon1(minusTranscript, [
      { cdsStart: 1, genomicStart: 3000, length: 50 },
      { cdsStart: 51, genomicStart: 3050, length: 50 },
    ]);
    expect(() => createCoordinateMapper(ascending)).toThrow(/overlaps or precedes/);
  });
});

// The transcripts below add UTRs to the three coding exons, renumbered 2-4:
// an exon wholly in the 5' UTR (exon 1, 50 bp), 20 bp of 5' UTR on exon 2,
// 10 bp of 3' UTR on exon 4, and an exon wholly in the 3' UTR (exon 5,
// 30 bp). c.-N is cPos 1 - N; c.*N is cPos 360 + N.
function withUtrs(
  base: Transcript,
  utr5Exon: [number, number],
  utr3Exon: [number, number],
): Transcript {
  return {
    ...base,
    exons: base.exons.map((e, i) => ({
      ...e,
      number: e.number + 1,
      ...(i === 0 ? { utr5Bp: 20 } : {}),
      ...(i === 2 ? { utr3Bp: 10 } : {}),
    })),
    utr5Exons: [{ number: 1, chr: 'chr1', genomicStart: utr5Exon[0], genomicEnd: utr5Exon[1] }],
    utr3Exons: [{ number: 5, chr: 'chr1', genomicStart: utr3Exon[0], genomicEnd: utr3Exon[1] }],
  };
}

const plusUtr = withUtrs(plusTranscript, [500, 549], [4000, 4029]);
const minusUtr = withUtrs(minusTranscript, [4000, 4049], [500, 529]);

describe('CoordinateMapper — UTR parts and exons wholly in a UTR', () => {
  it.each([
    [999, 0, 'c.-1'],
    [980, -19, 'c.-20'],
    [549, -20, 'c.-21'],
    [500, -69, 'c.-70'],
    [3110, 361, 'c.*1'],
    [3119, 370, 'c.*10'],
    [4000, 371, 'c.*11'],
    [4029, 400, 'c.*40'],
  ])('maps + strand genomic %i to %s and back', (pos, cPos, hgvs) => {
    const mapper = createCoordinateMapper(plusUtr);
    const cds = mapper.genomicToCds('chr1', pos);
    expect(cds).toEqual({ cPos, offset: 0 });
    expect(formatCdsPosition(cds!, 360)).toBe(hgvs);
    expect(mapper.cdsToGenomic(cPos, 0)).toEqual({ chr: 'chr1', pos });
  });

  it.each([
    [3100, 0, 'c.-1'],
    [3119, -19, 'c.-20'],
    [4000, -20, 'c.-21'],
    [4049, -69, 'c.-70'],
    [999, 361, 'c.*1'],
    [990, 370, 'c.*10'],
    [529, 371, 'c.*11'],
    [500, 400, 'c.*40'],
  ])('maps - strand genomic %i to %s and back', (pos, cPos, hgvs) => {
    const mapper = createCoordinateMapper(minusUtr);
    const cds = mapper.genomicToCds('chr1', pos);
    expect(cds).toEqual({ cPos, offset: 0 });
    expect(formatCdsPosition(cds!, 360)).toBe(hgvs);
    expect(mapper.cdsToGenomic(cPos, 0)).toEqual({ chr: 'chr1', pos });
  });

  it.each([
    [551, { cPos: -20, offset: 2 }, 'c.-21+2'],
    [975, { cPos: -19, offset: -5 }, 'c.-20-5'],
    [3500, { cPos: 370, offset: 381 }, 'c.*10+381'],
  ])('anchors + strand intronic %i in a UTR on the nearer UTR exon edge', (pos, cds, hgvs) => {
    const mapper = createCoordinateMapper(plusUtr);
    expect(mapper.genomicToCds('chr1', pos)).toEqual(cds);
    expect(formatCdsPosition(cds, 360)).toBe(hgvs);
    expect(mapper.cdsToGenomic(cds.cPos, cds.offset)).toEqual({ chr: 'chr1', pos });
  });

  it('anchors - strand intronic positions in a UTR on the nearer UTR exon edge', () => {
    const mapper = createCoordinateMapper(minusUtr);
    // 3995 lies 5 bp below the 5' UTR exon's 3' end (4000, c.-21).
    expect(mapper.genomicToCds('chr1', 3995)).toEqual({ cPos: -20, offset: 5 });
    expect(mapper.cdsToGenomic(-20, 5)).toEqual({ chr: 'chr1', pos: 3995 });
  });

  it('places a genomic position just upstream of the UTR off the transcript', () => {
    expect(createCoordinateMapper(plusUtr).genomicToCds('chr1', 499)).toBeNull();
  });

  it('leaves a transcript without UTR data mapping UTR positions off the transcript', () => {
    expect(createCoordinateMapper(plusTranscript).genomicToCds('chr1', 999)).toBeNull();
  });

  it.each([
    ['overlaps the first exon', [{ number: 1, chr: 'chr1', genomicStart: 960, genomicEnd: 990 }]],
    [
      'is out of transcript order',
      [
        { number: 1, chr: 'chr1', genomicStart: 600, genomicEnd: 649 },
        { number: 2, chr: 'chr1', genomicStart: 500, genomicEnd: 549 },
      ],
    ],
    ['is on another chromosome', [{ number: 1, chr: 'chr2', genomicStart: 500, genomicEnd: 549 }]],
    ['ends before it starts', [{ number: 1, chr: 'chr1', genomicStart: 549, genomicEnd: 500 }]],
  ])("rejects a 5' UTR exon that %s", (_name, utr5Exons) => {
    expect(() => createCoordinateMapper({ ...plusUtr, utr5Exons })).toThrow(/UTR exon/);
  });
});

describe('formatCdsPosition', () => {
  it.each([
    [{ cPos: 76, offset: 0 }, 'c.76'],
    [{ cPos: 100, offset: 5 }, 'c.100+5'],
    [{ cPos: 101, offset: -2 }, 'c.101-2'],
    [{ cPos: 0, offset: 0 }, 'c.-1'],
    [{ cPos: 361, offset: 0 }, 'c.*1'],
  ])('writes %o as %s', (pos, hgvs) => {
    expect(formatCdsPosition(pos, 360)).toBe(hgvs);
  });
});
