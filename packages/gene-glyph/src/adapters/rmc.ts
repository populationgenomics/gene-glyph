/**
 * Slice 40 — Regional Missense Constraint helpers.
 *
 * gnomAD v2 exposes RMC via the `gene.gnomad_v2_regional_missense_
 * constraint.regions` GraphQL field. Each region carries protein-coord
 * endpoints in three-letter codon strings (e.g. `"Lys2009"`) plus a
 * pair `(obs_exp, p_value)` that bins the region into one of five
 * intolerance tiers (plus a grey `not-significant` fallback when
 * `p_value > 0.001`).
 *
 * The helpers here are pure functions over the upstream shapes so they
 * can be unit-tested without a GraphQL round-trip; the playground's
 * gnomAD adapter wires them into the live data path.
 */

/** Six-bin category used by the RMC strip. Five intolerance tiers
 *  ordered from most-intolerant (red, lowest obs/exp) to least
 *  (light green, highest obs/exp); plus `not-significant` for regions
 *  whose `p_value > 0.001`. */
export type RmcCategory =
  | 'intol-1'
  | 'intol-2'
  | 'intol-3'
  | 'intol-4'
  | 'intol-5'
  | 'not-significant';

const THREE_LETTER_CODES: ReadonlySet<string> = new Set([
  // 20 canonical amino acids
  'Ala', 'Arg', 'Asn', 'Asp', 'Cys',
  'Glu', 'Gln', 'Gly', 'His', 'Ile',
  'Leu', 'Lys', 'Met', 'Phe', 'Pro',
  'Ser', 'Thr', 'Trp', 'Tyr', 'Val',
  // Termination + the two genetically encoded special cases.
  'Ter', 'Sec', 'Pyl',
]);

/** Parse a gnomAD RMC `aa_start` / `aa_stop` string (e.g. `"Lys2009"`)
 *  into its integer position. Handles all 20 canonical three-letter
 *  codes plus `Ter` (stop), `Sec` (selenocysteine), and `Pyl`
 *  (pyrrolysine). Returns `null` for malformed input so callers can
 *  skip rather than throw on a dirty row. */
export function parseAaStart(s: string): number | null {
  if (!s) return null;
  // Match a leading 3-letter code (case-insensitive on the prefix to
  // tolerate "LYS2009" / "lys2009") followed by the residue number.
  const m = /^([A-Za-z]{3})(\d+)$/.exec(s);
  if (!m) return null;
  const code = m[1]!;
  const normalised = code[0]!.toUpperCase() + code.slice(1).toLowerCase();
  if (!THREE_LETTER_CODES.has(normalised)) return null;
  const n = Number(m[2]);
  return Number.isFinite(n) ? n : null;
}

/** Assign an RMC region to one of the five intolerance bins, or to
 *  `'not-significant'` when `p_value > 0.001`. The p-value override
 *  fires first — a region with high obs/exp but high p_value still
 *  reads as uninformative grey rather than a bin colour. */
export function rmcCategoryFor(obsExp: number, pValue: number): RmcCategory {
  if (!Number.isFinite(pValue) || pValue > 0.001) return 'not-significant';
  if (!Number.isFinite(obsExp)) return 'not-significant';
  if (obsExp <= 0.2) return 'intol-1';
  if (obsExp <= 0.4) return 'intol-2';
  if (obsExp <= 0.6) return 'intol-3';
  if (obsExp <= 0.8) return 'intol-4';
  return 'intol-5';
}
