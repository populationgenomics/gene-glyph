import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  DefaultTrackChevron,
  GeneGlyph,
  clinVarSummaryTrack,
  clinVarTrack,
  defaultClinVarSymbolEncoding,
  exonTrack,
} from '@populationgenomics/gene-glyph';
import type {
  ClinVarRecord,
  ClinVarSignificance,
  GeneGlyphRef,
  GutterItem,
  TooltipRenderArgs,
  TrackOrGroup,
  Transcript,
} from '@populationgenomics/gene-glyph';
import { fetchTranscriptData, type LiveTranscriptData } from '../lib/gnomad.js';

/**
 * Single-figure embed view. Reads `?transcript=ENST…` from the URL,
 * fetches structure + ClinVar via the gnomAD GraphQL API (Ensembl REST
 * as fallback when gnomAD doesn't recognise the id), and renders the
 * same nested ClinVar group + significance chips the live-data
 * playground scenario uses — minus the gene picker and the
 * scenario-gallery chrome. Designed to be linked from external
 * reports / dashboards so a single URL pins both the transcript and
 * the figure layout.
 */

const SIGNIFICANCE_CHIPS: readonly ClinVarSignificance[] = [
  'pathogenic',
  'likely_pathogenic',
  'uncertain_significance',
  'likely_benign',
  'benign',
  'conflicting',
];

const CLINVAR_GROUP_ID = 'clinvar-group';

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading'; transcriptId: string }
  | { kind: 'ready'; data: LiveTranscriptData }
  | { kind: 'error'; message: string };

export function EmbedView() {
  const { requestedId, force } = useMemo(() => readUrlParams(), []);
  const [state, setState] = useState<LoadState>(() =>
    requestedId
      ? { kind: 'loading', transcriptId: requestedId }
      : { kind: 'error', message: 'Missing ?transcript=ENST… query parameter.' },
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<ReadonlySet<ClinVarSignificance>>(
    () => new Set(),
  );
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(
    () =>
      new Set([
        CLINVAR_GROUP_ID,
        ...SIGNIFICANCE_CHIPS.map((sig) => `clinvar-${sig}`),
      ]),
  );
  const viewerRef = useRef<GeneGlyphRef | null>(null);

  useEffect(() => {
    if (!requestedId) return;
    const controller = new AbortController();
    setState({ kind: 'loading', transcriptId: requestedId });
    fetchTranscriptData(requestedId, controller.signal, { force })
      .then((data) => {
        if (controller.signal.aborted) return;
        setState({ kind: 'ready', data });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const message = err instanceof Error ? err.message : String(err);
        setState({ kind: 'error', message });
      });
    return () => controller.abort();
  }, [requestedId, force]);

  const filter = useCallback(
    (r: ClinVarRecord) => !excluded.has(r.significance),
    [excluded],
  );
  const records = state.kind === 'ready' ? state.data.clinvar : [];
  // The selection survives chip toggles: when the user excludes the
  // selected variant's significance the detail card and ring just hide
  // until they re-enable that chip.
  const selectedRecord = useMemo(() => {
    if (!selectedId) return null;
    const r = records.find((r) => r.id === selectedId) ?? null;
    return r && !excluded.has(r.significance) ? r : null;
  }, [selectedId, records, excluded]);
  const selectedFeatureIds = useMemo(
    () => (selectedRecord ? new Set([selectedRecord.id]) : new Set<string>()),
    [selectedRecord],
  );
  const toggleExcluded = (sig: ClinVarSignificance) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(sig)) next.delete(sig);
      else next.add(sig);
      return next;
    });
  };

  const tracks = useMemo<TrackOrGroup[]>(() => {
    const subgroup = (sig: ClinVarSignificance): TrackOrGroup => {
      const sigFilter = (r: ClinVarRecord) => r.significance === sig && filter(r);
      return {
        kind: 'group',
        id: `clinvar-${sig}`,
        label: humanSig(sig),
        gapAbove: 6,
        tracks: [
          clinVarTrack({
            id: `clinvar-${sig}-detail`,
            source: records,
            stackedVariantStyle: defaultClinVarSymbolEncoding,
            filter: sigFilter,
          }),
        ],
        summaryTrack: clinVarSummaryTrack({
          id: `clinvar-${sig}-summary`,
          source: records,
          filter: sigFilter,
        }),
      };
    };
    return [
      exonTrack({}),
      {
        kind: 'group',
        id: CLINVAR_GROUP_ID,
        label: 'ClinVar',
        headerHeight: 22,
        tracks: SIGNIFICANCE_CHIPS.map(subgroup),
        summaryTrack: clinVarSummaryTrack({
          id: 'clinvar-summary',
          source: records,
          filter,
        }),
      },
    ];
  }, [records, filter]);

  const renderTooltip = (args: TooltipRenderArgs) => {
    // The nested layout exposes detail tracks as `clinvar-<sig>-detail`
    // and summaries as `clinvar-<sig>-summary` — accept any clinvar-
    // prefixed track so hover surfaces the record for whichever cell
    // the user landed on.
    if (!args.trackId.startsWith('clinvar')) return null;
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
          {typeof meta.goldStars === 'number'
            ? ` · ${'★'.repeat(meta.goldStars)}${'☆'.repeat(4 - meta.goldStars)}`
            : ''}
        </div>
        {meta.majorConsequence && (
          <div style={{ opacity: 0.6, fontSize: '0.7rem' }}>{meta.majorConsequence}</div>
        )}
        {r.reviewStatus && (
          <div style={{ opacity: 0.6, fontSize: '0.7rem' }}>{r.reviewStatus}</div>
        )}
      </div>
    );
  };

  const placeholder: Transcript = useMemo(
    () => ({
      geneSymbol: '—',
      transcriptId: requestedId ?? '—',
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
    [requestedId],
  );
  const transcript = state.kind === 'ready' ? state.data.transcript : placeholder;

  return (
    <main
      style={{
        padding: 12,
        fontFamily: 'system-ui, sans-serif',
        fontSize: '0.85rem',
        color: '#1e293b',
      }}
    >
      <StatusBar state={state} requestedId={requestedId} />
      {state.kind === 'ready' && (
        <div
          data-testid="embed-significance-filter"
          style={{
            display: 'flex',
            gap: 6,
            flexWrap: 'wrap',
            alignItems: 'center',
            margin: '8px 0',
            color: '#475569',
          }}
        >
          <span style={{ opacity: 0.75 }}>significance:</span>
          {SIGNIFICANCE_CHIPS.map((sig) => {
            const active = !excluded.has(sig);
            return (
              <button
                key={sig}
                type="button"
                data-testid={`embed-chip-${sig}`}
                data-active={active}
                onClick={() => toggleExcluded(sig)}
                style={{
                  padding: '2px 8px',
                  fontSize: '0.78rem',
                  borderRadius: 999,
                  border: '1px solid #cbd5e1',
                  background: active ? '#e0f2fe' : '#f1f5f9',
                  color: active ? '#0c4a6e' : '#94a3b8',
                  cursor: 'pointer',
                }}
              >
                {humanSig(sig)}
              </button>
            );
          })}
        </div>
      )}
      <GeneGlyph
        ref={viewerRef}
        transcript={transcript}
        tracks={tracks}
        defaultMode="transcript"
        trackHeightBudget={420}
        collapsedGroupIds={collapsedGroups}
        onCollapsedGroupChange={setCollapsedGroups}
        renderTooltip={renderTooltip}
        selectedFeatureIds={selectedFeatureIds}
        onFeatureClick={(featureId, trackId) => {
          if (!trackId.startsWith('clinvar')) return;
          setSelectedId((prev) => (prev === featureId ? null : featureId));
        }}
      >
        <GeneGlyph.LeftGutter width={180}>
          {(item: GutterItem) => {
            if (item.kind !== 'group') return null;
            return (
              <span
                style={{
                  alignSelf: 'flex-start',
                  paddingTop: 1,
                  paddingLeft: item.depth * 14,
                }}
              >
                <DefaultTrackChevron
                  item={item}
                  collapsed={collapsedGroups.has(item.id)}
                  onToggle={() => viewerRef.current?.toggleGroup(item.id)}
                />
              </span>
            );
          }}
        </GeneGlyph.LeftGutter>
      </GeneGlyph>
      {selectedRecord && (
        <SelectedVariantCard
          record={selectedRecord}
          onClear={() => setSelectedId(null)}
        />
      )}
    </main>
  );
}

function SelectedVariantCard({
  record,
  onClear,
}: {
  record: ClinVarRecord;
  onClear: () => void;
}) {
  const meta = (record.meta ?? {}) as {
    majorConsequence?: string;
    goldStars?: number;
    hgvsp?: string;
  };
  const parsed = parseVariantId(record.id);
  return (
    <section
      data-testid="embed-selected-variant"
      style={{
        marginTop: 10,
        padding: '10px 12px',
        background: '#f8fafc',
        border: '1px solid #cbd5e1',
        borderRadius: 6,
        color: '#1e293b',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 6,
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'baseline' }}>
          <strong style={{ fontSize: '0.95rem' }}>{record.label}</strong>
          <code
            style={{
              fontSize: '0.78rem',
              opacity: 0.7,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {record.id}
          </code>
        </div>
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear selection"
          style={{
            border: '1px solid #cbd5e1',
            background: '#ffffff',
            color: '#475569',
            borderRadius: 4,
            padding: '2px 8px',
            fontSize: '0.75rem',
            cursor: 'pointer',
          }}
        >
          clear
        </button>
      </header>
      <dl
        style={{
          margin: 0,
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          columnGap: 10,
          rowGap: 2,
          fontSize: '0.78rem',
        }}
      >
        <Row label="Position">
          {parsed
            ? `${parsed.chr}:${parsed.pos.toLocaleString()}`
            : `${record.chr}:${record.pos.toLocaleString()}`}
        </Row>
        {parsed && (
          <Row label="Change">
            <code>
              {parsed.ref} &rarr; {parsed.alt}
            </code>
          </Row>
        )}
        <Row label="Significance">{humanSig(record.significance)}</Row>
        {meta.hgvsp && <Row label="HGVSp">{meta.hgvsp}</Row>}
        {meta.majorConsequence && <Row label="Consequence">{meta.majorConsequence}</Row>}
        {typeof meta.goldStars === 'number' && (
          <Row label="Review">
            <span style={{ letterSpacing: 1 }}>
              {'★'.repeat(meta.goldStars)}
              {'☆'.repeat(Math.max(0, 4 - meta.goldStars))}
            </span>
            {record.reviewStatus && (
              <span style={{ marginLeft: 8, opacity: 0.7 }}>{record.reviewStatus}</span>
            )}
          </Row>
        )}
        {typeof meta.goldStars !== 'number' && record.reviewStatus && (
          <Row label="Review">{record.reviewStatus}</Row>
        )}
      </dl>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt style={{ opacity: 0.6 }}>{label}</dt>
      <dd style={{ margin: 0 }}>{children}</dd>
    </>
  );
}

function parseVariantId(
  id: string,
): { chr: string; pos: number; ref: string; alt: string } | null {
  // gnomAD variant ids are `<chr>-<pos>-<ref>-<alt>` (e.g., 17-7675236-ACTG-A).
  const m = /^([^-]+)-(\d+)-([A-Za-z]+)-([A-Za-z]+)$/.exec(id);
  if (!m) return null;
  const [, chrRaw, posRaw, ref, alt] = m;
  const chr = chrRaw.startsWith('chr') ? chrRaw : `chr${chrRaw}`;
  return { chr, pos: Number(posRaw), ref, alt };
}

function StatusBar({
  state,
  requestedId,
}: {
  state: LoadState;
  requestedId: string | null;
}) {
  if (state.kind === 'error') {
    return (
      <p
        data-testid="embed-error"
        style={{
          margin: 0,
          padding: '8px 12px',
          background: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: 6,
          color: '#991b1b',
        }}
      >
        {state.message}
      </p>
    );
  }
  if (state.kind === 'loading' || state.kind === 'idle') {
    return (
      <p data-testid="embed-status" style={{ margin: 0, opacity: 0.7 }}>
        Loading{requestedId ? ` ${requestedId}` : ''}…
      </p>
    );
  }
  const data = state.data;
  return (
    <header
      data-testid="embed-header"
      style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'baseline' }}
    >
      <strong style={{ fontSize: '1rem' }}>{data.geneSymbol}</strong>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
        {data.transcript.transcriptId}
      </span>
      <span style={{ opacity: 0.6 }}>
        {data.clinvar.length} ClinVar variants ·{' '}
        <em style={{ fontStyle: 'normal', opacity: 0.7 }}>
          source: {data.source}
        </em>
      </span>
      {data.redirectedToCanonical && (
        <CanonicalBanner
          requested={data.requestedTranscriptId}
          canonical={data.transcript.transcriptId}
        />
      )}
    </header>
  );
}

function CanonicalBanner({
  requested,
  canonical,
}: {
  requested: string;
  canonical: string;
}) {
  // Re-load the page with `force=1` and the original requested id so
  // the user can opt back into seeing the non-canonical transcript.
  const url = new URL(window.location.href);
  url.searchParams.set('transcript', requested);
  url.searchParams.set('force', '1');
  return (
    <span
      data-testid="embed-canonical-banner"
      style={{
        padding: '4px 10px',
        background: '#fef9c3',
        border: '1px solid #fde68a',
        borderRadius: 6,
        color: '#854d0e',
        fontSize: '0.78rem',
      }}
    >
      Showing canonical <strong>{canonical}</strong> instead of requested{' '}
      <strong>{requested}</strong>.{' '}
      <a href={url.toString()}>view requested anyway</a>
    </span>
  );
}

function readUrlParams(): { requestedId: string | null; force: boolean } {
  if (typeof window === 'undefined') return { requestedId: null, force: false };
  const params = new URLSearchParams(window.location.search);
  const id = params.get('transcript')?.trim();
  const force = params.get('force') === '1' || params.get('force') === 'true';
  return { requestedId: id || null, force };
}

function humanSig(s: ClinVarSignificance): string {
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
