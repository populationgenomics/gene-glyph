import { createCachedDataSource } from '../data-source.js';
import {
  parseClinVarSignificance,
  type ClinVarRecord,
} from '../tracks/clinvar-track.js';
import type { DataSource, Transcript, ViewportQuery } from '../types.js';

const DEFAULT_BASE_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const DEFAULT_PAGE_SIZE = 200;

export interface CreateClinVarDataSourceOptions {
  /** Transcript used to constrain the search. The adapter fetches by gene
   *  symbol and filters to the transcript's chromosome on the host side. */
  transcript: Transcript;
  /** Override the NCBI eutils base URL — useful for testing against a stub
   *  and for hosts that route through a proxy. */
  baseUrl?: string;
  /** Records per esummary batch. Defaults to 200; NCBI caps at 500. */
  pageSize?: number;
  /** Injectable fetch — defaults to the global `fetch`. Tests swap in a fake
   *  to drive paginated responses deterministically. */
  fetchImpl?: typeof fetch;
  /** Soft cap on the in-memory cache. Forwarded to
   *  {@link createCachedDataSource}; ClinVar queries vary by transcript so 16
   *  entries comfortably covers a paper-report workspace. */
  maxEntries?: number;
}

/** Build a `DataSource<ViewportQuery, ClinVarRecord[]>` backed by NCBI eutils.
 *  The adapter caches by `transcriptId` because ClinVar data is gene-scoped —
 *  the viewport's mode and range don't change what's available, so a pan or
 *  zoom never re-fetches. The query path:
 *
 *    1. `esearch` for `{geneSymbol}[gene]`, paging through all hits.
 *    2. `esummary` in {@link pageSize}-sized batches, parsing the JSON into
 *       {@link ClinVarRecord}.
 *    3. Filter to records on the transcript's chromosome — `MT` / contig
 *       mismatches are silently dropped (rare but they do exist).
 *
 *  Network failure throws; the caching wrapper evicts the failed key so the
 *  next caller retries. */
export function createClinVarDataSource(
  opts: CreateClinVarDataSourceOptions,
): DataSource<ViewportQuery, ClinVarRecord[]> {
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const transcript = opts.transcript;
  const chr = transcript.exons[0]?.chr ?? '';

  return createCachedDataSource<ViewportQuery, ClinVarRecord[]>({
    id: `clinvar:${transcript.transcriptId}`,
    maxEntries: opts.maxEntries ?? 16,
    cacheKey: () => transcript.transcriptId,
    async query(_q, signal): Promise<ClinVarRecord[]> {
      const ids = await fetchAllIds({
        baseUrl,
        geneSymbol: transcript.geneSymbol,
        pageSize,
        fetchImpl,
        signal,
      });
      if (ids.length === 0) return [];
      const records: ClinVarRecord[] = [];
      for (let i = 0; i < ids.length; i += pageSize) {
        const batch = ids.slice(i, i + pageSize);
        const summary = await fetchSummaryBatch({
          baseUrl,
          ids: batch,
          fetchImpl,
          signal,
        });
        for (const record of summary) {
          if (chr && record.chr !== chr) continue;
          records.push(record);
        }
      }
      return records;
    },
  });
}

interface FetchIdsArgs {
  baseUrl: string;
  geneSymbol: string;
  pageSize: number;
  fetchImpl: typeof fetch;
  signal: AbortSignal;
}

async function fetchAllIds(args: FetchIdsArgs): Promise<string[]> {
  const { baseUrl, geneSymbol, pageSize, fetchImpl, signal } = args;
  const all: string[] = [];
  let retstart = 0;
  let total = Infinity;
  while (retstart < total) {
    const url =
      `${baseUrl}/esearch.fcgi?db=clinvar&retmode=json` +
      `&term=${encodeURIComponent(`${geneSymbol}[gene]`)}` +
      `&retmax=${pageSize}&retstart=${retstart}`;
    const res = await fetchImpl(url, { signal });
    if (!res.ok) {
      throw new Error(
        `ClinVar esearch failed for ${geneSymbol} (HTTP ${res.status})`,
      );
    }
    const body = (await res.json()) as EsearchResponse;
    const result = body.esearchresult;
    if (!result) {
      throw new Error('ClinVar esearch returned no `esearchresult` body');
    }
    const totalRaw = Number.parseInt(result.count ?? '0', 10);
    total = Number.isFinite(totalRaw) ? totalRaw : 0;
    const ids = result.idlist ?? [];
    for (const id of ids) all.push(id);
    if (ids.length === 0) break;
    retstart += ids.length;
  }
  return all;
}

interface FetchSummaryArgs {
  baseUrl: string;
  ids: string[];
  fetchImpl: typeof fetch;
  signal: AbortSignal;
}

async function fetchSummaryBatch(args: FetchSummaryArgs): Promise<ClinVarRecord[]> {
  const { baseUrl, ids, fetchImpl, signal } = args;
  if (ids.length === 0) return [];
  const url =
    `${baseUrl}/esummary.fcgi?db=clinvar&retmode=json&id=${ids.join(',')}`;
  const res = await fetchImpl(url, { signal });
  if (!res.ok) {
    throw new Error(`ClinVar esummary failed (HTTP ${res.status})`);
  }
  const body = (await res.json()) as EsummaryResponse;
  const result = body.result;
  if (!result) return [];
  const records: ClinVarRecord[] = [];
  for (const id of result.uids ?? []) {
    const summary = result[id];
    if (!summary || typeof summary !== 'object') continue;
    const rec = summaryToRecord(id, summary as ClinVarSummary);
    if (rec) records.push(rec);
  }
  return records;
}

interface EsearchResponse {
  esearchresult?: {
    count?: string;
    idlist?: string[];
  };
}

interface EsummaryResponse {
  result?: {
    uids?: string[];
    [id: string]: unknown;
  };
}

interface ClinVarSummary {
  accession?: string;
  title?: string;
  germline_classification?: { description?: string };
  clinical_significance?: { description?: string };
  trait_set?: Array<{ trait_name?: string }>;
  variation_set?: Array<{
    cdna_change?: string;
    variation_loc?: Array<{
      assembly_name?: string;
      chr?: string;
      start?: string;
      stop?: string;
    }>;
  }>;
}

function summaryToRecord(uid: string, summary: ClinVarSummary): ClinVarRecord | null {
  const variation = summary.variation_set?.[0];
  if (!variation) return null;
  // Prefer GRCh38 when both assemblies are present.
  const loc =
    variation.variation_loc?.find((l) => (l.assembly_name ?? '').toUpperCase().includes('GRCH38')) ??
    variation.variation_loc?.[0];
  if (!loc) return null;
  const pos = Number.parseInt(loc.start ?? '', 10);
  if (!Number.isFinite(pos)) return null;
  const chrRaw = loc.chr ?? '';
  const chr = chrRaw.startsWith('chr') ? chrRaw : `chr${chrRaw}`;
  const significanceRaw =
    summary.germline_classification?.description ??
    summary.clinical_significance?.description ??
    '';
  return {
    id: summary.accession ?? `clinvar:${uid}`,
    label: variation.cdna_change || summary.title || uid,
    chr,
    pos,
    significance: parseClinVarSignificance(significanceRaw),
    reviewStatus: significanceRaw || undefined,
    condition: summary.trait_set?.[0]?.trait_name,
  };
}
