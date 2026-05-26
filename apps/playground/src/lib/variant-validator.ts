/** Slice 36 — thin client over the VariantValidator REST API.
 *
 *  Endpoint: `/VariantValidator/variantvalidator/{genome_build}/{variant}/{transcripts}`
 *  Docs: https://rest.variantvalidator.org/
 *
 *  VV resolves HGVS forms (`c.524G>A`, `p.Arg175His`, `g.7674212C>T`)
 *  into the canonical gnomAD-style `chr-pos-REF-ALT` id we use as the
 *  user-variant ID space. We assume GRCh38 across the embed — matching
 *  the playground's gnomAD source — and route any HGVS the local
 *  parser can't handle through here.
 *
 *  The client deliberately stays minimal: one POST-free GET per
 *  variant, parsed for the `primary_assembly_loci.grch38.vcf` block,
 *  no retries, no service-worker, no per-build override. Failure
 *  reasons (network, rate-limit, VV "warning" response) collapse to
 *  one `VVError` so the host can route the variant into the existing
 *  parse-error footer. */

const VV_BASE = 'https://rest.variantvalidator.org';

export interface VVResolvedVariant {
  /** Raw input string as the caller supplied it. */
  raw: string;
  /** Canonical `chr-pos-REF-ALT` (no `chr` prefix), matching the
   *  gnomAD id space the embed already uses. */
  id: string;
  /** `chrN` form for matching against `exon.chr`. */
  chr: string;
  pos: number;
  ref: string;
  alt: string;
}

export class VVError extends Error {
  readonly raw: string;
  constructor(raw: string, message: string) {
    super(message);
    this.name = 'VVError';
    this.raw = raw;
  }
}

interface VVResponseEntry {
  primary_assembly_loci?: {
    grch38?: {
      vcf?: {
        chr?: string;
        pos?: string;
        ref?: string;
        alt?: string;
      };
    };
  };
}

/** In-flight resolution registry keyed by `${transcriptId}|${lc(raw)}`.
 *  React's StrictMode double-mounts the embed in dev, which would
 *  otherwise fire two parallel resolutions per HGVS token; sharing
 *  the in-flight promise across callers keeps it at one network
 *  call. Per-caller `AbortSignal`s still detach cleanly — the
 *  underlying fetch lives until the shared promise settles. */
const inFlight = new Map<string, Promise<VVResolvedVariant>>();

/** Resolve one HGVS / genomic-string variant via VariantValidator.
 *  The `transcriptId` scopes c. / n. forms to the right transcript
 *  (VV otherwise reports against every transcript that matches the
 *  symbol — a 50× slowdown for the embed's use case). */
export async function resolveVariantViaVV(
  raw: string,
  transcriptId: string,
  signal?: AbortSignal,
): Promise<VVResolvedVariant> {
  const trimmed = raw.trim();
  if (!trimmed) throw new VVError(raw, 'empty input');
  const key = `${transcriptId}|${trimmed.toLowerCase()}`;
  let pending = inFlight.get(key);
  if (!pending) {
    pending = doResolve(raw, trimmed, transcriptId).finally(() => {
      // Drop the in-flight entry once the network call has settled
      // so the next resolver call (e.g. after a transcript change)
      // doesn't pick up a stale rejected promise.
      inFlight.delete(key);
    });
    inFlight.set(key, pending);
  }
  if (!signal) return pending;
  return new Promise<VVResolvedVariant>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort);
    pending!.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

async function doResolve(
  raw: string,
  trimmed: string,
  transcriptId: string,
): Promise<VVResolvedVariant> {
  const encoded = encodeURIComponent(trimmed);
  const tx = encodeURIComponent(transcriptId);
  const url = `${VV_BASE}/VariantValidator/variantvalidator/GRCh38/${encoded}/${tx}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new VVError(raw, `VariantValidator HTTP ${res.status}`);
  }
  const json = (await res.json()) as Record<string, VVResponseEntry | string | undefined>;
  // VV's payload is keyed by the resolved HGVS string (e.g.
  // `NM_000546.6:c.524G>A`) so we walk every entry looking for the
  // first one that carries a grch38 vcf block. The `flag` /
  // `metadata` keys at the top level are strings, not entries — skip
  // them.
  for (const value of Object.values(json)) {
    if (!value || typeof value === 'string') continue;
    const vcf = value.primary_assembly_loci?.grch38?.vcf;
    if (!vcf?.chr || !vcf.pos || !vcf.ref || !vcf.alt) continue;
    const pos = Number(vcf.pos);
    if (!Number.isFinite(pos)) continue;
    const chrShort = vcf.chr.replace(/^chr/i, '').toUpperCase();
    const chr = `chr${chrShort}`;
    const ref = vcf.ref.toUpperCase();
    const alt = vcf.alt.toUpperCase();
    return {
      raw,
      id: `${chrShort}-${pos}-${ref}-${alt}`,
      chr,
      pos,
      ref,
      alt,
    };
  }
  throw new VVError(raw, 'no GRCh38 mapping in VariantValidator response');
}

/** Resolve N HGVS tokens in parallel, surfacing per-token outcomes so
 *  the host can render mixed success / failure without coordinating
 *  rejections itself. */
export async function resolveVariantsViaVV(
  raws: readonly string[],
  transcriptId: string,
  signal?: AbortSignal,
): Promise<Array<{ raw: string; result: VVResolvedVariant } | { raw: string; error: string }>> {
  return Promise.all(
    raws.map(async (raw) => {
      try {
        const result = await resolveVariantViaVV(raw, transcriptId, signal);
        return { raw, result };
      } catch (err) {
        const message =
          err instanceof VVError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
        return { raw, error: message };
      }
    }),
  );
}
