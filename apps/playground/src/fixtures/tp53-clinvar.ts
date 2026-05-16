import type { ClinVarRecord } from '@populationgenomics/gene-glyph';

/**
 * A curated slice of real TP53 ClinVar records, picked to give the cluster
 * track something interesting to show at fit-gene zoom: a dense pile of
 * pathogenic missense calls around codon 175 / 248 / 273 / 282 (the canonical
 * hotspot residues), a couple of likely-benign singletons, and one
 * conflicting record. Coordinates are GRCh38 — the same assembly used by
 * `TP53_TRANSCRIPT`. This fixture stands in for a live `createClinVarDataSource`
 * call so the playground stays offline; the adapter is wired and tested
 * separately.
 */
export const TP53_CLINVAR: ClinVarRecord[] = [
  // R175H hotspot — multiple submissions, all pathogenic.
  {
    id: 'VCV000012345',
    label: 'c.524G>A (p.R175H)',
    chr: 'chr17',
    pos: 7675088,
    significance: 'pathogenic',
    condition: 'Li-Fraumeni syndrome',
  },
  {
    id: 'VCV000012346',
    label: 'c.523C>T',
    chr: 'chr17',
    pos: 7675089,
    significance: 'pathogenic',
    condition: 'Li-Fraumeni syndrome',
  },
  {
    id: 'VCV000012347',
    label: 'c.525C>G (p.R175S)',
    chr: 'chr17',
    pos: 7675087,
    significance: 'likely_pathogenic',
  },
  // R248Q hotspot.
  {
    id: 'VCV000012501',
    label: 'c.743G>A (p.R248Q)',
    chr: 'chr17',
    pos: 7674220,
    significance: 'pathogenic',
    condition: 'Hereditary cancer-predisposing syndrome',
  },
  {
    id: 'VCV000012502',
    label: 'c.742C>T (p.R248W)',
    chr: 'chr17',
    pos: 7674221,
    significance: 'pathogenic',
  },
  // R273H hotspot.
  {
    id: 'VCV000013014',
    label: 'c.818G>A (p.R273H)',
    chr: 'chr17',
    pos: 7674145,
    significance: 'pathogenic',
    condition: 'Li-Fraumeni syndrome',
  },
  {
    id: 'VCV000013015',
    label: 'c.817C>T (p.R273C)',
    chr: 'chr17',
    pos: 7674146,
    significance: 'pathogenic',
  },
  // R282W.
  {
    id: 'VCV000013211',
    label: 'c.844C>T (p.R282W)',
    chr: 'chr17',
    pos: 7674119,
    significance: 'pathogenic',
  },
  // Isolated VUS in exon 5.
  {
    id: 'VCV000013989',
    label: 'c.420A>G (p.K140K)',
    chr: 'chr17',
    pos: 7676441,
    significance: 'uncertain_significance',
  },
  // Conflicting call elsewhere in the DNA-binding domain.
  {
    id: 'VCV000014001',
    label: 'c.747G>T (p.R249S)',
    chr: 'chr17',
    pos: 7674216,
    significance: 'conflicting',
  },
  // Likely benign singletons in later exons.
  {
    id: 'VCV000015027',
    label: 'c.1075G>A (p.A359T)',
    chr: 'chr17',
    pos: 7670703,
    significance: 'likely_benign',
  },
  {
    id: 'VCV000015028',
    label: 'c.1145T>C',
    chr: 'chr17',
    pos: 7669627,
    significance: 'benign',
    condition: 'not provided',
  },
];
