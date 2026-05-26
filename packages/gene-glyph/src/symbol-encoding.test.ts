import { describe, expect, it } from 'vitest';
import {
  decipherBucketColor,
  decipherClinVarSymbolEncoding,
  decipherConsequenceBucket,
  decipherShapeFor,
  defaultClinVarSymbolEncoding,
  defaultVariantSymbolEncoding,
  glyphPath,
  variantLaneFor,
  variantShapeFor,
  type GlyphShape,
} from './symbol-encoding.js';
import type { ClinVarRecord } from './tracks/clinvar-track.js';
import type { ViewerVariant } from './types.js';

const ALL_SHAPES: GlyphShape[] = [
  'circle',
  'square',
  'triangle-up',
  'triangle-down',
  'diamond',
  'pentagon',
  'cross',
  'bar',
];

describe('glyphPath', () => {
  it('returns a closed path string for every shape', () => {
    for (const shape of ALL_SHAPES) {
      const d = glyphPath(shape, 5);
      expect(d).toMatch(/^M /);
      expect(d.endsWith('Z')).toBe(true);
    }
  });

  it('scales with radius', () => {
    const small = glyphPath('diamond', 2);
    const large = glyphPath('diamond', 10);
    expect(small).not.toEqual(large);
    // A diamond is built from ±r along each axis; the larger radius should
    // appear verbatim in its path data.
    expect(large).toContain('10');
    expect(small).toContain('-2');
  });

  it('produces a circle from two semicircular arcs', () => {
    const d = glyphPath('circle', 5);
    expect(d).toMatch(/^M -5 0 A 5 5 0 1 0 5 0 A 5 5 0 1 0 -5 0 Z$/);
  });
});

describe('defaultVariantSymbolEncoding', () => {
  it('maps loss-of-function categories into a single lane', () => {
    expect(variantLaneFor('nonsense')).toBe('lof');
    expect(variantLaneFor('frameshift')).toBe('lof');
    expect(variantLaneFor('splice')).toBe('lof');
    expect(variantLaneFor('start_lost')).toBe('lof');
    expect(variantLaneFor('stop_lost')).toBe('lof');
  });

  it('maps missense and inframe_indel into the missense lane', () => {
    expect(variantLaneFor('missense')).toBe('missense');
    expect(variantLaneFor('inframe_indel')).toBe('missense');
  });

  it('shape encodes category — missense=circle, nonsense=cross, splice=triangle-down', () => {
    expect(variantShapeFor('missense')).toBe('circle');
    expect(variantShapeFor('nonsense')).toBe('cross');
    expect(variantShapeFor('splice')).toBe('triangle-down');
    expect(variantShapeFor('synonymous')).toBe('bar');
  });

  it('encoding accessors return values for a representative variant', () => {
    const v: ViewerVariant = {
      id: 'x',
      label: 'x',
      coord: { kind: 'cds', cPos: 1, offset: 0 },
      category: 'missense',
    };
    expect(defaultVariantSymbolEncoding.shape(v)).toBe('circle');
    expect(defaultVariantSymbolEncoding.fill(v)).toContain('vv-variant-color-missense');
    expect(defaultVariantSymbolEncoding.lane!(v)).toBe('missense');
  });
});

describe('defaultClinVarSymbolEncoding', () => {
  it('groups path/likely-path and benign/likely-benign into shared lanes', () => {
    const path: ClinVarRecord = {
      id: 'a',
      label: 'a',
      chr: 'chr1',
      pos: 100,
      significance: 'pathogenic',
    };
    const lpath: ClinVarRecord = { ...path, id: 'b', significance: 'likely_pathogenic' };
    const benign: ClinVarRecord = { ...path, id: 'c', significance: 'benign' };
    const lbenign: ClinVarRecord = { ...path, id: 'd', significance: 'likely_benign' };
    expect(defaultClinVarSymbolEncoding.lane!(path)).toBe('path');
    expect(defaultClinVarSymbolEncoding.lane!(lpath)).toBe('path');
    expect(defaultClinVarSymbolEncoding.lane!(benign)).toBe('benign');
    expect(defaultClinVarSymbolEncoding.lane!(lbenign)).toBe('benign');
  });

  it('shape encodes significance — pathogenic=diamond, benign=circle, conflicting=pentagon', () => {
    const make = (s: ClinVarRecord['significance']): ClinVarRecord => ({
      id: 'x',
      label: 'x',
      chr: 'chr1',
      pos: 0,
      significance: s,
    });
    expect(defaultClinVarSymbolEncoding.shape(make('pathogenic'))).toBe('diamond');
    expect(defaultClinVarSymbolEncoding.shape(make('benign'))).toBe('circle');
    expect(defaultClinVarSymbolEncoding.shape(make('conflicting'))).toBe('pentagon');
    expect(defaultClinVarSymbolEncoding.shape(make('uncertain_significance'))).toBe('square');
  });
});

describe('decipherConsequenceBucket', () => {
  it('maps LoF-class consequences to "lof"', () => {
    for (const c of [
      'stop_gained',
      'frameshift_variant',
      'splice_donor_variant',
      'splice_acceptor_variant',
      'start_lost',
      'stop_lost',
      'transcript_ablation',
    ]) {
      expect(decipherConsequenceBucket(c)).toBe('lof');
    }
  });

  it('maps protein-changing consequences to "protein-changing"', () => {
    for (const c of [
      'missense_variant',
      'inframe_insertion',
      'inframe_deletion',
      'protein_altering_variant',
    ]) {
      expect(decipherConsequenceBucket(c)).toBe('protein-changing');
    }
  });

  it('maps splice-region-class consequences to "splice-region"', () => {
    for (const c of [
      'splice_region_variant',
      'splice_polypyrimidine_tract_variant',
      'splice_donor_5th_base_variant',
      'splice_donor_region_variant',
    ]) {
      expect(decipherConsequenceBucket(c)).toBe('splice-region');
    }
  });

  it('maps synonymous-class consequences to "synonymous"', () => {
    for (const c of [
      'synonymous_variant',
      'stop_retained_variant',
      'start_retained_variant',
    ]) {
      expect(decipherConsequenceBucket(c)).toBe('synonymous');
    }
  });

  it('falls back to "other" for non-coding / UTR / regulatory / null', () => {
    for (const c of [
      '5_prime_UTR_variant',
      '3_prime_UTR_variant',
      'intron_variant',
      'regulatory_region_variant',
      'non_coding_transcript_exon_variant',
      'intergenic_variant',
      '',
      null,
      undefined,
    ]) {
      expect(decipherConsequenceBucket(c)).toBe('other');
    }
  });

  it('is case-insensitive (gnomAD lowercases but be tolerant)', () => {
    expect(decipherConsequenceBucket('Stop_Gained')).toBe('lof');
    expect(decipherConsequenceBucket('MISSENSE_VARIANT')).toBe('protein-changing');
  });
});

describe('decipherShapeFor', () => {
  it('uses square only for stop_gained', () => {
    expect(decipherShapeFor('stop_gained')).toBe('square');
  });

  it('uses triangle-up for everything else, including frameshift', () => {
    expect(decipherShapeFor('frameshift_variant')).toBe('triangle-up');
    expect(decipherShapeFor('missense_variant')).toBe('triangle-up');
    expect(decipherShapeFor('synonymous_variant')).toBe('triangle-up');
    expect(decipherShapeFor('splice_donor_variant')).toBe('triangle-up');
    expect(decipherShapeFor(null)).toBe('triangle-up');
    expect(decipherShapeFor(undefined)).toBe('triangle-up');
  });
});

describe('decipherClinVarSymbolEncoding', () => {
  const make = (consequence: string | null): ClinVarRecord => ({
    id: `x-${consequence ?? 'null'}`,
    label: 'x',
    chr: 'chr1',
    pos: 0,
    significance: 'pathogenic',
    meta: consequence === null ? {} : { majorConsequence: consequence },
  });

  it('reads majorConsequence from record.meta', () => {
    const r = make('stop_gained');
    expect(decipherClinVarSymbolEncoding.shape(r)).toBe('square');
    expect(decipherClinVarSymbolEncoding.lane!(r)).toBe('lof');
    expect(decipherClinVarSymbolEncoding.fill(r)).toContain('vv-decipher-color-lof');
  });

  it('uses triangle-up for frameshift even though it goes in the LoF lane', () => {
    const r = make('frameshift_variant');
    expect(decipherClinVarSymbolEncoding.shape(r)).toBe('triangle-up');
    expect(decipherClinVarSymbolEncoding.lane!(r)).toBe('lof');
  });

  it('falls back to "other" lane + grey when majorConsequence is absent', () => {
    const r = make(null);
    expect(decipherClinVarSymbolEncoding.lane!(r)).toBe('other');
    expect(decipherClinVarSymbolEncoding.fill(r)).toContain('vv-decipher-color-other');
  });

  it('lane order is severity descending', () => {
    expect(decipherClinVarSymbolEncoding.laneOrder).toEqual([
      'lof',
      'protein-changing',
      'splice-region',
      'synonymous',
      'other',
    ]);
  });

  it('declares a human-readable label for every lane key', () => {
    const labels = decipherClinVarSymbolEncoding.laneLabels;
    expect(labels).toBeDefined();
    for (const key of decipherClinVarSymbolEncoding.laneOrder!) {
      expect(labels![key]).toBeDefined();
      expect(labels![key]!.length).toBeGreaterThan(0);
    }
  });
});

describe('decipherBucketColor', () => {
  it('returns a CSS-var-backed colour for every bucket', () => {
    for (const b of ['lof', 'protein-changing', 'splice-region', 'synonymous', 'other'] as const) {
      const v = decipherBucketColor(b);
      expect(v).toMatch(/^var\(--vv-decipher-color-/);
    }
  });
});
