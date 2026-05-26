/** Slice 34 — local parser for user-supplied variants.
 *
 *  Accepts the common genomic spellings clinicians paste from VCF / gnomAD
 *  / IGV / their own pipelines:
 *
 *    chr:pos REF>ALT     e.g. `17:7674212C>T`
 *    chr:pos-REF-ALT     e.g. `chr1:12345-C-T`
 *    chr-pos-REF-ALT     e.g. `17-7674212-C-A`  (gnomAD canonical)
 *
 *  Tolerant of: an optional `chr` prefix, mixed-case REF/ALT, leading /
 *  trailing whitespace, and stray internal whitespace (the "chr1:12345C >G"
 *  shape a paste from a status bar often grows). Strict about everything
 *  else — anything we can't reduce to `<chr>-<pos>-<REF>-<ALT>` returns
 *  null and the entry surfaces in the embed's parse-error footer.
 *
 *  HGVS forms (`c.`, `p.`, `g.`, `n.`) are *not* handled here; Slice 36
 *  routes them through VariantValidator. */

export interface ParsedUserVariant {
  /** Canonical gnomAD-style id — `<chr>-<pos>-<REF>-<ALT>`, no `chr` prefix.
   *  Shared with ClinVar's id space so selection / lookup logic doesn't
   *  need to know which surface produced the record. */
  id: string;
  /** Chromosome with `chr` prefix (matches the form transcripts use for
   *  exon.chr — `chr17`, `chrX`). */
  chr: string;
  pos: number;
  ref: string;
  alt: string;
  /** Raw input as the user typed it; surfaced in tooltips / detail cards
   *  so they recognise their own paste. */
  raw: string;
}

/** Parse one entry. Returns `null` if the string isn't a recognised
 *  genomic-form variant. */
export function parseUserVariant(raw: string): ParsedUserVariant | null {
  if (typeof raw !== 'string') return null;
  const original = raw;
  // Strip every whitespace character — clinical pastes sometimes drag a
  // soft hyphen or a stray space mid-token (the "chr1:12345C >G" case).
  const s = raw.replace(/\s+/g, '');
  if (!s) return null;
  // Reject anything that smells like HGVS — those go through VV in Slice
  // 36. Cheap prefix sniff so the regexes below don't have to half-match
  // a c./p./g./n. coordinate and produce nonsense canonical ids.
  if (/^(?:c|p|g|n|r|m)\./i.test(s)) return null;

  const match = TRY_FORMS.map((re) => re.exec(s)).find((m): m is RegExpExecArray => m !== null);
  if (!match) return null;
  const [, chrRaw, posRaw, refRaw, altRaw] = match;
  const chrShort = chrRaw.toUpperCase();
  const chr = chrShort.startsWith('CHR') ? chrShort : `chr${chrShort}`;
  // Canonical id uses the short chr (no `chr` prefix), matching gnomAD's
  // own id format (`17-7674212-C-T`). The record's `chr` field carries
  // the prefixed form because that's what exon.chr stores.
  const ref = refRaw.toUpperCase();
  const alt = altRaw.toUpperCase();
  const pos = Number(posRaw);
  if (!Number.isFinite(pos) || pos <= 0) return null;
  const idChr = chrShort.replace(/^CHR/, '');
  return {
    id: `${idChr}-${pos}-${ref}-${alt}`,
    chr,
    pos,
    ref,
    alt,
    raw: original,
  };
}

/** Each accepted form: `(chr)(pos)(ref)(alt)` in that capture order. */
const TRY_FORMS: readonly RegExp[] = [
  // `chr-pos-REF-ALT` — gnomAD canonical.
  /^(?:chr)?([0-9]+|X|Y|M|MT)-(\d+)-([A-Za-z]+)-([A-Za-z]+)$/i,
  // `chr:pos-REF-ALT`.
  /^(?:chr)?([0-9]+|X|Y|M|MT):(\d+)-([A-Za-z]+)-([A-Za-z]+)$/i,
  // `chr:posREF>ALT`.
  /^(?:chr)?([0-9]+|X|Y|M|MT):(\d+)([A-Za-z]+)>([A-Za-z]+)$/i,
];

export interface ParseUserVariantsResult {
  parsed: ParsedUserVariant[];
  errors: string[];
}

/** Parse a CSV / line-broken / comma-broken list of user variants.
 *  Splits on commas and newlines, ignores empty tokens, deduplicates by
 *  canonical id (first occurrence wins so the raw form the user typed
 *  stays in the record). */
export function parseUserVariants(input: string): ParseUserVariantsResult {
  const parsed: ParsedUserVariant[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const token of input.split(/[,\n]/)) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    const result = parseUserVariant(trimmed);
    if (!result) {
      errors.push(trimmed);
      continue;
    }
    if (seen.has(result.id)) continue;
    seen.add(result.id);
    parsed.push(result);
  }
  return { parsed, errors };
}
