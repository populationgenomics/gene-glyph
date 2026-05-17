import { describe, expect, it } from 'vitest';
import {
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
