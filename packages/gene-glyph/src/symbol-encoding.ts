import type { ClinVarRecord, ClinVarSignificance } from './tracks/clinvar-track.js';
import { clinVarSignificanceColor } from './tracks/clinvar-track.js';
import type { VariantCategory, ViewerVariant } from './types.js';

/**
 * Symbol vocabulary for stacked-variant rendering (Slice 27). One glyph
 * carries three orthogonal facts — shape, fill, colour — so the viewer can
 * encode e.g. category × predicted-effect × clinical-significance without a
 * legend lookup per variant.
 */
export type GlyphShape =
  | 'circle'
  | 'square'
  | 'triangle-up'
  | 'triangle-down'
  | 'diamond'
  | 'pentagon'
  | 'cross'
  | 'bar';

/**
 * Host-supplied encoding from a feature object to glyph attributes. `lane`
 * groups features into discrete vertical bands — items with the same lane
 * string share a contiguous row block, items with different lane strings
 * never share a row. Returning the same string from every call collapses
 * lane separation; omit `lane` for the same effect.
 */
export interface SymbolEncoding<T> {
  shape: (v: T) => GlyphShape;
  /** Fill colour (CSS string, typically `var(--…, fallback)`). */
  fill: (v: T) => string;
  /** Stroke colour for the glyph's outline. Defaults to `fill` when omitted. */
  color?: (v: T) => string;
  /** Optional row-group key. Items with the same string land in the same
   *  contiguous lane block; the rendering order across blocks follows the
   *  insertion order of the first item in each block. */
  lane?: (v: T) => string;
  /** Optional per-glyph radius override. Defaults to the track's `markRadius`. */
  radius?: (v: T) => number;
}

/**
 * Build an SVG `<path>` `d` string for `shape` centred at the origin and
 * inscribed in a circle of radius `r`. Pure geometry — no CSS, no transforms,
 * so the path data is stable across themes and reduced-motion paths.
 */
export function glyphPath(shape: GlyphShape, r: number): string {
  switch (shape) {
    case 'circle':
      return `M ${-r} 0 A ${r} ${r} 0 1 0 ${r} 0 A ${r} ${r} 0 1 0 ${-r} 0 Z`;
    case 'square': {
      const a = r * 0.9;
      return `M ${-a} ${-a} L ${a} ${-a} L ${a} ${a} L ${-a} ${a} Z`;
    }
    case 'triangle-up': {
      const a = r * 1.1;
      const h = a * 0.866;
      return `M 0 ${-a} L ${h} ${a * 0.5} L ${-h} ${a * 0.5} Z`;
    }
    case 'triangle-down': {
      const a = r * 1.1;
      const h = a * 0.866;
      return `M 0 ${a} L ${h} ${-a * 0.5} L ${-h} ${-a * 0.5} Z`;
    }
    case 'diamond':
      return `M 0 ${-r} L ${r} 0 L 0 ${r} L ${-r} 0 Z`;
    case 'pentagon': {
      // Five points equally spaced starting at the top (angle = -π/2).
      const points: string[] = [];
      for (let i = 0; i < 5; i++) {
        const angle = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
        const x = r * Math.cos(angle);
        const y = r * Math.sin(angle);
        points.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(3)} ${y.toFixed(3)}`);
      }
      points.push('Z');
      return points.join(' ');
    }
    case 'cross': {
      // Plus-sign / X — drawn as a thick plus so it reads at small sizes.
      const a = r;
      const b = r * 0.35;
      return [
        `M ${-b} ${-a}`,
        `L ${b} ${-a}`,
        `L ${b} ${-b}`,
        `L ${a} ${-b}`,
        `L ${a} ${b}`,
        `L ${b} ${b}`,
        `L ${b} ${a}`,
        `L ${-b} ${a}`,
        `L ${-b} ${b}`,
        `L ${-a} ${b}`,
        `L ${-a} ${-b}`,
        `L ${-b} ${-b}`,
        'Z',
      ].join(' ');
    }
    case 'bar': {
      // Short horizontal bar — visually distinct from a tick at small sizes.
      const a = r;
      const b = r * 0.35;
      return `M ${-a} ${-b} L ${a} ${-b} L ${a} ${b} L ${-a} ${b} Z`;
    }
  }
}

const CATEGORY_SHAPE: Record<VariantCategory, GlyphShape> = {
  missense: 'circle',
  nonsense: 'cross',
  synonymous: 'bar',
  frameshift: 'cross',
  inframe_indel: 'diamond',
  splice: 'triangle-down',
  start_lost: 'triangle-up',
  stop_lost: 'triangle-down',
  regulatory: 'square',
  utr: 'pentagon',
  intronic: 'bar',
  structural: 'triangle-up',
  other: 'square',
  unknown: 'circle',
};

const CATEGORY_LANE: Record<VariantCategory, string> = {
  nonsense: 'lof',
  frameshift: 'lof',
  start_lost: 'lof',
  stop_lost: 'lof',
  splice: 'lof',
  missense: 'missense',
  inframe_indel: 'missense',
  synonymous: 'synonymous',
  regulatory: 'regulatory',
  utr: 'regulatory',
  intronic: 'regulatory',
  structural: 'structural',
  other: 'other',
  unknown: 'other',
};

const VARIANT_CATEGORY_VAR: Record<VariantCategory, string> = {
  missense: 'vv-variant-color-missense',
  nonsense: 'vv-variant-color-nonsense',
  synonymous: 'vv-variant-color-synonymous',
  frameshift: 'vv-variant-color-frameshift',
  inframe_indel: 'vv-variant-color-inframe-indel',
  splice: 'vv-variant-color-splice',
  start_lost: 'vv-variant-color-start-lost',
  stop_lost: 'vv-variant-color-stop-lost',
  regulatory: 'vv-variant-color-regulatory',
  utr: 'vv-variant-color-utr',
  intronic: 'vv-variant-color-intronic',
  structural: 'vv-variant-color-structural',
  other: 'vv-variant-color-other',
  unknown: 'vv-variant-color-unknown',
};

const VARIANT_CATEGORY_FALLBACK: Record<VariantCategory, string> = {
  missense: '#f59e0b',
  nonsense: '#dc2626',
  synonymous: '#94a3b8',
  frameshift: '#b91c1c',
  inframe_indel: '#f97316',
  splice: '#8b5cf6',
  start_lost: '#dc2626',
  stop_lost: '#dc2626',
  regulatory: '#0ea5e9',
  utr: '#64748b',
  intronic: '#94a3b8',
  structural: '#ec4899',
  other: '#94a3b8',
  unknown: '#cbd5e1',
};

function variantCategoryColor(category: VariantCategory): string {
  return `var(--${VARIANT_CATEGORY_VAR[category]}, ${VARIANT_CATEGORY_FALLBACK[category]})`;
}

export function variantShapeFor(category: VariantCategory): GlyphShape {
  return CATEGORY_SHAPE[category];
}

export function variantLaneFor(category: VariantCategory): string {
  return CATEGORY_LANE[category];
}

/**
 * Default symbol encoding for {@link ViewerVariant}. Shape encodes category
 * (circle = missense, cross = nonsense/frameshift, triangle-down = splice/
 * stop_lost, …); fill encodes category colour; lane groups loss-of-function
 * vs missense vs synonymous so the stacked render reads as discrete bands.
 */
export const defaultVariantSymbolEncoding: SymbolEncoding<ViewerVariant> = {
  shape: (v) => variantShapeFor(v.category),
  fill: (v) => variantCategoryColor(v.category),
  lane: (v) => variantLaneFor(v.category),
};

const CLINVAR_SHAPE: Record<ClinVarSignificance, GlyphShape> = {
  pathogenic: 'diamond',
  likely_pathogenic: 'triangle-up',
  conflicting: 'pentagon',
  uncertain_significance: 'square',
  likely_benign: 'triangle-down',
  benign: 'circle',
  other: 'bar',
};

const CLINVAR_LANE: Record<ClinVarSignificance, string> = {
  pathogenic: 'path',
  likely_pathogenic: 'path',
  conflicting: 'conflicting',
  uncertain_significance: 'vus',
  likely_benign: 'benign',
  benign: 'benign',
  other: 'other',
};

/**
 * Default symbol encoding for {@link ClinVarRecord}. Shape and fill both
 * encode clinical significance (diamond+red = pathogenic, circle+green =
 * benign, …); lane groups path/likely-path together, benign/likely-benign
 * together, and segregates VUS / conflicting / other.
 */
export const defaultClinVarSymbolEncoding: SymbolEncoding<ClinVarRecord> = {
  shape: (r) => CLINVAR_SHAPE[r.significance],
  fill: (r) => clinVarSignificanceColor(r.significance),
  lane: (r) => CLINVAR_LANE[r.significance],
};
