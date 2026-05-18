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
