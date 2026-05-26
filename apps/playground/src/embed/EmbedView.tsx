import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  DefaultTrackChevron,
  GeneGlyph,
  aaTrack,
  clinVarSummaryTrack,
  clinVarTrack,
  defaultClinVarSymbolEncoding,
  exonTrack,
  interProTrack,
  nucleotideTrack,
  fnv1a32Hex,
  parseUserVariants,
  resolveSelectedId,
  scaleTrack,
  userVariantTrack,
} from '@populationgenomics/gene-glyph';
import type {
  ClinVarRecord,
  ClinVarSignificance,
  GeneGlyphRef,
  GutterItem,
  ParsedUserVariant,
  ProteinAnnotations,
  TooltipRenderArgs,
  TrackOrGroup,
  Transcript,
  UserVariantRecord,
  ViewMode,
} from '@populationgenomics/gene-glyph';
import { fetchTranscriptData, type LiveTranscriptData } from '../lib/gnomad.js';
import { fetchProteinAnnotations } from '../lib/protein.js';
import { fetchCdsSequence } from '../lib/sequence.js';
import { resolveVariantsViaVV } from '../lib/variant-validator.js';

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

const STAR_LEVELS = [0, 1, 2, 3, 4] as const;
type StarLevel = (typeof STAR_LEVELS)[number];

/** Coarse variant-type buckets, grouped from gnomAD's `major_consequence`
 *  Sequence Ontology terms. A chip per bucket lets a clinician hide whole
 *  classes (e.g. silence the synonymous-variant chip when triaging for LoF). */
const VARIANT_TYPES = [
  'missense',
  'nonsense',
  'frameshift',
  'splice',
  'inframe_indel',
  'synonymous',
  'utr',
  'other',
] as const;
type VariantType = (typeof VARIANT_TYPES)[number];

const VARIANT_TYPE_LABELS: Record<VariantType, string> = {
  missense: 'Missense',
  nonsense: 'Nonsense',
  frameshift: 'Frameshift',
  splice: 'Splice',
  inframe_indel: 'In-frame indel',
  synonymous: 'Synonymous',
  utr: 'UTR',
  other: 'Other',
};

const CLINVAR_GROUP_ID = 'clinvar-group';

type Density = 'compact' | 'normal' | 'roomy';

const TRACK_TOGGLES = [
  { id: 'scale', label: 'Scale' },
  { id: 'exon', label: 'Exon' },
  { id: 'nucleotide', label: 'Nucleotide' },
  { id: 'aa', label: 'Amino acid' },
  { id: 'interpro', label: 'InterPro' },
  { id: 'clinvar', label: 'ClinVar' },
] as const;
type TrackToggleId = (typeof TRACK_TOGGLES)[number]['id'];
const TRACK_TOGGLE_IDS = new Set<string>(TRACK_TOGGLES.map((t) => t.id));

const DEFAULT_COLLAPSED_GROUPS: ReadonlySet<string> = new Set([
  CLINVAR_GROUP_ID,
  ...SIGNIFICANCE_CHIPS.map((sig) => `clinvar-${sig}`),
]);

function recordStars(r: ClinVarRecord): StarLevel {
  const raw = ((r.meta ?? {}) as { goldStars?: number }).goldStars ?? 0;
  const clamped = Math.max(0, Math.min(4, Math.floor(raw)));
  return clamped as StarLevel;
}

function recordVariantType(r: ClinVarRecord): VariantType {
  const raw = ((r.meta ?? {}) as { majorConsequence?: string }).majorConsequence ?? '';
  const c = raw.toLowerCase();
  if (c === 'missense_variant') return 'missense';
  if (c === 'stop_gained' || c === 'stop_lost' || c === 'start_lost') return 'nonsense';
  if (c === 'frameshift_variant') return 'frameshift';
  if (c.startsWith('splice_')) return 'splice';
  if (c === 'inframe_insertion' || c === 'inframe_deletion') return 'inframe_indel';
  if (c === 'synonymous_variant' || c === 'stop_retained_variant') return 'synonymous';
  if (c.includes('utr') || c === 'non_coding_transcript_exon_variant') return 'utr';
  return 'other';
}

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading'; transcriptId: string }
  | { kind: 'ready'; data: LiveTranscriptData }
  | { kind: 'error'; message: string };

export function EmbedView() {
  const initial = useMemo(() => readUrlParams(), []);
  const { requestedId, force } = initial;
  const [state, setState] = useState<LoadState>(() =>
    requestedId
      ? { kind: 'loading', transcriptId: requestedId }
      : { kind: 'error', message: 'Missing ?transcript=ENST… query parameter.' },
  );
  const [selectedId, setSelectedId] = useState<string | null>(initial.selectedId);
  const [excluded, setExcluded] = useState<ReadonlySet<ClinVarSignificance>>(
    initial.excludedSigs,
  );
  const [excludedStars, setExcludedStars] = useState<ReadonlySet<StarLevel>>(
    initial.excludedStars,
  );
  const [excludedTypes, setExcludedTypes] = useState<ReadonlySet<VariantType>>(
    initial.excludedTypes,
  );
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(
    initial.collapsedGroups,
  );
  const [protein, setProtein] = useState<ProteinAnnotations | null>(null);
  const [cdsSequence, setCdsSequence] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>(initial.mode);
  const [density, setDensity] = useState<Density>(initial.density);
  const [hiddenTracks, setHiddenTracks] = useState<ReadonlySet<TrackToggleId>>(
    initial.hiddenTracks,
  );
  // Slice 34: user-supplied variants from `?variants=`. The figure
  // renders these as purple crosses between the exon and InterPro
  // tracks; unparseable entries surface in the figure footer.
  const [userVariants] = useState<readonly ParsedUserVariant[]>(initial.userVariants);
  const [userVariantErrors, setUserVariantErrors] = useState<readonly string[]>(
    initial.userVariantErrors,
  );
  const [userVariantsRaw] = useState<string>(initial.userVariantsRaw);
  // Slice 36: HGVS tokens get resolved through VariantValidator after
  // the local parser hands them off. `hgvsResolved` collects the
  // successful resolutions; `hgvsPending` is the working count for
  // the in-flight "resolving via VariantValidator…" banner.
  const [hgvsTokens] = useState<readonly string[]>(initial.userVariantHgvsTokens);
  const [hgvsResolved, setHgvsResolved] = useState<readonly ParsedUserVariant[]>([]);
  const [hgvsPending, setHgvsPending] = useState<number>(initial.userVariantHgvsTokens.length);
  const viewerRef = useRef<GeneGlyphRef | null>(null);

  useEffect(() => {
    if (!requestedId) return;
    const controller = new AbortController();
    // Reset to loading on dep change — the alternative (derive loading
    // from a ref) doesn't pay for the indirection here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  // Separate fetch for InterPro / Pfam protein annotations — slower and
  // less critical than the ClinVar load, so we don't gate the main
  // figure on it. The track renders empty when `protein` is null.
  useEffect(() => {
    if (!requestedId) return;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProtein(null);
    fetchProteinAnnotations(requestedId, controller.signal)
      .then((p) => {
        if (controller.signal.aborted) return;
        setProtein(p);
      })
      .catch(() => {
        // Swallow — the figure still renders without protein annotations.
      });
    return () => controller.abort();
  }, [requestedId]);

  // Fetch the CDS nucleotide sequence in parallel. Both the nucleotide
  // track and the aa track (via translation) consume this; both stay
  // height-0 until live zoom is high enough to render per-bp / per-aa
  // glyphs, so the upfront fetch only pays off when the user zooms in.
  useEffect(() => {
    if (!requestedId) return;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCdsSequence(null);
    fetchCdsSequence(requestedId, controller.signal)
      .then((s) => {
        if (controller.signal.aborted) return;
        setCdsSequence(s);
      })
      .catch(() => {
        // Swallow — sequence tracks just stay collapsed.
      });
    return () => controller.abort();
  }, [requestedId]);

  // Slice 36: resolve HGVS tokens via VariantValidator. The
  // resolution cache lives outside the effect so a transcript change
  // clears it (new transcript = new c./n. coord space, all cached
  // resolutions are invalid); within one transcript, repeat URL
  // loads with the same `?variants=` hit the cache and fire no
  // network call. Cache key = lowercased raw token.
  useEffect(() => {
    if (!requestedId || hgvsTokens.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHgvsPending(0);
      return;
    }
    const controller = new AbortController();
    setHgvsResolved([]);
    setHgvsPending(hgvsTokens.length);
    // Filter against the cache first so already-resolved tokens
    // surface immediately and only un-cached ones hit the network.
    const cache = hgvsCacheFor(requestedId);
    const cached: ParsedUserVariant[] = [];
    const toFetch: string[] = [];
    for (const raw of hgvsTokens) {
      const key = raw.toLowerCase();
      const hit = cache.get(key);
      if (hit) cached.push(hit);
      else toFetch.push(raw);
    }
    if (cached.length > 0) {
      setHgvsResolved(cached);
      setHgvsPending(toFetch.length);
    }
    if (toFetch.length === 0) {
      return () => controller.abort();
    }
    resolveVariantsViaVV(toFetch, requestedId, controller.signal)
      .then((results) => {
        if (controller.signal.aborted) return;
        const resolved: ParsedUserVariant[] = [];
        const errors: string[] = [];
        for (const r of results) {
          if ('result' in r) {
            const variant: ParsedUserVariant = {
              id: r.result.id,
              chr: r.result.chr,
              pos: r.result.pos,
              ref: r.result.ref,
              alt: r.result.alt,
              raw: r.raw,
            };
            cache.set(r.raw.toLowerCase(), variant);
            resolved.push(variant);
          } else {
            errors.push(r.raw);
          }
        }
        setHgvsResolved((prev) => mergeResolved(prev, resolved));
        if (errors.length > 0) {
          setUserVariantErrors((prev) => [...prev, ...errors]);
        }
        setHgvsPending(0);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        // Network-level failure (VV down, CORS rejection, …) — every
        // un-cached token falls into the parse-error footer alongside
        // any pre-existing failures.
        setUserVariantErrors((prev) => [...prev, ...toFetch]);
        setHgvsPending(0);
      });
    return () => controller.abort();
  }, [requestedId, hgvsTokens]);

  const toggleHiddenTrack = (id: TrackToggleId) =>
    setHiddenTracks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const filter = useCallback(
    (r: ClinVarRecord) =>
      !excluded.has(r.significance) &&
      !excludedStars.has(recordStars(r)) &&
      !excludedTypes.has(recordVariantType(r)),
    [excluded, excludedStars, excludedTypes],
  );
  const records = state.kind === 'ready' ? state.data.clinvar : [];
  // The selection survives chip toggles: when the user excludes the
  // selected variant's significance or star tier the detail card and
  // ring just hide until they re-enable the matching chip.
  // Slice 36: combined user-variant list — locally-parsed entries
  // (Slice 34) plus anything VariantValidator resolved from the
  // HGVS bucket. Dedup by canonical id so an HGVS that collapses to
  // the same coordinate as a canonical entry doesn't double-render.
  const allUserVariants = useMemo(
    () => mergeResolved(userVariants, hgvsResolved),
    [userVariants, hgvsResolved],
  );
  // Slice 35: `selectedId` may be either the raw canonical id (pre-
  // Slice-35 share links) or an FNV-1a hash (the new URL form). Build
  // a candidate-id list from every track the embed can surface, then
  // resolve the URL value through `resolveSelectedId` which tries the
  // raw form first and falls back to hashing.
  const resolvedSelectedId = useMemo(() => {
    if (!selectedId) return null;
    const ids = [
      ...records.map((r) => r.id),
      ...allUserVariants.map((v) => v.id),
    ];
    return resolveSelectedId(selectedId, ids);
  }, [selectedId, records, allUserVariants]);
  // Promote the URL-hash form to its canonical id as soon as the data
  // loads. Without this, a "click selected variant to deselect"
  // gesture in the brief load-pending window would compare a hash
  // against the canonical featureId and silently miss the toggle.
  useEffect(() => {
    if (!resolvedSelectedId) return;
    // Promote the URL form to its canonical id once data loads — a
    // one-shot reconciliation; lazy state init isn't an option because
    // the loaders run async.
    if (resolvedSelectedId !== selectedId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedId(resolvedSelectedId);
    }
  }, [resolvedSelectedId, selectedId]);

  // Mirror visible state into the URL so the page is fully shareable.
  // Only non-default values land in the query string to keep URLs short.
  // `history.replaceState` avoids polluting the back-button stack.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const p = new URLSearchParams();
    if (requestedId) p.set('transcript', requestedId);
    if (force) p.set('force', '1');
    if (mode !== 'transcript') p.set('mode', mode);
    if (density !== 'normal') p.set('density', density);
    if (excluded.size > 0) p.set('excluded', csvSorted(excluded));
    if (excludedStars.size > 0)
      p.set('excludedStars', csvSorted(excludedStars, (a, b) => a - b));
    if (excludedTypes.size > 0) p.set('excludedTypes', csvSorted(excludedTypes));
    // Slice 35: round-trip selection through a short FNV-1a hash so
    // long deletion ids (`11-5226947-ACCT…CCTGC-A`) don't drag the
    // URL out to hundreds of characters. URL→state resolution still
    // accepts the raw id (backward compat with pre-Slice-35 links).
    // We hash the canonical id once the data has loaded; before that
    // we pass the raw URL value straight through (so a hash URL stays
    // a hash URL while load is pending).
    if (selectedId) {
      const canonical = resolvedSelectedId ?? selectedId;
      p.set('selected', fnv1a32Hex(canonical));
    }
    // Skip the default-collapsed state; serialise anything else (including
    // an empty set, which means "all groups expanded").
    if (!sameSet(collapsedGroups, DEFAULT_COLLAPSED_GROUPS)) {
      p.set('collapsed', csvSorted(collapsedGroups));
    }
    if (hiddenTracks.size > 0) p.set('hide', csvSorted(hiddenTracks));
    if (userVariantsRaw) p.set('variants', userVariantsRaw);
    const qs = p.toString();
    const url = window.location.pathname + (qs ? `?${qs}` : '');
    window.history.replaceState(null, '', url);
  }, [
    requestedId,
    force,
    mode,
    density,
    excluded,
    excludedStars,
    excludedTypes,
    selectedId,
    resolvedSelectedId,
    collapsedGroups,
    hiddenTracks,
    userVariantsRaw,
  ]);

  const selectedRecord = useMemo(() => {
    if (!resolvedSelectedId) return null;
    const r = records.find((r) => r.id === resolvedSelectedId) ?? null;
    return r && filter(r) ? r : null;
  }, [resolvedSelectedId, records, filter]);
  // Slice 35: extend selection to user-supplied variants. A selected
  // user-variant id never appears in ClinVar's records so the lookup
  // above returns null; we resolve it from the parsed user list here.
  const selectedUserVariant = useMemo(() => {
    if (!resolvedSelectedId) return null;
    return allUserVariants.find((v) => v.id === resolvedSelectedId) ?? null;
  }, [resolvedSelectedId, allUserVariants]);
  const selectedFeatureIds = useMemo(() => {
    if (selectedRecord) return new Set([selectedRecord.id]);
    if (selectedUserVariant) return new Set([selectedUserVariant.id]);
    return new Set<string>();
  }, [selectedRecord, selectedUserVariant]);
  // Plain-click toggles a chip; shift-click solos that chip within its group
  // (excludes every other chip in the same row). Shift-click on an already-
  // soloed chip restores the whole group.
  const chipClick = <T,>(
    e: React.MouseEvent,
    all: readonly T[],
    val: T,
    excluded: ReadonlySet<T>,
    setExcluded: React.Dispatch<React.SetStateAction<ReadonlySet<T>>>,
  ) => {
    if (e.shiftKey) {
      const others = all.filter((x) => x !== val);
      const alreadySoloed =
        !excluded.has(val) && others.every((x) => excluded.has(x));
      setExcluded(alreadySoloed ? new Set() : new Set(others));
      return;
    }
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(val)) next.delete(val);
      else next.add(val);
      return next;
    });
  };

  // Hash of the active exclusions + density preset. Folded into each
  // detail track's `configKey` so the viewer notices when the host
  // predicate or row pitch changes — without that, `load()`'s packed
  // `stackLayout` is reused and the figure's height stays stuck on the
  // pre-change row count.
  const filterKey = useMemo(() => {
    const sig = [...excluded].sort().join(',');
    const stars = [...excludedStars].sort((a, b) => a - b).join(',');
    const types = [...excludedTypes].sort().join(',');
    return `s=${sig};r=${stars};t=${types};d=${density}`;
  }, [excluded, excludedStars, excludedTypes, density]);

  const densityConfig = useMemo(
    () =>
      density === 'compact'
        ? { markRadius: 2.5, stackLanePx: 6 }
        : density === 'roomy'
          ? { markRadius: 6, stackLanePx: 14 }
          : { markRadius: 4, stackLanePx: 10 },
    [density],
  );

  // Slice 34: build the user-variant record list from parsed URL
  // entries. The figure pulls `chr` (with `chr` prefix) so it matches
  // exon.chr exactly; `label` defaults to the raw user input so
  // tooltips read back the form they typed.
  const userVariantRecords = useMemo<UserVariantRecord[]>(
    () =>
      allUserVariants.map((v) => ({
        id: v.id,
        chr: v.chr,
        pos: v.pos,
        label: v.raw.trim() || v.id,
        refLen: Math.max(v.ref.length, 1),
        meta: { ref: v.ref, alt: v.alt, raw: v.raw },
      })),
    [allUserVariants],
  );

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
            configKey: filterKey,
            markRadius: densityConfig.markRadius,
            stackLanePx: densityConfig.stackLanePx,
          }),
        ],
        summaryTrack: clinVarSummaryTrack({
          id: `clinvar-${sig}-summary`,
          source: records,
          filter: sigFilter,
        }),
      };
    };
    const out: TrackOrGroup[] = [];
    if (!hiddenTracks.has('scale')) out.push(scaleTrack({ id: 'scale' }));
    if (!hiddenTracks.has('exon')) out.push(exonTrack({}));
    if (!hiddenTracks.has('nucleotide') && cdsSequence) {
      out.push(nucleotideTrack({ id: 'nucleotide', source: cdsSequence }));
    }
    if (!hiddenTracks.has('aa') && cdsSequence) {
      out.push(aaTrack({ id: 'aa', nucleotideSource: cdsSequence }));
    }
    // Slice 34: user-supplied variants sit between exon and interpro
    // so they read against the gene structure rather than getting
    // buried under ClinVar. Only added when the URL provided some.
    if (userVariantRecords.length > 0) {
      out.push(
        userVariantTrack({
          id: 'user-variants',
          source: userVariantRecords,
          markRadius: densityConfig.markRadius,
          stackLanePx: densityConfig.stackLanePx,
        }),
      );
    }
    if (!hiddenTracks.has('interpro')) out.push(interProTrack({}));
    if (!hiddenTracks.has('clinvar')) {
      out.push({
        kind: 'group',
        id: CLINVAR_GROUP_ID,
        label: 'ClinVar',
        headerHeight: 22,
        gapAbove: 12,
        tracks: SIGNIFICANCE_CHIPS.map(subgroup),
        summaryTrack: clinVarSummaryTrack({
          id: 'clinvar-summary',
          source: records,
          filter,
        }),
      });
    }
    return out;
  }, [records, filter, filterKey, densityConfig, cdsSequence, hiddenTracks, userVariantRecords]);

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
      {state.kind === 'ready' && (
        <Toolbar
          mode={mode}
          onModeChange={setMode}
          density={density}
          onDensityChange={setDensity}
          hiddenTracks={hiddenTracks}
          onToggleTrack={toggleHiddenTrack}
        />
      )}
      <StatusBar state={state} requestedId={requestedId} />
      {state.kind === 'ready' && (
        <section
          data-testid="embed-clinvar-filters"
          aria-label="ClinVar filters"
          style={{
            margin: '10px 0',
            padding: '10px 12px',
            background: '#f8fafc',
            border: '1px solid #cbd5e1',
            borderRadius: 6,
          }}
        >
          <header
            style={{
              fontSize: '0.78rem',
              fontWeight: 600,
              color: '#475569',
              marginBottom: 6,
              letterSpacing: 0.2,
            }}
          >
            ClinVar filters
            <span
              style={{
                marginLeft: 8,
                fontWeight: 400,
                opacity: 0.65,
                fontStyle: 'italic',
              }}
            >
              shift-click to solo within a row
            </span>
          </header>
          <div
            data-testid="embed-significance-filter"
            style={{
              display: 'flex',
              gap: 6,
              flexWrap: 'wrap',
              alignItems: 'center',
              margin: '4px 0',
              color: '#475569',
            }}
          >
            <span style={{ opacity: 0.75, minWidth: 80 }}>significance:</span>
            {SIGNIFICANCE_CHIPS.map((sig) => {
              const active = !excluded.has(sig);
              return (
                <button
                  key={sig}
                  type="button"
                  data-testid={`embed-chip-${sig}`}
                  data-active={active}
                  onClick={(e) =>
                    chipClick(e, SIGNIFICANCE_CHIPS, sig, excluded, setExcluded)
                  }
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
          <div
            data-testid="embed-stars-filter"
            style={{
              display: 'flex',
              gap: 6,
              flexWrap: 'wrap',
              alignItems: 'center',
              margin: '4px 0',
              color: '#475569',
            }}
          >
            <span style={{ opacity: 0.75, minWidth: 80 }}>review:</span>
            {STAR_LEVELS.map((n) => {
              const active = !excludedStars.has(n);
              const label = n === 0 ? '☆' : '★'.repeat(n);
              return (
                <button
                  key={n}
                  type="button"
                  data-testid={`embed-chip-stars-${n}`}
                  data-active={active}
                  onClick={(e) =>
                    chipClick(e, STAR_LEVELS, n, excludedStars, setExcludedStars)
                  }
                  aria-label={
                    n === 0
                      ? 'no review stars'
                      : `${n} review star${n === 1 ? '' : 's'}`
                  }
                  style={{
                    padding: '2px 8px',
                    fontSize: '0.78rem',
                    borderRadius: 999,
                    border: '1px solid #cbd5e1',
                    background: active ? '#e0f2fe' : '#f1f5f9',
                    color: active ? '#0c4a6e' : '#94a3b8',
                    cursor: 'pointer',
                    letterSpacing: 1,
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div
            data-testid="embed-type-filter"
            style={{
              display: 'flex',
              gap: 6,
              flexWrap: 'wrap',
              alignItems: 'center',
              margin: '4px 0',
              color: '#475569',
            }}
          >
            <span style={{ opacity: 0.75, minWidth: 80 }}>type:</span>
            {VARIANT_TYPES.map((t) => {
              const active = !excludedTypes.has(t);
              return (
                <button
                  key={t}
                  type="button"
                  data-testid={`embed-chip-type-${t}`}
                  data-active={active}
                  onClick={(e) =>
                    chipClick(e, VARIANT_TYPES, t, excludedTypes, setExcludedTypes)
                  }
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
                  {VARIANT_TYPE_LABELS[t]}
                </button>
              );
            })}
          </div>
        </section>
      )}
      <GeneGlyph
        ref={viewerRef}
        transcript={transcript}
        protein={protein ?? undefined}
        tracks={tracks}
        mode={mode}
        onModeChange={setMode}
        trackHeightBudget={16000}
        collapsedGroupIds={collapsedGroups}
        onCollapsedGroupChange={setCollapsedGroups}
        renderTooltip={renderTooltip}
        selectedFeatureIds={selectedFeatureIds}
        onFeatureClick={(featureId, trackId) => {
          // Slice 35: user-variant clicks toggle the same selection
          // state ClinVar uses, so the drop-line / detail card flow
          // covers both surfaces.
          if (!trackId.startsWith('clinvar') && trackId !== 'user-variants') return;
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
      {selectedUserVariant && (
        <SelectedUserVariantCard
          variant={selectedUserVariant}
          onClear={() => setSelectedId(null)}
        />
      )}
      <UserVariantFooter
        errors={userVariantErrors}
        parsedCount={allUserVariants.length}
        hgvsPending={hgvsPending}
      />
    </main>
  );
}

function UserVariantFooter({
  errors,
  parsedCount,
  hgvsPending,
}: {
  errors: readonly string[];
  parsedCount: number;
  hgvsPending: number;
}) {
  if (hgvsPending > 0) {
    const word = hgvsPending === 1 ? 'variant' : 'variants';
    return (
      <section
        data-testid="embed-user-variant-resolving"
        style={{
          marginTop: 8,
          padding: '6px 10px',
          background: '#eef2ff',
          border: '1px solid #c7d2fe',
          borderRadius: 6,
          color: '#3730a3',
          fontSize: '0.78rem',
        }}
      >
        Resolving {hgvsPending} HGVS {word} via VariantValidator…
      </section>
    );
  }
  if (errors.length === 0) return null;
  const word = errors.length === 1 ? 'variant' : 'variants';
  return (
    <section
      data-testid="embed-user-variant-footer"
      style={{
        marginTop: 8,
        padding: '6px 10px',
        background: '#fef9c3',
        border: '1px solid #fde68a',
        borderRadius: 6,
        color: '#854d0e',
        fontSize: '0.78rem',
      }}
    >
      <strong>{errors.length}</strong> {word} couldn't be parsed:{' '}
      {errors.map((e, i) => (
        <span key={`${e}-${i}`}>
          <code
            data-testid="embed-user-variant-error"
            style={{
              background: '#fff7ed',
              border: '1px solid #fed7aa',
              borderRadius: 3,
              padding: '0 4px',
              marginRight: i === errors.length - 1 ? 0 : 4,
            }}
          >
            {e}
          </code>
        </span>
      ))}
      {parsedCount > 0 && (
        <span style={{ marginLeft: 8, opacity: 0.7 }}>
          ({parsedCount} valid variant{parsedCount === 1 ? '' : 's'} rendered)
        </span>
      )}
    </section>
  );
}

const VIEW_MODES: readonly ViewMode[] = ['genome', 'transcript', 'protein'];
const DENSITIES: readonly Density[] = ['compact', 'normal', 'roomy'];

const VIEW_MODE_LABEL: Record<ViewMode, string> = {
  genome: 'Genome view',
  transcript: 'Transcript view',
  protein: 'Protein view',
};
const DENSITY_LABEL: Record<Density, string> = {
  compact: 'Compact rows',
  normal: 'Normal rows',
  roomy: 'Roomy rows',
};

function Toolbar({
  mode,
  onModeChange,
  density,
  onDensityChange,
  hiddenTracks,
  onToggleTrack,
}: {
  mode: ViewMode;
  onModeChange: (m: ViewMode) => void;
  density: Density;
  onDensityChange: (d: Density) => void;
  hiddenTracks: ReadonlySet<TrackToggleId>;
  onToggleTrack: (id: TrackToggleId) => void;
}) {
  return (
    <nav
      data-testid="embed-toolbar"
      aria-label="Figure controls"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 10,
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 4,
        padding: '6px 12px',
        margin: '-12px -12px 10px',
        background: 'rgba(248, 250, 252, 0.92)',
        borderBottom: '1px solid #e2e8f0',
        backdropFilter: 'saturate(140%) blur(4px)',
        WebkitBackdropFilter: 'saturate(140%) blur(4px)',
      }}
    >
      <ToolbarGroup label="view mode">
        {VIEW_MODES.map((m) => (
          <ToolbarButton
            key={m}
            active={mode === m}
            onClick={() => onModeChange(m)}
            label={VIEW_MODE_LABEL[m]}
            testId={`embed-mode-${m}`}
          >
            <ModeIcon mode={m} />
          </ToolbarButton>
        ))}
      </ToolbarGroup>
      <ToolbarDivider />
      <ToolbarGroup label="density">
        {DENSITIES.map((d) => (
          <ToolbarButton
            key={d}
            active={density === d}
            onClick={() => onDensityChange(d)}
            label={DENSITY_LABEL[d]}
            testId={`embed-density-${d}`}
          >
            <DensityIcon density={d} />
          </ToolbarButton>
        ))}
      </ToolbarGroup>
      <ToolbarDivider />
      <ToolbarGroup label="tracks">
        {TRACK_TOGGLES.map((t) => {
          const visible = !hiddenTracks.has(t.id);
          return (
            <ToolbarButton
              key={t.id}
              active={visible}
              onClick={() => onToggleTrack(t.id)}
              label={`${t.label} track${visible ? ' (shown)' : ' (hidden)'}`}
              testId={`embed-track-${t.id}`}
            >
              <TrackIcon id={t.id} />
            </ToolbarButton>
          );
        })}
      </ToolbarGroup>
    </nav>
  );
}

function ToolbarGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role="group"
      aria-label={label}
      style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}
    >
      {children}
    </div>
  );
}

function ToolbarDivider() {
  return (
    <span
      aria-hidden
      style={{
        width: 1,
        height: 20,
        background: '#cbd5e1',
        margin: '0 6px',
      }}
    />
  );
}

function ToolbarButton({
  active,
  onClick,
  label,
  testId,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      data-active={active}
      aria-pressed={active}
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{
        width: 28,
        height: 28,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        borderRadius: 6,
        border: `1px solid ${active ? '#0c4a6e' : '#cbd5e1'}`,
        background: active ? '#0c4a6e' : '#ffffff',
        color: active ? '#e0f2fe' : '#475569',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

const SVG_BASE: React.SVGProps<SVGSVGElement> = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

function ModeIcon({ mode }: { mode: ViewMode }) {
  if (mode === 'genome') {
    return (
      <svg {...SVG_BASE}>
        <rect x="1.5" y="5" width="13" height="6" rx="3" />
        <line x1="5" y1="5" x2="5" y2="11" />
        <line x1="8" y1="5" x2="8" y2="11" />
        <line x1="11" y1="5" x2="11" y2="11" />
      </svg>
    );
  }
  if (mode === 'transcript') {
    return (
      <svg {...SVG_BASE}>
        <rect x="1.5" y="6" width="3" height="4" fill="currentColor" stroke="none" />
        <line x1="4.5" y1="8" x2="7" y2="8" />
        <rect x="7" y="6" width="2" height="4" fill="currentColor" stroke="none" />
        <line x1="9" y1="8" x2="11.5" y2="8" />
        <rect x="11.5" y="6" width="3" height="4" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  return (
    <svg {...SVG_BASE}>
      <path d="M2 10 C 4 5, 6 5, 8 8 S 12 11, 14 6" />
    </svg>
  );
}

function DensityIcon({ density }: { density: Density }) {
  if (density === 'compact') {
    return (
      <svg {...SVG_BASE}>
        <line x1="2" y1="4" x2="14" y2="4" />
        <line x1="2" y1="7" x2="14" y2="7" />
        <line x1="2" y1="10" x2="14" y2="10" />
        <line x1="2" y1="13" x2="14" y2="13" />
      </svg>
    );
  }
  if (density === 'normal') {
    return (
      <svg {...SVG_BASE}>
        <line x1="2" y1="4" x2="14" y2="4" />
        <line x1="2" y1="8" x2="14" y2="8" />
        <line x1="2" y1="12" x2="14" y2="12" />
      </svg>
    );
  }
  return (
    <svg {...SVG_BASE}>
      <line x1="2" y1="5" x2="14" y2="5" />
      <line x1="2" y1="11" x2="14" y2="11" />
    </svg>
  );
}

function TrackIcon({ id }: { id: TrackToggleId }) {
  switch (id) {
    case 'scale':
      return (
        <svg {...SVG_BASE}>
          <line x1="2" y1="11" x2="14" y2="11" />
          <line x1="3" y1="9" x2="3" y2="11" />
          <line x1="6" y1="9" x2="6" y2="11" />
          <line x1="9" y1="6" x2="9" y2="11" />
          <line x1="12" y1="9" x2="12" y2="11" />
        </svg>
      );
    case 'exon':
      return (
        <svg {...SVG_BASE}>
          <rect x="1.5" y="5" width="4" height="6" fill="currentColor" stroke="none" />
          <line x1="5.5" y1="8" x2="10.5" y2="8" />
          <rect x="10.5" y="5" width="4" height="6" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'nucleotide':
      return (
        <svg {...SVG_BASE}>
          <path d="M3 3 Q 8 8 3 13" />
          <path d="M13 3 Q 8 8 13 13" />
          <line x1="4" y1="6" x2="12" y2="6" />
          <line x1="4" y1="10" x2="12" y2="10" />
        </svg>
      );
    case 'aa':
      return (
        <svg {...SVG_BASE}>
          <polyline points="2,11 5,5 8,11 11,5 14,11" />
        </svg>
      );
    case 'interpro':
      return (
        <svg {...SVG_BASE}>
          <rect x="1.5" y="5" width="13" height="6" rx="3" />
        </svg>
      );
    case 'clinvar':
      return (
        <svg {...SVG_BASE}>
          <polygon
            points="8,1.8 9.85,5.95 14.35,6.5 11.1,9.55 11.95,14 8,11.85 4.05,14 4.9,9.55 1.65,6.5 6.15,5.95"
            fill="currentColor"
            stroke="none"
          />
        </svg>
      );
  }
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

function SelectedUserVariantCard({
  variant,
  onClear,
}: {
  variant: ParsedUserVariant;
  onClear: () => void;
}) {
  return (
    <section
      data-testid="embed-selected-user-variant"
      style={{
        marginTop: 10,
        padding: '10px 12px',
        background: '#faf5ff',
        border: '1px solid #d8b4fe',
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
          <strong style={{ fontSize: '0.95rem' }}>{variant.raw.trim() || variant.id}</strong>
          <code
            style={{
              fontSize: '0.78rem',
              opacity: 0.7,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {variant.id}
          </code>
        </div>
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear selection"
          style={{
            border: '1px solid #d8b4fe',
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
        <Row label="Position">{`${variant.chr}:${variant.pos.toLocaleString()}`}</Row>
        <Row label="Change">
          <code>
            {variant.ref} &rarr; {variant.alt}
          </code>
        </Row>
        <Row label="Source">user-supplied</Row>
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

interface UrlState {
  requestedId: string | null;
  force: boolean;
  mode: ViewMode;
  density: Density;
  excludedSigs: ReadonlySet<ClinVarSignificance>;
  excludedStars: ReadonlySet<StarLevel>;
  excludedTypes: ReadonlySet<VariantType>;
  selectedId: string | null;
  collapsedGroups: ReadonlySet<string>;
  hiddenTracks: ReadonlySet<TrackToggleId>;
  /** Slice 34 — parsed user-supplied variants from `?variants=`. */
  userVariants: readonly ParsedUserVariant[];
  /** Slice 34 — raw tokens that failed to parse, surfaced verbatim in
   *  the footer error so the user can see exactly what they typed. */
  userVariantErrors: readonly string[];
  /** Slice 34 — the raw `?variants=` string. Kept so the URL round-trip
   *  preserves user formatting (we only canonicalise on submit). */
  userVariantsRaw: string;
  /** Slice 36 — HGVS tokens (c./p./g./n./r./m.) that need
   *  VariantValidator resolution. The embed fires VV calls in parallel
   *  and merges resolved entries into the live user-variant set; any
   *  that fail collapse into the parse-error footer. */
  userVariantHgvsTokens: readonly string[];
}

const SIGNIFICANCE_VALUES: ReadonlySet<string> = new Set(SIGNIFICANCE_CHIPS);
const VARIANT_TYPE_VALUES: ReadonlySet<string> = new Set(VARIANT_TYPES);

function readUrlParams(): UrlState {
  const fallback: UrlState = {
    requestedId: null,
    force: false,
    mode: 'transcript',
    density: 'normal',
    excludedSigs: new Set(),
    excludedStars: new Set(),
    excludedTypes: new Set(),
    selectedId: null,
    collapsedGroups: DEFAULT_COLLAPSED_GROUPS,
    hiddenTracks: new Set(),
    userVariants: [],
    userVariantErrors: [],
    userVariantsRaw: '',
    userVariantHgvsTokens: [],
  };
  if (typeof window === 'undefined') return fallback;
  const p = new URLSearchParams(window.location.search);
  const csv = (key: string) =>
    (p.get(key) ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const modeRaw = p.get('mode');
  const mode: ViewMode =
    modeRaw === 'genome' || modeRaw === 'protein' || modeRaw === 'transcript'
      ? modeRaw
      : fallback.mode;
  const densityRaw = p.get('density');
  const density: Density =
    densityRaw === 'compact' || densityRaw === 'roomy' || densityRaw === 'normal'
      ? densityRaw
      : fallback.density;
  const collapsedRaw = p.get('collapsed');
  return {
    requestedId: p.get('transcript')?.trim() || null,
    force: p.get('force') === '1' || p.get('force') === 'true',
    mode,
    density,
    excludedSigs: new Set(
      csv('excluded').filter((s) =>
        SIGNIFICANCE_VALUES.has(s),
      ) as ClinVarSignificance[],
    ),
    excludedStars: new Set(
      csv('excludedStars')
        .map((s) => Number(s))
        .filter((n): n is StarLevel => STAR_LEVELS.includes(n as StarLevel)),
    ),
    excludedTypes: new Set(
      csv('excludedTypes').filter((s) =>
        VARIANT_TYPE_VALUES.has(s),
      ) as VariantType[],
    ),
    selectedId: p.get('selected') || null,
    // `collapsed` overrides the default-collapsed set when present (so
    // `?collapsed=` is "everything open"); absent param keeps the default
    // (ClinVar group + all per-sig subgroups collapsed).
    collapsedGroups:
      collapsedRaw === null
        ? DEFAULT_COLLAPSED_GROUPS
        : new Set(csv('collapsed')),
    hiddenTracks: new Set(
      csv('hide').filter((s): s is TrackToggleId => TRACK_TOGGLE_IDS.has(s)),
    ),
    ...parseUserVariantsParam(p.get('variants') ?? ''),
  };
}

/** Module-level cache for VariantValidator resolutions, keyed by
 *  transcript id → (raw HGVS, lowercased) → resolved variant. Lives
 *  outside the component so React's StrictMode double-mount doesn't
 *  double up the network calls; gets cleared per-transcript by the
 *  resolver so c./n. coord-space changes never reuse a stale entry. */
const hgvsCacheStore = new Map<string, Map<string, ParsedUserVariant>>();
function hgvsCacheFor(transcriptId: string): Map<string, ParsedUserVariant> {
  let m = hgvsCacheStore.get(transcriptId);
  if (!m) {
    m = new Map<string, ParsedUserVariant>();
    hgvsCacheStore.set(transcriptId, m);
  }
  return m;
}

/** Merge a newly-resolved batch with the existing resolved list,
 *  deduping by canonical id so a paste like `c.524G>A` resolving to
 *  the same coords as `17-7674212-C-T` only renders one mark. */
function mergeResolved(
  prev: readonly ParsedUserVariant[],
  next: readonly ParsedUserVariant[],
): ParsedUserVariant[] {
  const out = [...prev];
  const seen = new Set(out.map((v) => v.id));
  for (const v of next) {
    if (seen.has(v.id)) continue;
    seen.add(v.id);
    out.push(v);
  }
  return out;
}

function parseUserVariantsParam(
  raw: string,
): Pick<
  UrlState,
  'userVariants' | 'userVariantErrors' | 'userVariantsRaw' | 'userVariantHgvsTokens'
> {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      userVariants: [],
      userVariantErrors: [],
      userVariantsRaw: '',
      userVariantHgvsTokens: [],
    };
  }
  const { parsed, hgvsTokens, errors } = parseUserVariants(trimmed);
  return {
    userVariants: parsed,
    userVariantErrors: errors,
    userVariantsRaw: trimmed,
    userVariantHgvsTokens: hgvsTokens,
  };
}

function sameSet<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function csvSorted<T>(s: ReadonlySet<T>, cmp?: (a: T, b: T) => number): string {
  return [...s].sort(cmp).join(',');
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
