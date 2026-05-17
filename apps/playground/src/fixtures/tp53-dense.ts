import type { ViewerVariant } from '@populationgenomics/gene-glyph';
import { TP53_TRANSCRIPT } from './tp53.js';

/**
 * Generated dense TP53 variant set for the stacked-render scenario (Slice 27).
 * The variants are synthetic — clustered around the DNA-binding domain
 * (codons 100–300) so the stacked render has something interesting to show
 * at fit-gene zoom: deep lane columns near R175 / R248 / R273 / R282, sparse
 * coverage elsewhere. Categories rotate so every lane group is exercised.
 *
 * Numbers are deterministic (seeded) so visual regression tests and
 * Playwright spec snapshots don't drift between runs.
 */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CATEGORIES: ViewerVariant['category'][] = [
  'missense',
  'missense',
  'missense',
  'missense',
  'nonsense',
  'frameshift',
  'splice',
  'synonymous',
  'synonymous',
  'inframe_indel',
];

function buildDenseVariants(): ViewerVariant[] {
  const rand = mulberry32(27);
  const cdsLen = TP53_TRANSCRIPT.cdsLength;
  const out: ViewerVariant[] = [];
  // Hotspot column: 20 variants clustered around codon 248 (cPos ~743).
  for (let i = 0; i < 20; i++) {
    const cPos = 743 + Math.floor((rand() - 0.5) * 6);
    const category = CATEGORIES[Math.floor(rand() * CATEGORIES.length)]!;
    out.push({
      id: `hot248-${i}`,
      label: `c.${cPos}${'ACGT'[Math.floor(rand() * 4)]}>${'ACGT'[Math.floor(rand() * 4)]}`,
      coord: { kind: 'cds', cPos, offset: 0 },
      category,
    });
  }
  // Hotspot column at R175 (cPos ~524).
  for (let i = 0; i < 12; i++) {
    const cPos = 524 + Math.floor((rand() - 0.5) * 4);
    const category = CATEGORIES[Math.floor(rand() * CATEGORIES.length)]!;
    out.push({
      id: `hot175-${i}`,
      label: `c.${cPos}${'ACGT'[Math.floor(rand() * 4)]}>${'ACGT'[Math.floor(rand() * 4)]}`,
      coord: { kind: 'cds', cPos, offset: 0 },
      category,
    });
  }
  // Hotspot column at R273 (cPos ~818).
  for (let i = 0; i < 10; i++) {
    const cPos = 818 + Math.floor((rand() - 0.5) * 4);
    const category = CATEGORIES[Math.floor(rand() * CATEGORIES.length)]!;
    out.push({
      id: `hot273-${i}`,
      label: `c.${cPos}${'ACGT'[Math.floor(rand() * 4)]}>${'ACGT'[Math.floor(rand() * 4)]}`,
      coord: { kind: 'cds', cPos, offset: 0 },
      category,
    });
  }
  // Sparse coverage across the rest of the CDS.
  for (let i = 0; i < 30; i++) {
    const cPos = 1 + Math.floor(rand() * (cdsLen - 1));
    const category = CATEGORIES[Math.floor(rand() * CATEGORIES.length)]!;
    out.push({
      id: `sparse-${i}`,
      label: `c.${cPos}${'ACGT'[Math.floor(rand() * 4)]}>${'ACGT'[Math.floor(rand() * 4)]}`,
      coord: { kind: 'cds', cPos, offset: 0 },
      category,
    });
  }
  return out;
}

export const TP53_DENSE_VARIANTS: ViewerVariant[] = buildDenseVariants();
