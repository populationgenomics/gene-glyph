import { parseClinVarSignificance } from '@populationgenomics/gene-glyph';
import type {
  ClinVarRecord,
  Transcript,
} from '@populationgenomics/gene-glyph';

/**
 * Playground-only helpers that pull transcript structure and ClinVar
 * variants from the gnomAD GraphQL API. Lives in the app (not the
 * package) because the package is data-source-agnostic; the package's
 * `createClinVarDataSource` adapter still talks to NCBI eutils. The
 * gnomAD path is convenient for a browser demo: one CORS-friendly
 * request returns both the gene's CDS exons (canonical transcript)
 * and its full ClinVar variant list.
 */

const GNOMAD_API = 'https://gnomad.broadinstitute.org/api';

interface GnomadExon {
  feature_type: 'CDS' | 'UTR' | 'exon';
  start: number;
  stop: number;
}

interface GnomadTranscript {
  transcript_id: string;
  exons: GnomadExon[];
}

interface GnomadClinVarVariant {
  variant_id: string;
  clinical_significance: string | null;
  major_consequence: string | null;
  pos: number;
  hgvsp: string | null;
  hgvsc: string | null;
  review_status: string | null;
  gold_stars: number | null;
  transcript_id: string | null;
}

interface GnomadGene {
  symbol: string;
  chrom: string;
  strand: '+' | '-';
  canonical_transcript_id: string | null;
  transcripts: GnomadTranscript[];
  clinvar_variants: GnomadClinVarVariant[];
}

export interface LiveGeneData {
  transcript: Transcript;
  clinvar: ClinVarRecord[];
}

export interface LiveTranscriptData {
  transcript: Transcript;
  clinvar: ClinVarRecord[];
  /** Gene symbol from gnomAD (e.g., "TP53"). */
  geneSymbol: string;
  /** Transcript id the URL originally requested. */
  requestedTranscriptId: string;
  /** True when the rendered transcript differs from the requested one
   *  (we redirected to gnomAD's canonical for the parent gene). The
   *  view surfaces a banner + a link that re-loads with `force=1` to
   *  see the requested transcript instead. */
  redirectedToCanonical: boolean;
  /** `'gnomad'` when the primary gnomAD query resolved; `'ensembl'`
   *  when we fell back to Ensembl REST (no ClinVar in that case). */
  source: 'gnomad' | 'ensembl';
}

/** When `true`, `fetchTranscriptData` skips the "redirect non-canonical
 *  to canonical" step and returns the requested transcript verbatim. */
export interface FetchTranscriptOptions {
  force?: boolean;
}

const TRANSCRIPT_QUERY = /* GraphQL */ `
  query Transcript($transcriptId: String!) {
    transcript(transcript_id: $transcriptId, reference_genome: GRCh38) {
      transcript_id
      chrom
      strand
      gene_id
      gene {
        symbol
        canonical_transcript_id
      }
      exons {
        feature_type
        start
        stop
      }
      clinvar_variants {
        variant_id
        clinical_significance
        major_consequence
        pos
        hgvsp
        hgvsc
        review_status
        gold_stars
        transcript_id
      }
    }
  }
`;

const GENE_QUERY = /* GraphQL */ `
  query Gene($geneSymbol: String!) {
    gene(gene_symbol: $geneSymbol, reference_genome: GRCh38) {
      symbol
      strand
      chrom
      canonical_transcript_id
      transcripts {
        transcript_id
        exons {
          feature_type
          start
          stop
        }
      }
      clinvar_variants {
        variant_id
        clinical_significance
        major_consequence
        pos
        hgvsp
        hgvsc
        review_status
        gold_stars
        transcript_id
      }
    }
  }
`;

/** Resolved-data cache so re-selecting a gene doesn't refetch. Keyed on
 *  the upper-cased symbol. Browsers also cache the response, but gnomAD's
 *  Cache-Control headers are short; an in-memory layer keeps repeat picks
 *  instant. */
const dataCache = new Map<string, LiveGeneData>();

/** In-flight fetches deduped per key so a concurrent React StrictMode
 *  double-mount or two scenarios on the same page don't issue parallel
 *  requests. The underlying fetch carries no signal — per-caller signals
 *  are bolted on at the wrapper layer so one caller's abort can't reject
 *  another caller's promise. */
const inFlight = new Map<string, Promise<LiveGeneData>>();

export function fetchGeneData(
  geneSymbol: string,
  signal?: AbortSignal,
): Promise<LiveGeneData> {
  const key = geneSymbol.toUpperCase();
  const cached = dataCache.get(key);
  if (cached) return Promise.resolve(cached);
  let pending = inFlight.get(key);
  if (!pending) {
    pending = doFetch(key).then(
      (data) => {
        dataCache.set(key, data);
        inFlight.delete(key);
        return data;
      },
      (err) => {
        // Don't cache failed lookups — let the user retry.
        inFlight.delete(key);
        throw err;
      },
    );
    inFlight.set(key, pending);
  }
  if (!signal) return pending;
  // Per-caller wrapper: respects the caller's signal independently of
  // the shared pending fetch. If `signal` aborts, only this caller sees
  // AbortError; the shared fetch keeps going so other callers (e.g. the
  // remount that follows StrictMode's first cleanup) still resolve.
  return new Promise<LiveGeneData>((resolve, reject) => {
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
      (data) => {
        signal.removeEventListener('abort', onAbort);
        resolve(data);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

interface GnomadTranscriptResult {
  transcript_id: string;
  chrom: string;
  strand: '+' | '-';
  gene_id: string;
  gene: {
    symbol: string;
    canonical_transcript_id: string | null;
  };
  exons: GnomadExon[];
  clinvar_variants: GnomadClinVarVariant[];
}

const transcriptCache = new Map<string, LiveTranscriptData>();
const transcriptInFlight = new Map<string, Promise<LiveTranscriptData>>();

/** Fetch one transcript's structure + ClinVar by Ensembl transcript id.
 *  Tries gnomAD first (one round-trip, returns ClinVar too); falls back
 *  to Ensembl REST for the structure when gnomAD doesn't recognise the
 *  id (ClinVar is empty in that case).
 *
 *  When the requested transcript isn't its parent gene's canonical, the
 *  resolver re-fetches the canonical and returns *that* data with
 *  `redirectedToCanonical: true`; pass `{ force: true }` to override
 *  the redirect and see the requested transcript verbatim. */
export function fetchTranscriptData(
  transcriptId: string,
  signal?: AbortSignal,
  options: FetchTranscriptOptions = {},
): Promise<LiveTranscriptData> {
  const force = options.force ?? false;
  const key = `${transcriptId.toUpperCase()}|force=${force}`;
  const cached = transcriptCache.get(key);
  if (cached) return Promise.resolve(cached);
  let pending = transcriptInFlight.get(key);
  if (!pending) {
    pending = doFetchTranscript(transcriptId.toUpperCase(), force).then(
      (data) => {
        transcriptCache.set(key, data);
        transcriptInFlight.delete(key);
        return data;
      },
      (err) => {
        transcriptInFlight.delete(key);
        throw err;
      },
    );
    transcriptInFlight.set(key, pending);
  }
  return wrapWithSignal(pending, signal);
}

function wrapWithSignal<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort);
    p.then(
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

async function doFetchTranscript(
  requestedId: string,
  force: boolean,
): Promise<LiveTranscriptData> {
  // gnomAD primary: one request returns structure + ClinVar + the
  // parent gene's canonical id. If the requested id isn't the canonical
  // and the caller hasn't forced, re-fetch using the canonical and
  // return that — the UI surfaces a banner explaining the redirect and
  // a link that re-loads with `force=1` to override.
  const tx = await tryGnomadTranscript(requestedId);
  if (tx) {
    const canonical = tx.gene.canonical_transcript_id;
    if (!force && canonical && canonical !== requestedId) {
      const canonicalTx = await tryGnomadTranscript(canonical);
      const resolved = canonicalTx ?? tx;
      return {
        transcript: gnomadTranscriptToTranscript(resolved),
        clinvar: gnomadClinVarToRecords(resolved.clinvar_variants, resolved.chrom),
        geneSymbol: resolved.gene.symbol,
        requestedTranscriptId: requestedId,
        redirectedToCanonical: canonicalTx !== null,
        source: 'gnomad',
      };
    }
    return {
      transcript: gnomadTranscriptToTranscript(tx),
      clinvar: gnomadClinVarToRecords(tx.clinvar_variants, tx.chrom),
      geneSymbol: tx.gene.symbol,
      requestedTranscriptId: requestedId,
      redirectedToCanonical: false,
      source: 'gnomad',
    };
  }
  // Fallback: Ensembl REST returns the transcript structure for any
  // valid ENST id, including transcripts gnomAD hasn't surfaced (alt-
  // assembly contigs, very recent annotation updates, etc.). ClinVar
  // is left empty — the host can layer it on later if needed.
  const ensembl = await fetchEnsemblTranscript(requestedId);
  return { ...ensembl, requestedTranscriptId: requestedId };
}

async function tryGnomadTranscript(
  transcriptId: string,
): Promise<GnomadTranscriptResult | null> {
  const res = await fetch(GNOMAD_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: TRANSCRIPT_QUERY,
      variables: { transcriptId },
    }),
  });
  if (!res.ok) {
    // Server errors aren't a "missing transcript" signal — surface
    // them so the user sees the problem rather than silently falling
    // through to Ensembl.
    throw new Error(`gnomAD: HTTP ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as {
    data?: { transcript: GnomadTranscriptResult | null };
    errors?: Array<{ message: string }>;
  };
  // gnomAD returns `data: { transcript: null }` + a `not found` error
  // for unknown ids. Treat that as "fall back to Ensembl" rather than
  // throwing.
  if (!json.data?.transcript) return null;
  return json.data.transcript;
}

const ENSEMBL_REST = 'https://rest.ensembl.org';

interface EnsemblExon {
  start: number;
  end: number;
  rank: number;
}

interface EnsemblTranscriptResponse {
  id: string;
  display_name?: string;
  seq_region_name: string;
  strand: 1 | -1;
  Translation?: {
    start: number;
    end: number;
  };
  Exon: EnsemblExon[];
  Parent: string;
}

async function fetchEnsemblTranscript(
  transcriptId: string,
): Promise<Omit<LiveTranscriptData, 'requestedTranscriptId'>> {
  const url = `${ENSEMBL_REST}/lookup/id/${encodeURIComponent(transcriptId)}?expand=1`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(
      `Ensembl: HTTP ${res.status} ${res.statusText} for ${transcriptId}`,
    );
  }
  const json = (await res.json()) as EnsemblTranscriptResponse;
  if (!json?.Translation) {
    throw new Error(
      `Ensembl: ${transcriptId} has no Translation (non-coding transcript?)`,
    );
  }
  const transcript = ensemblToTranscript(json);
  const geneSymbol = json.display_name?.split('-')[0] ?? json.Parent;
  return {
    transcript,
    clinvar: [],
    geneSymbol,
    redirectedToCanonical: false,
    source: 'ensembl',
  };
}

/** Ensembl returns Exon coordinates in genomic space and the CDS
 *  bounds (Translation.start / end) likewise in genomic space (1-based,
 *  forward-strand). Walk the exons in transcription order, clip each
 *  to the CDS interval, and assign cumulative cdsStart / cdsEnd in
 *  CDS coordinates the way `gnomadTranscriptToTranscript` does. */
function ensemblToTranscript(tx: EnsemblTranscriptResponse): Transcript {
  const strand: '+' | '-' = tx.strand === -1 ? '-' : '+';
  const cdsLo = Math.min(tx.Translation!.start, tx.Translation!.end);
  const cdsHi = Math.max(tx.Translation!.start, tx.Translation!.end);
  const inOrder = tx.Exon.slice().sort((a, b) => a.start - b.start);
  if (strand === '-') inOrder.reverse();

  let cdsStart = 1;
  const exons = [];
  for (const e of inOrder) {
    const start = Math.max(e.start, cdsLo);
    const stop = Math.min(e.end, cdsHi);
    if (start > stop) continue; // exon lies wholly in UTR
    const lengthBp = stop - start + 1;
    const cdsEnd = cdsStart + lengthBp - 1;
    exons.push({
      number: exons.length + 1,
      cdsStart,
      cdsEnd,
      genomicStart: start,
      genomicEnd: stop,
      chr: prefixChrom(tx.seq_region_name),
    });
    cdsStart = cdsEnd + 1;
  }
  return {
    geneSymbol: tx.display_name?.split('-')[0] ?? tx.Parent,
    transcriptId: tx.id,
    cdsLength: exons.length === 0 ? 0 : exons[exons.length - 1]!.cdsEnd,
    strand,
    exons,
  };
}

function gnomadTranscriptToTranscript(tx: GnomadTranscriptResult): Transcript {
  const cdsExons = tx.exons
    .filter((e) => e.feature_type === 'CDS')
    .slice()
    .sort((a, b) => a.start - b.start);
  if (tx.strand === '-') cdsExons.reverse();

  let cdsStart = 1;
  const exons = cdsExons.map((e, i) => {
    const lengthBp = e.stop - e.start + 1;
    const cdsEnd = cdsStart + lengthBp - 1;
    const row = {
      number: i + 1,
      cdsStart,
      cdsEnd,
      genomicStart: e.start,
      genomicEnd: e.stop,
      chr: prefixChrom(tx.chrom),
    };
    cdsStart = cdsEnd + 1;
    return row;
  });
  const cdsLength = exons.length === 0 ? 0 : exons[exons.length - 1]!.cdsEnd;
  return {
    geneSymbol: tx.gene.symbol,
    transcriptId: tx.transcript_id,
    cdsLength,
    strand: tx.strand,
    exons,
  };
}

function gnomadClinVarToRecords(
  variants: GnomadClinVarVariant[],
  chrom: string,
): ClinVarRecord[] {
  const chr = prefixChrom(chrom);
  return variants.map((v) => ({
    id: v.variant_id,
    label: v.hgvsc ?? v.hgvsp ?? v.variant_id,
    chr,
    pos: v.pos,
    significance: parseClinVarSignificance(v.clinical_significance ?? ''),
    reviewStatus: v.review_status ?? undefined,
    meta: {
      majorConsequence: v.major_consequence ?? undefined,
      goldStars: v.gold_stars ?? undefined,
      hgvsp: v.hgvsp ?? undefined,
      transcriptId: v.transcript_id ?? undefined,
    },
  }));
}

async function doFetch(geneSymbol: string): Promise<LiveGeneData> {
  const res = await fetch(GNOMAD_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: GENE_QUERY, variables: { geneSymbol } }),
  });
  if (!res.ok) {
    throw new Error(`gnomAD: HTTP ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as {
    data?: { gene: GnomadGene | null };
    errors?: Array<{ message: string }>;
  };
  if (json.errors?.length) {
    throw new Error(`gnomAD: ${json.errors.map((e) => e.message).join('; ')}`);
  }
  const gene = json.data?.gene;
  if (!gene) throw new Error(`gnomAD: no gene returned for ${geneSymbol}`);
  return {
    transcript: toTranscript(gene),
    clinvar: toClinVarRecords(gene),
  };
}

function toTranscript(gene: GnomadGene): Transcript {
  const txId = gene.canonical_transcript_id;
  const tx =
    (txId ? gene.transcripts.find((t) => t.transcript_id === txId) : null) ??
    gene.transcripts[0];
  if (!tx) {
    throw new Error(`gnomAD: no transcript for ${gene.symbol}`);
  }
  // CDS exons only — UTR / non-CDS exons aren't part of the protein-coding
  // ribbon the viewer renders. gnomAD returns them sorted by genomic start
  // ascending; for `-` strand genes the CDS-ordered (5'→3') sequence walks
  // from highest to lowest genomic position, so reverse before the
  // cumulative-cdsStart walk.
  const cdsExons = tx.exons
    .filter((e) => e.feature_type === 'CDS')
    .slice()
    .sort((a, b) => a.start - b.start);
  if (gene.strand === '-') cdsExons.reverse();

  let cdsStart = 1;
  const exons = cdsExons.map((e, i) => {
    const lengthBp = e.stop - e.start + 1;
    const cdsEnd = cdsStart + lengthBp - 1;
    const row = {
      number: i + 1,
      cdsStart,
      cdsEnd,
      genomicStart: e.start,
      genomicEnd: e.stop,
      chr: prefixChrom(gene.chrom),
    };
    cdsStart = cdsEnd + 1;
    return row;
  });
  const cdsLength = exons.length === 0 ? 0 : exons[exons.length - 1]!.cdsEnd;
  return {
    geneSymbol: gene.symbol,
    transcriptId: tx.transcript_id,
    cdsLength,
    strand: gene.strand,
    exons,
  };
}

function prefixChrom(chr: string): string {
  // gnomAD returns "17" — the gene-glyph fixtures use "chr17". Normalise
  // so the figure's data-vv-chr attributes look consistent.
  return chr.startsWith('chr') ? chr : `chr${chr}`;
}

function toClinVarRecords(gene: GnomadGene): ClinVarRecord[] {
  const chr = prefixChrom(gene.chrom);
  const records: ClinVarRecord[] = [];
  for (const v of gene.clinvar_variants) {
    const significance = parseClinVarSignificance(v.clinical_significance ?? '');
    const label = v.hgvsc ?? v.hgvsp ?? v.variant_id;
    records.push({
      id: v.variant_id,
      label,
      chr,
      pos: v.pos,
      significance,
      reviewStatus: v.review_status ?? undefined,
      meta: {
        majorConsequence: v.major_consequence ?? undefined,
        goldStars: v.gold_stars ?? undefined,
        hgvsp: v.hgvsp ?? undefined,
        transcriptId: v.transcript_id ?? undefined,
      },
    });
  }
  return records;
}
