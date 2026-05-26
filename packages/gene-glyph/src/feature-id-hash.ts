/** Slice 35 — short stable hash for canonical feature ids when round-
 *  tripping selection through the URL. The gnomAD-style variant ids
 *  (`17-7674212-C-T`, or `11-5226947-ACCT…CCTGC-A` for big deletions)
 *  can be hundreds of characters; we'd rather not stamp those into
 *  `?selected=` verbatim. FNV-1a 32-bit → 8 hex chars is short, has
 *  no external dependencies, and collides rarely enough at our scale
 *  (a few hundred records per figure) that the URL→state lookup
 *  pairs the hash with a canonical id table built at placement time.
 *
 *  This is an obfuscation / shortening hash — not a cryptographic one.
 *  Hosts must always tolerate the raw canonical id in the URL too
 *  (backward compat with pre-Slice-35 share links). */

const FNV_OFFSET_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;

export function fnv1a32Hex(input: string): string {
  let h = FNV_OFFSET_32;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // Math.imul keeps the multiplication 32-bit; >>> 0 normalises into
    // an unsigned 32-bit number before the next iteration.
    h = Math.imul(h, FNV_PRIME_32);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Build a map keyed by `fnv1a32Hex(id)` → id. Hosts pass the iterable
 *  of canonical ids they want to round-trip through the URL; the
 *  resolver tries the raw URL value first (backward compat) and falls
 *  back to looking the hash up here. */
export function buildFeatureIdHashMap(
  ids: Iterable<string>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const id of ids) out.set(fnv1a32Hex(id), id);
  return out;
}

/** Resolve a URL `?selected=` value into the canonical id it referred
 *  to, given the set of currently-known ids. The lookup tries the raw
 *  value first so pre-Slice-35 share links (canonical id verbatim)
 *  keep working; only if that misses do we fall back to the hash
 *  table. Returns `null` when neither path matches — selection is
 *  silently dropped. */
export function resolveSelectedId(
  urlValue: string,
  knownIds: Iterable<string>,
): string | null {
  const trimmed = urlValue.trim();
  if (!trimmed) return null;
  const knownSet = new Set(knownIds);
  if (knownSet.has(trimmed)) return trimmed;
  for (const id of knownSet) {
    if (fnv1a32Hex(id) === trimmed) return id;
  }
  return null;
}
