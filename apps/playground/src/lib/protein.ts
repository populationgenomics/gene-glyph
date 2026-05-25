import type {
  ProteinAnnotations,
  ProteinDomain,
  ProteinDomainEntryType,
} from '@populationgenomics/gene-glyph';

const ENSEMBL_REST = 'https://rest.ensembl.org';

interface EnsemblTranslation {
  id: string;
  length: number;
}

interface EnsemblLookupResponse {
  Translation?: EnsemblTranslation;
}

interface EnsemblProteinFeature {
  type: string;
  id: string;
  /** InterPro accession (e.g., "IPR029021") if the member-DB hit maps to
   *  one, empty string otherwise. The same InterPro accession will show up
   *  multiple times across different member-DB hits (Pfam + SMART + PANTHER
   *  all classifying the same region as IPRxxxxx). */
  interpro: string;
  description?: string;
  start: number;
  end: number;
}

/** Fetch InterPro / Pfam / member-DB domain annotations for a transcript.
 *  Two Ensembl REST calls — one to resolve the Translation id and length,
 *  one to pull the protein features. Returns `null` on any failure so the
 *  caller can render the figure without the domain track rather than
 *  bubble the error up. */
export async function fetchProteinAnnotations(
  transcriptId: string,
  signal: AbortSignal,
): Promise<ProteinAnnotations | null> {
  try {
    const lookup = await fetchJson<EnsemblLookupResponse>(
      `${ENSEMBL_REST}/lookup/id/${encodeURIComponent(transcriptId)}?expand=1`,
      signal,
    );
    const translation = lookup.Translation;
    if (!translation) return null;

    const features = await fetchJson<EnsemblProteinFeature[]>(
      `${ENSEMBL_REST}/overlap/translation/${encodeURIComponent(translation.id)}?feature_type=protein_feature`,
      signal,
    );

    // The track's default filter keeps domains where `source === 'InterPro'`.
    // Ensembl's protein_feature endpoint returns member-DB hits (Pfam, SMART,
    // SuperFamily, Gene3D, PANTHER, etc.) along with an `interpro` field
    // identifying the InterPro entry each one classifies to. Multiple member-DB
    // hits to the same InterPro accession represent the same biological region
    // viewed through different signatures — group by IPR id, take the widest
    // span (union of all evidence), and use the per-IPR set of contributing
    // member-DBs to infer the InterPro entry's classification (family / domain
    // / repeat / HSF). Ensembl doesn't return InterPro's actual classification,
    // so this is a heuristic; the alternative is an EBI InterPro REST round-trip
    // per IPR accession.
    const byInterPro = new Map<
      string,
      {
        aaStart: number;
        aaEnd: number;
        description: string;
        sources: Set<string>;
      }
    >();
    for (const f of features) {
      if (!f.interpro) continue;
      if (!Number.isFinite(f.start) || !Number.isFinite(f.end)) continue;
      if (f.end < f.start) continue;
      const existing = byInterPro.get(f.interpro);
      if (existing) {
        existing.aaStart = Math.min(existing.aaStart, f.start);
        existing.aaEnd = Math.max(existing.aaEnd, f.end);
        if (!existing.description && f.description) existing.description = f.description;
        existing.sources.add(f.type);
      } else {
        byInterPro.set(f.interpro, {
          aaStart: f.start,
          aaEnd: f.end,
          description: f.description ?? f.interpro,
          sources: new Set([f.type]),
        });
      }
    }
    const domains: ProteinDomain[] = Array.from(byInterPro.entries()).map(
      ([ipr, span]) => ({
        aaStart: span.aaStart,
        aaEnd: span.aaEnd,
        source: 'InterPro',
        sourceId: ipr,
        // Use the human-readable description as the visible label rather
        // than the IPR accession.
        shortName: span.description || ipr,
        description: span.description,
        entryType: classifyEntryType(span.sources, span.description),
      }),
    );

    return {
      uniprotAcc: '',
      length: translation.length,
      domains,
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    return null;
  }
}

/** Infer an InterPro entry-type from the set of member-DB signatures that
 *  classified to it. InterPro's actual `type` (family/domain/repeat/
 *  homologous_superfamily/etc.) isn't returned by Ensembl, but the member-DB
 *  mix is a useful proxy:
 *    - Pfam / SMART / CDD / Prosite_profiles → domain-shaped sequence units
 *    - PANTHER / PIRSF / TIGRfam / HAMAP → whole-protein family classifiers
 *    - Gene3D / SuperFamily → structural superfamilies (SCOP / CATH derived)
 *    - Prosite_patterns → short conserved/active/binding sites
 *  When multiple categories contribute, prefer the more specific one
 *  (domain > family > HSF) — a region with both Pfam and SuperFamily hits
 *  is almost always classified as a domain by InterPro.
 */
function classifyEntryType(
  sources: Set<string>,
  description: string,
): ProteinDomainEntryType {
  const has = (...names: string[]) =>
    names.some((n) => sources.has(n));
  if (has('Pfam', 'Smart', 'SMART', 'CDD', 'Prosite_profiles')) return 'domain';
  if (has('PANTHER', 'PIRSF', 'TIGRfam', 'HAMAP')) return 'family';
  if (has('Gene3D', 'SuperFamily', 'Superfamily')) return 'homologous_superfamily';
  if (has('Prosite_patterns')) {
    const d = description.toLowerCase();
    if (d.includes('active site')) return 'active_site';
    if (d.includes('binding')) return 'binding_site';
    return 'conserved_site';
  }
  return 'domain';
}

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${url}`);
  }
  return res.json() as Promise<T>;
}
