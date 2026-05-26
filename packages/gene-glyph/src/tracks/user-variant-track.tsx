import type { SymbolEncoding } from '../symbol-encoding.js';
import type {
  DataSource,
  Track,
  ViewportQuery,
} from '../types.js';
import {
  clinVarTrack,
  type ClinVarRecord,
  type ClinVarSource,
  type ClinVarTrackData,
} from './clinvar-track.js';

/** Slice 34 — a user-supplied genomic variant. The minimum surface
 *  needed to project onto the figure: a stable id, a chromosome / pos
 *  pair (matching `exon.chr`'s `chrN` form), and an optional refLen for
 *  multi-bp deletions / MNVs. `label` is what the host shows in
 *  tooltips and detail cards — defaults to the id when omitted. */
export interface UserVariantRecord {
  id: string;
  chr: string;
  pos: number;
  label?: string;
  /** Reference allele length in bp; defaults to 1 (SNV). Multi-bp
   *  variants span a horizontal line from the anchor marker to the
   *  far end of the affected range, same as ClinVar deletions. */
  refLen?: number;
  /** Free-form metadata; surfaced verbatim in host tooltips / detail
   *  cards (e.g. the raw input string, REF/ALT, codon impact). */
  meta?: Record<string, unknown>;
}

export type UserVariantSource =
  | UserVariantRecord[]
  | DataSource<ViewportQuery, UserVariantRecord[]>;

export interface UserVariantTrackConfig {
  id?: string;
  source: UserVariantSource;
  markRadius?: number;
  stackLanePx?: number;
}

const USER_VARIANT_COLOR = 'var(--vv-user-variant-color, #7c3aed)';

/** Single-category encoding: cross glyph + deep-purple fill. User
 *  variants don't carry significance / star rating, so there's nothing
 *  to encode beyond "this is a user variant". `lane` is omitted so all
 *  glyphs share one packed-lane block. */
const USER_VARIANT_ENCODING: SymbolEncoding<ClinVarRecord> = {
  shape: () => 'cross',
  fill: () => USER_VARIANT_COLOR,
};

/** Symbolic key for the original {@link UserVariantRecord} stashed
 *  inside the synthesised ClinVar record's `meta`. Keeps the round-trip
 *  back to the host-facing shape without a parallel id table. */
const ORIGINAL_KEY = '__userVariantOriginal';

function toClinVarShaped(r: UserVariantRecord): ClinVarRecord {
  // Re-use the entire ClinVar render pipeline by adapting at the source
  // boundary. `significance: 'other'` is the cheapest neutral bucket;
  // the encoding above ignores significance entirely so the value is
  // never observed in the visible output. The original record rides in
  // `meta` so `resolveFeature` can hand the host its own shape back.
  return {
    id: r.id,
    label: r.label ?? r.id,
    chr: r.chr,
    pos: r.pos,
    significance: 'other',
    refLen: r.refLen,
    meta: { ...r.meta, [ORIGINAL_KEY]: r },
  };
}

function fromClinVarShaped(r: ClinVarRecord): UserVariantRecord {
  const original = (r.meta ?? {})[ORIGINAL_KEY] as UserVariantRecord | undefined;
  return original ?? {
    id: r.id,
    chr: r.chr,
    pos: r.pos,
    label: r.label,
    refLen: r.refLen,
    meta: r.meta,
  };
}

/** Build a track that renders user-supplied variants as purple crosses
 *  along the figure. Internally delegates to {@link clinVarTrack} —
 *  same `placeClinVarRecords` projection, same multi-bp span line,
 *  same intron-flank-aware truncation, same negative-strand handling.
 *  The thin wrapper adapts the data shape at the source boundary and
 *  overrides surface methods (`featureLabel`, `resolveFeature`,
 *  `toJSON`) so the public API speaks {@link UserVariantRecord}.
 *
 *  Slice 34. */
export function userVariantTrack(
  config: UserVariantTrackConfig,
): Track<UserVariantTrackConfig, ClinVarTrackData> {
  const id = config.id ?? 'user-variant-track';
  const userSource = config.source;
  const wrappedSource: ClinVarSource = Array.isArray(userSource)
    ? userSource.map(toClinVarShaped)
    : {
        id: userSource.id,
        cacheKey: userSource.cacheKey,
        freshness: userSource.freshness,
        async query(q, signal) {
          const original = await userSource.query(q, signal);
          return original.map(toClinVarShaped);
        },
      };
  const base = clinVarTrack({
    id,
    source: wrappedSource,
    stackedVariantStyle: USER_VARIANT_ENCODING,
    markRadius: config.markRadius,
    stackLanePx: config.stackLanePx,
  });

  return {
    ...base,
    resolveFeature(data, featureId) {
      const r = data.records.find((x) => x.id === featureId);
      return r ? fromClinVarShaped(r) : null;
    },
    featureLabel(data, featureId) {
      const r = data.records.find((x) => x.id === featureId);
      if (!r) return null;
      const orig = fromClinVarShaped(r);
      return orig.label ?? orig.id;
    },
    toJSON() {
      return {
        id,
        source: userSource,
        markRadius: config.markRadius,
        stackLanePx: config.stackLanePx,
      };
    },
  };
}

/** Recover the host-facing record from one loaded by
 *  {@link userVariantTrack}. Useful for host renderers (tooltips,
 *  detail cards) that consume the track's `data.records` directly
 *  rather than going through `resolveFeature`. */
export function userVariantFromRecord(r: ClinVarRecord): UserVariantRecord {
  return fromClinVarShaped(r);
}
