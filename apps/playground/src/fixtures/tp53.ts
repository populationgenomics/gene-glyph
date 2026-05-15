import type { ProteinAnnotations, Transcript } from '@populationgenomics/gene-glyph';

/**
 * TP53 (NM_000546.6) — a 10-exon CDS used as the default demonstration
 * transcript. Genomic coordinates are GRCh38 (chr17 on the minus strand),
 * rounded to keep the fixture compact and readable. The numbers are good
 * enough to drive the layout engine and produce a recognisable gene
 * schematic; exact base-perfect biology lives in lit-manager's adapters.
 */
export const TP53_TRANSCRIPT: Transcript = {
  geneSymbol: 'TP53',
  transcriptId: 'NM_000546.6',
  isManeSelect: true,
  cdsLength: 1182,
  strand: '-',
  exons: [
    { number: 2, cdsStart: 1, cdsEnd: 140, genomicStart: 7676521, genomicEnd: 7676660, chr: 'chr17' },
    { number: 3, cdsStart: 141, cdsEnd: 162, genomicStart: 7675994, genomicEnd: 7676015, chr: 'chr17' },
    { number: 4, cdsStart: 163, cdsEnd: 441, genomicStart: 7674181, genomicEnd: 7674459, chr: 'chr17' },
    { number: 5, cdsStart: 442, cdsEnd: 625, genomicStart: 7673700, genomicEnd: 7673883, chr: 'chr17' },
    { number: 6, cdsStart: 626, cdsEnd: 738, genomicStart: 7673535, genomicEnd: 7673647, chr: 'chr17' },
    { number: 7, cdsStart: 739, cdsEnd: 848, genomicStart: 7673192, genomicEnd: 7673301, chr: 'chr17' },
    { number: 8, cdsStart: 849, cdsEnd: 985, genomicStart: 7672878, genomicEnd: 7673014, chr: 'chr17' },
    { number: 9, cdsStart: 986, cdsEnd: 1059, genomicStart: 7670716, genomicEnd: 7670789, chr: 'chr17' },
    { number: 10, cdsStart: 1060, cdsEnd: 1166, genomicStart: 7669612, genomicEnd: 7669718, chr: 'chr17' },
    { number: 11, cdsStart: 1167, cdsEnd: 1182, genomicStart: 7668421, genomicEnd: 7668436, chr: 'chr17' },
  ],
};

/** A trimmed selection of TP53 protein-domain annotations — not used by the
 *  exon track itself but wired into the header (for the AlphaFold link) and
 *  ready to feed the Pfam / InterPro tracks landing in Slices 5–6. */
export const TP53_PROTEIN: ProteinAnnotations = {
  uniprotAcc: 'P04637',
  length: 393,
  alphafoldId: 'P04637',
  domains: [
    {
      aaStart: 1,
      aaEnd: 42,
      source: 'Pfam',
      sourceId: 'PF08563',
      shortName: 'TAD',
      description: 'P53 transactivation domain',
      entryType: 'domain',
    },
    {
      aaStart: 94,
      aaEnd: 312,
      source: 'Pfam',
      sourceId: 'PF00870',
      shortName: 'P53',
      description: 'P53 DNA-binding domain',
      entryType: 'domain',
    },
    {
      aaStart: 323,
      aaEnd: 356,
      source: 'Pfam',
      sourceId: 'PF07710',
      shortName: 'P53_tetramer',
      description: 'P53 tetramerisation motif',
      entryType: 'domain',
    },
  ],
};
