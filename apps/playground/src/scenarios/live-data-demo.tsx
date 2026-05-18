import { useEffect, useMemo, useState } from 'react';
import {
  GeneGlyph,
  clinVarTrack,
  defaultClinVarSymbolEncoding,
  exonTrack,
} from '@populationgenomics/gene-glyph';
import type {
  ClinVarRecord,
  TooltipRenderArgs,
  Transcript,
} from '@populationgenomics/gene-glyph';
import { fetchGeneData, type LiveGeneData } from '../lib/gnomad.js';

/**
 * Live-data scenario — pulls a real transcript + the full ClinVar
 * variant list for the selected gene from gnomAD's GraphQL API and
 * renders them through the same `<GeneGlyph>` + tracks the offline
 * fixtures use.
 *
 * gnomAD's `gene(gene_symbol: …)` query returns:
 *   - The canonical transcript with CDS exons (genomic coords).
 *   - Every ClinVar variant overlapping the gene, with clinical
 *     significance, HGVS notation, review status, and gold-star tier.
 *
 * The playground-local converter in `lib/gnomad.ts` reshapes that into
 * gene-glyph's `Transcript` + `ClinVarRecord[]`. No backend, no auth,
 * one HTTP request per gene change. The in-memory cache keyed on the
 * upper-cased symbol keeps repeat picks instant during a session.
 *
 * Default `cds-spliced` view trades the intron decorations for a
 * tighter coding-sequence ribbon — easier to scan a few thousand
 * ClinVar markers at fit-gene without the intron gaps eating screen
 * width.
 */

const GENES = [
  'TP53',
  'BRCA1',
  'BRCA2',
  'KRAS',
  'EGFR',
  'PTEN',
  'MLH1',
  'CFTR',
  'LDLR',
] as const;
type GeneSymbol = (typeof GENES)[number];

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; data: LiveGeneData }
  | { kind: 'error'; message: string };

export function LiveDataDemoScenario() {
  const [gene, setGene] = useState<GeneSymbol>('TP53');
  const [state, setState] = useState<LoadState>({ kind: 'idle' });
  const [lastClicked, setLastClicked] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    setLastClicked(null);
    fetchGeneData(gene, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setState({ kind: 'ready', data });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        // StrictMode mounts effects twice; the first cleanup aborts the
        // first call's signal even though the underlying fetch in
        // `fetchGeneData` keeps going for the second call. Filter the
        // resulting DOMException so it doesn't surface as a user-visible
        // error.
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const message = err instanceof Error ? err.message : String(err);
        setState({ kind: 'error', message });
      });
    return () => controller.abort();
  }, [gene]);

  const tracks = useMemo(
    () => [
      exonTrack({}),
      clinVarTrack({
        id: 'clinvar',
        source: state.kind === 'ready' ? state.data.clinvar : [],
        // Stacked render — each variant becomes a glyph packed into
        // significance-keyed lanes. With genes carrying thousands of
        // ClinVar entries (TP53 ~3.7k, BRCA1 ~12k) the density-clustered
        // default at fit-gene collapses everything into one giant cluster
        // mark; the stacked view shows every variant individually.
        stackedVariantStyle: defaultClinVarSymbolEncoding,
      }),
    ],
    [state],
  );

  const renderTooltip = (args: TooltipRenderArgs) => {
    if (args.trackId !== 'clinvar') return null;
    const r = args.feature as ClinVarRecord | null;
    if (!r) return null;
    const meta = (r.meta ?? {}) as {
      majorConsequence?: string;
      goldStars?: number;
      hgvsp?: string;
    };
    return (
      <div>
        <div style={{ fontWeight: 600 }}>{r.label}</div>
        {meta.hgvsp && (
          <div style={{ opacity: 0.85, fontSize: '0.72rem' }}>{meta.hgvsp}</div>
        )}
        <div style={{ opacity: 0.75, fontSize: '0.72rem' }}>
          {humanSig(r.significance)}
          {typeof meta.goldStars === 'number' ? ` · ${'★'.repeat(meta.goldStars)}${'☆'.repeat(4 - meta.goldStars)}` : ''}
        </div>
        {meta.majorConsequence && (
          <div style={{ opacity: 0.6, fontSize: '0.7rem' }}>
            {meta.majorConsequence}
          </div>
        )}
        {r.reviewStatus && (
          <div style={{ opacity: 0.6, fontSize: '0.7rem' }}>{r.reviewStatus}</div>
        )}
      </div>
    );
  };

  // Stable placeholder transcript so the `<GeneGlyph>` mounts before the
  // first fetch lands. A single 1-bp exon avoids divide-by-zero in the
  // viewport's baseline geometry while showing roughly nothing — once
  // the real transcript arrives the figure re-renders against it.
  const placeholder: Transcript = useMemo(
    () => ({
      geneSymbol: gene,
      transcriptId: '—',
      cdsLength: 1,
      strand: '+',
      exons: [
        {
          number: 1,
          cdsStart: 1,
          cdsEnd: 1,
          genomicStart: 1,
          genomicEnd: 1,
          chr: 'chr1',
        },
      ],
    }),
    [gene],
  );
  const transcript =
    state.kind === 'ready' ? state.data.transcript : placeholder;
  const variantCount =
    state.kind === 'ready' ? state.data.clinvar.length : null;

  return (
    <section className="scenario" aria-labelledby="scenario-live-data">
      <h2 id="scenario-live-data">Live data — real ClinVar via gnomAD</h2>
      <p className="scenario-blurb">
        Pulls the canonical transcript and every ClinVar variant for the
        selected gene from the{' '}
        <a
          href="https://gnomad.broadinstitute.org/api"
          target="_blank"
          rel="noopener noreferrer"
        >
          gnomAD GraphQL API
        </a>{' '}
        and renders through the same exon + ClinVar tracks the offline
        fixtures use. Switch genes from the picker; results cache in
        memory so repeat picks are instant. Click a cluster diamond to
        expand the popover; zoom in (<code>=</code>) to break clusters
        apart.
      </p>
      <div
        style={{
          display: 'flex',
          gap: 16,
          flexWrap: 'wrap',
          alignItems: 'center',
          marginBottom: 8,
          fontSize: '0.85rem',
          color: '#475569',
        }}
      >
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          Gene{' '}
          <select
            data-testid="live-data-gene-picker"
            value={gene}
            onChange={(e) => setGene(e.target.value as GeneSymbol)}
            style={{ font: 'inherit', padding: '2px 6px' }}
          >
            {GENES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>
        <span data-testid="live-data-status" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {state.kind === 'loading' && 'loading…'}
          {state.kind === 'error' && (
            <span style={{ color: '#b91c1c' }}>error: {state.message}</span>
          )}
          {state.kind === 'ready' && (
            <>
              transcript <strong>{state.data.transcript.transcriptId}</strong>
              {' · '}
              <strong>{variantCount}</strong> ClinVar variants
            </>
          )}
        </span>
        {lastClicked && (
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            last clicked: <strong>{lastClicked}</strong>
          </span>
        )}
      </div>
      <GeneGlyph
        transcript={transcript}
        tracks={tracks}
        defaultMode="cds-spliced"
        trackHeightBudget={420}
        renderTooltip={renderTooltip}
        onFeatureClick={(featureId, trackId) => {
          if (trackId === 'clinvar') setLastClicked(featureId);
        }}
      />
    </section>
  );
}

function humanSig(s: ClinVarRecord['significance']): string {
  switch (s) {
    case 'pathogenic':
      return 'Pathogenic';
    case 'likely_pathogenic':
      return 'Likely pathogenic';
    case 'uncertain_significance':
      return 'VUS';
    case 'likely_benign':
      return 'Likely benign';
    case 'benign':
      return 'Benign';
    case 'conflicting':
      return 'Conflicting';
    case 'other':
      return 'Other';
  }
}
