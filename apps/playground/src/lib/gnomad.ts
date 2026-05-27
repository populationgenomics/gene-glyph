import {
  parseAaStart,
  parseClinVarSignificance,
  rmcCategoryFor,
} from '@populationgenomics/gene-glyph';
import type {
  ClinVarRecord,
  RmcCategory,
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

/** Raw region row returned by gnomAD's
 *  `gnomad_v2_regional_missense_constraint`. `aa_start` / `aa_stop` are
 *  string-encoded three-letter codon labels (e.g. `"Lys2009"`); the rest
 *  are numeric. */
export interface GnomadRmcRegion {
  aa_start: string;
  aa_stop: string;
  obs_exp: number;
  p_value: number;
}

interface GnomadRegionalMissenseConstraint {
  passed_qc: boolean | null;
  has_no_rmc_evidence: boolean | null;
  regions: GnomadRmcRegion[] | null;
}

interface GnomadGene {
  symbol: string;
  chrom: string;
  strand: '+' | '-';
  canonical_transcript_id: string | null;
  transcripts: GnomadTranscript[];
  clinvar_variants: GnomadClinVarVariant[];
  gnomad_v2_regional_missense_constraint: GnomadRegionalMissenseConstraint | null;
}

export interface RmcRegion {
  start: number;
  end: number;
  category: RmcCategory;
}

/** Status of gnomAD's v2 Regional Missense Constraint analysis for a gene.
 *  The three states are visually distinct in the UI — collapsing them
 *  all to "empty array" makes a successful "no significant constraint"
 *  result look identical to a broken fetch.
 *  - `has_regions`: gene passed QC and has at least one constrained sub-region.
 *  - `no_evidence`: gene was analysed but no significant sub-regions detected.
 *  - `not_analysed`: gene is absent from the v2 RMC dataset entirely. */
export type RmcResult =
  | { status: 'has_regions'; regions: RmcRegion[] }
  | { status: 'no_evidence' }
  | { status: 'not_analysed' };

export interface LiveGeneData {
  transcript: Transcript;
  clinvar: ClinVarRecord[];
  /** Regional Missense Constraint regions in protein coords. Empty when
   *  the gene has no RMC data on gnomAD v2 (common — most genes). */
  rmc: RmcRegion[];
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
      gnomad_v2_regional_missense_constraint {
        regions {
          aa_start
          aa_stop
          obs_exp
          p_value
        }
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

  // Sum 5'UTR and 3'UTR bp across *all* exons (UTR-only exons included)
  // so the totals reflect real biological lengths even when an entire
  // exon lies outside the CDS. The totals are assigned to the first and
  // last CDS-containing exons below — UTR-only exons are still skipped
  // from the rendered exon list (a known interim simplification).
  let total5UtrBp = 0;
  let total3UtrBp = 0;
  for (const e of inOrder) {
    const leftEnd = Math.min(e.end, cdsLo - 1);
    const leftLen = leftEnd >= e.start ? leftEnd - e.start + 1 : 0;
    const rightStart = Math.max(e.start, cdsHi + 1);
    const rightLen = rightStart <= e.end ? e.end - rightStart + 1 : 0;
    if (strand === '+') {
      total5UtrBp += leftLen;
      total3UtrBp += rightLen;
    } else {
      total5UtrBp += rightLen;
      total3UtrBp += leftLen;
    }
  }

  let cdsStart = 1;
  const exons: Transcript['exons'] = [];
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
  if (exons.length > 0) {
    exons[0]!.utr5Bp = total5UtrBp;
    exons[exons.length - 1]!.utr3Bp = total3UtrBp;
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

  // Sum UTR bp from gnomAD's explicit 'UTR' feature entries, classifying
  // each as 5' or 3' by its position relative to the CDS genomic bounds.
  const { utr5Bp, utr3Bp } = summarizeUtrBp(tx.exons, tx.strand);

  let cdsStart = 1;
  const exons = cdsExons.map((e, i) => {
    const lengthBp = e.stop - e.start + 1;
    const cdsEnd = cdsStart + lengthBp - 1;
    const row: Transcript['exons'][number] = {
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
  if (exons.length > 0) {
    exons[0]!.utr5Bp = utr5Bp;
    exons[exons.length - 1]!.utr3Bp = utr3Bp;
  }
  const cdsLength = exons.length === 0 ? 0 : exons[exons.length - 1]!.cdsEnd;
  return {
    geneSymbol: tx.gene.symbol,
    transcriptId: tx.transcript_id,
    cdsLength,
    strand: tx.strand,
    exons,
  };
}

function summarizeUtrBp(
  rawExons: readonly GnomadExon[],
  strand: '+' | '-',
): { utr5Bp: number; utr3Bp: number } {
  const cdsEntries = rawExons.filter((e) => e.feature_type === 'CDS');
  const utrEntries = rawExons.filter((e) => e.feature_type === 'UTR');
  if (cdsEntries.length === 0 || utrEntries.length === 0) {
    return { utr5Bp: 0, utr3Bp: 0 };
  }
  const cdsGenomicLo = Math.min(...cdsEntries.map((e) => e.start));
  const cdsGenomicHi = Math.max(...cdsEntries.map((e) => e.stop));
  let leftLen = 0; // bp genomically left of CDS lo
  let rightLen = 0; // bp genomically right of CDS hi
  for (const u of utrEntries) {
    const len = u.stop - u.start + 1;
    if (u.stop < cdsGenomicLo) leftLen += len;
    else if (u.start > cdsGenomicHi) rightLen += len;
  }
  return strand === '+'
    ? { utr5Bp: leftLen, utr3Bp: rightLen }
    : { utr5Bp: rightLen, utr3Bp: leftLen };
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
    refLen: refLenFromVariantId(v.variant_id),
    meta: {
      majorConsequence: v.major_consequence ?? undefined,
      goldStars: v.gold_stars ?? undefined,
      hgvsp: v.hgvsp ?? undefined,
      transcriptId: v.transcript_id ?? undefined,
    },
  }));
}

/** gnomAD's variant ids encode the reference and alternate alleles as
 *  `<chr>-<pos>-<ref>-<alt>`. The reference length tells us how many
 *  genomic bp the variant spans on the reference contig, which the
 *  ClinVar track turns into a horizontal line extension on multi-bp
 *  variants. Falls back to 1 (single-bp) when the id doesn't match. */
function refLenFromVariantId(id: string): number {
  const m = /^[^-]+-\d+-([A-Za-z]+)-[A-Za-z]+$/.exec(id);
  return m ? m[1]!.length : 1;
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
    rmc: toRmcRegions(gene.gnomad_v2_regional_missense_constraint?.regions ?? null),
  };
}

/** Fetch the Regional Missense Constraint result for `geneSymbol` from
 *  gnomAD v2. Distinguishes "has regions", "analysed but no significant
 *  regions" (`has_no_rmc_evidence`) and "not in the v2 RMC dataset"
 *  (sub-object null). Caches by upper-cased symbol so re-renders of the
 *  same gene don't refetch. */
const rmcCache = new Map<string, RmcResult>();
const rmcInFlight = new Map<string, Promise<RmcResult>>();

const RMC_QUERY = /* GraphQL */ `
  query Rmc($geneSymbol: String!) {
    gene(gene_symbol: $geneSymbol, reference_genome: GRCh38) {
      gnomad_v2_regional_missense_constraint {
        passed_qc
        has_no_rmc_evidence
        regions {
          aa_start
          aa_stop
          obs_exp
          p_value
        }
      }
    }
  }
`;

export function fetchRmcResult(
  geneSymbol: string,
  signal?: AbortSignal,
): Promise<RmcResult> {
  const key = geneSymbol.toUpperCase();
  const cached = rmcCache.get(key);
  if (cached) return Promise.resolve(cached);
  let pending = rmcInFlight.get(key);
  if (!pending) {
    pending = doFetchRmc(key).then(
      (result) => {
        rmcCache.set(key, result);
        rmcInFlight.delete(key);
        return result;
      },
      (err) => {
        rmcInFlight.delete(key);
        throw err;
      },
    );
    rmcInFlight.set(key, pending);
  }
  return wrapWithSignal(pending, signal);
}

async function doFetchRmc(geneSymbol: string): Promise<RmcResult> {
  const res = await fetch(GNOMAD_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: RMC_QUERY, variables: { geneSymbol } }),
  });
  if (!res.ok) {
    throw new Error(`gnomAD RMC: HTTP ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as {
    data?: {
      gene: {
        gnomad_v2_regional_missense_constraint: GnomadRegionalMissenseConstraint | null;
      } | null;
    };
    errors?: Array<{ message: string }>;
  };
  // gnomAD treats "no such gene" as `data.gene === null` plus a
  // top-level error; treat that as `not_analysed` rather than throwing so
  // the figure renders an empty-state stub instead of an error banner.
  const rmc = json.data?.gene?.gnomad_v2_regional_missense_constraint ?? null;
  return toRmcResult(rmc);
}

function toRmcResult(rmc: GnomadRegionalMissenseConstraint | null): RmcResult {
  if (!rmc) return { status: 'not_analysed' };
  const regions = toRmcRegions(rmc.regions);
  if (regions.length > 0) return { status: 'has_regions', regions };
  // `has_no_rmc_evidence === true` is gnomAD's explicit "we analysed this
  // gene and found no significant constraint regions". If the flag is
  // absent (older schema) but the sub-object exists, we fall back to
  // `no_evidence` rather than `not_analysed` — the gene clearly is in
  // the analysis dataset.
  return { status: 'no_evidence' };
}

function toRmcRegions(raw: GnomadRmcRegion[] | null): RmcRegion[] {
  if (!raw) return [];
  const out: RmcRegion[] = [];
  for (const r of raw) {
    const start = parseAaStart(r.aa_start);
    const end = parseAaStart(r.aa_stop);
    if (start === null || end === null) continue;
    if (end < start) continue;
    out.push({
      start,
      end,
      category: rmcCategoryFor(r.obs_exp, r.p_value),
    });
  }
  out.sort((a, b) => a.start - b.start);
  return out;
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

  const { utr5Bp, utr3Bp } = summarizeUtrBp(tx.exons, gene.strand);

  let cdsStart = 1;
  const exons = cdsExons.map((e, i) => {
    const lengthBp = e.stop - e.start + 1;
    const cdsEnd = cdsStart + lengthBp - 1;
    const row: Transcript['exons'][number] = {
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
  if (exons.length > 0) {
    exons[0]!.utr5Bp = utr5Bp;
    exons[exons.length - 1]!.utr3Bp = utr3Bp;
  }
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
      refLen: refLenFromVariantId(v.variant_id),
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
