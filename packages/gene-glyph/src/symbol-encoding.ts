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
  /** Canonical lane order for stacked render. When supplied, the packer
   *  emits lane blocks in this sequence (top → bottom) regardless of
   *  the order records arrive in. Lane keys not in `laneOrder` are
   *  appended alphabetically after the declared keys, so the layout is
   *  deterministic even when the encoding adds new lanes later. Omit to
   *  fall back to alphabetical-by-key order. */
  laneOrder?: readonly string[];
  /** Human-readable label for each lane key. Used by tracks that paint
   *  per-lane section headers (e.g. the ClinVar stacked render's
   *  consequence-bucket dividers). Lanes whose keys aren't present here
   *  fall back to the key string itself; encodings that don't paint
   *  per-lane chrome can omit the field entirely. */
  laneLabels?: Record<string, string>;
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

export function variantCategoryColor(category: VariantCategory): string {
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
  // Canonical lane order — top → bottom. Loss-of-function first
  // (highest impact), then missense, regulatory, synonymous, other.
  // Determines stacking deterministically across reloads / data
  // sources so the same variant lands on the same row.
  laneOrder: ['lof', 'missense', 'regulatory', 'synonymous', 'other'],
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
  // Canonical lane order — top → bottom by clinical impact:
  // pathogenic / likely-pathogenic → uncertain → conflicting → benign /
  // likely-benign → other. Stable across reloads + gene changes so a
  // given record always lands on the same row regardless of fetch
  // ordering.
  laneOrder: ['path', 'vus', 'conflicting', 'benign', 'other'],
};

// ---------------------------------------------------------------------------
// DECIPHER-aligned ClinVar encoding (Slice 39)
// ---------------------------------------------------------------------------

/** Coarse consequence bucket used by {@link decipherClinVarSymbolEncoding}.
 *  Mirrors the four DECIPHER consequence colour classes plus a fallback
 *  bucket for anything outside coding-effect space (UTR / intronic /
 *  regulatory / non-coding). */
export type DecipherConsequenceBucket =
  | 'lof'
  | 'protein-changing'
  | 'splice-region'
  | 'synonymous'
  | 'other';

const DECIPHER_LOF = new Set([
  'stop_gained',
  'frameshift_variant',
  'splice_donor_variant',
  'splice_acceptor_variant',
  'start_lost',
  'stop_lost',
  'transcript_ablation',
]);

const DECIPHER_PROTEIN_CHANGING = new Set([
  'missense_variant',
  'inframe_insertion',
  'inframe_deletion',
  'protein_altering_variant',
]);

const DECIPHER_SPLICE_REGION = new Set([
  'splice_region_variant',
  'splice_polypyrimidine_tract_variant',
  'splice_donor_5th_base_variant',
  'splice_donor_region_variant',
]);

const DECIPHER_SYNONYMOUS = new Set([
  'synonymous_variant',
  'stop_retained_variant',
  'start_retained_variant',
]);

/** Bucket a raw VEP / SO consequence term into one of the four DECIPHER
 *  consequence classes (LoF, protein-changing, splice region, synonymous)
 *  or the fallback `'other'` for UTR / intronic / regulatory / non-coding.
 *  Pure function — the same input always returns the same bucket. */
export function decipherConsequenceBucket(
  consequence: string | null | undefined,
): DecipherConsequenceBucket {
  if (!consequence) return 'other';
  const c = consequence.toLowerCase();
  if (DECIPHER_LOF.has(c)) return 'lof';
  if (DECIPHER_PROTEIN_CHANGING.has(c)) return 'protein-changing';
  if (DECIPHER_SPLICE_REGION.has(c)) return 'splice-region';
  if (DECIPHER_SYNONYMOUS.has(c)) return 'synonymous';
  return 'other';
}

const DECIPHER_BUCKET_VAR: Record<DecipherConsequenceBucket, string> = {
  lof: 'vv-decipher-color-lof',
  'protein-changing': 'vv-decipher-color-protein-changing',
  'splice-region': 'vv-decipher-color-splice-region',
  synonymous: 'vv-decipher-color-synonymous',
  other: 'vv-decipher-color-other',
};

const DECIPHER_BUCKET_FALLBACK: Record<DecipherConsequenceBucket, string> = {
  lof: '#dc2626',
  'protein-changing': '#a16207',
  'splice-region': '#c026d3',
  synonymous: '#166534',
  other: '#94a3b8',
};

/** CSS-var-backed colour for a DECIPHER consequence bucket. Hosts can
 *  override each of the four buckets (plus the fallback) by setting the
 *  matching `--vv-decipher-color-*` custom property on the figure. */
export function decipherBucketColor(bucket: DecipherConsequenceBucket): string {
  return `var(--${DECIPHER_BUCKET_VAR[bucket]}, ${DECIPHER_BUCKET_FALLBACK[bucket]})`;
}

/** Pick the DECIPHER-aligned glyph shape for a raw consequence term.
 *  Square is reserved for `stop_gained` (DECIPHER's "location of protein
 *  truncating codons"); everything else — including frameshift, whose
 *  position is the indel rather than the downstream stop — uses
 *  `triangle-up`. */
export function decipherShapeFor(consequence: string | null | undefined): GlyphShape {
  if (!consequence) return 'triangle-up';
  return consequence.toLowerCase() === 'stop_gained' ? 'square' : 'triangle-up';
}

/**
 * DECIPHER-aligned ClinVar encoding (Slice 39). Reads the raw VEP
 * consequence from `record.meta.majorConsequence` and turns it into:
 *
 *   - **fill colour** — DECIPHER's four consequence classes (LoF /
 *     protein-changing / splice-region / synonymous), plus a grey
 *     fallback for non-coding;
 *   - **shape** — `square` for `stop_gained` (protein truncation),
 *     `triangle-up` otherwise (per DECIPHER's truncating-vs-not axis);
 *   - **lane** — same five buckets, top-to-bottom severity.
 *
 * Designed to live inside a per-significance ClinVar sub-track so each
 * sub-track reads as a mini consequence-distribution view; the
 * existing {@link defaultClinVarSymbolEncoding} stays for the single-
 * strip significance-on-glyph render.
 */
export const decipherClinVarSymbolEncoding: SymbolEncoding<ClinVarRecord> = {
  shape: (r) => decipherShapeFor(decipherMajorConsequence(r)),
  fill: (r) => decipherBucketColor(decipherConsequenceBucket(decipherMajorConsequence(r))),
  lane: (r) => decipherConsequenceBucket(decipherMajorConsequence(r)),
  laneOrder: ['lof', 'protein-changing', 'splice-region', 'synonymous', 'other'],
  laneLabels: {
    lof: 'LoF',
    'protein-changing': 'Protein-changing',
    'splice-region': 'Splice region',
    synonymous: 'Synonymous',
    other: 'Other',
  },
};

function decipherMajorConsequence(r: ClinVarRecord): string | undefined {
  const meta = (r.meta ?? {}) as { majorConsequence?: string };
  return meta.majorConsequence;
}
