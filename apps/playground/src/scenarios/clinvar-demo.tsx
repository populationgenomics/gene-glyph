import { useCallback, useMemo, useRef, useState } from 'react';
import {
  DefaultTrackChevron,
  GeneGlyph,
  clinVarSummaryTrack,
  clinVarTrack,
  exonTrack,
  pfamTrack,
} from '@populationgenomics/gene-glyph';
import type {
  ClinVarRecord,
  ClinVarSignificance,
  GeneGlyphRef,
  GutterItem,
  TooltipRenderArgs,
  TrackOrGroup,
} from '@populationgenomics/gene-glyph';
import { TP53_PROTEIN, TP53_TRANSCRIPT } from '../fixtures/tp53.js';
import { TP53_CLINVAR } from '../fixtures/tp53-clinvar.js';

/**
 * Slice 21 — ClinVar density-clustered track.
 *
 * At fit-gene zoom the TP53 hotspot variants (R175H / R248Q / R273H / R282W
 * cluster within a handful of base pairs and collapse into single cluster
 * marks; zooming into the DNA-binding domain breaks them apart. A click on
 * a cluster opens an in-figure popover listing the members, each row
 * clickable to fire the host's `onFeatureClick`. Singleton marks fire
 * `onFeatureClick` directly. Colour encodes the strongest clinical
 * significance present in the cluster.
 *
 * The fixture is a curated slice of real ClinVar records so the scenario
 * stays offline for e2e; production hosts wire `createClinVarDataSource`
 * instead.
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

export function ClinVarDemoScenario() {
  const [lastClicked, setLastClicked] = useState<string | null>(null);
  // Host-owned filter state. Empty set = no filter (all significances).
  const [excluded, setExcluded] = useState<ReadonlySet<ClinVarSignificance>>(() => new Set());
  // Folded-group state. RD-1110 starts the ClinVar group expanded in this
  // offline scenario so the docs example shows the detail render by
  // default; clicking the chevron swaps in the density heat-strip
  // summary.
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const viewerRef = useRef<GeneGlyphRef | null>(null);

  // Stable predicate reference so the gene-glyph filter memo doesn't churn
  // on every render — the function identity changes only when `excluded`
  // does, which is the signal we want the viewer to react to.
  const filter = useCallback(
    (r: ClinVarRecord) => !excluded.has(r.significance),
    [excluded],
  );

  const tracks = useMemo<TrackOrGroup[]>(
    () => [
      exonTrack({}),
      pfamTrack({}),
      {
        kind: 'group',
        id: CLINVAR_GROUP_ID,
        label: 'ClinVar',
        tracks: [clinVarTrack({ id: 'clinvar', source: TP53_CLINVAR, filter })],
        summaryTrack: clinVarSummaryTrack({
          id: 'clinvar-summary',
          source: TP53_CLINVAR,
          filter,
        }),
      },
    ],
    [filter],
  );

  const toggleExcluded = (sig: ClinVarSignificance) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(sig)) next.delete(sig);
      else next.add(sig);
      return next;
    });
  };

  const renderTooltip = (args: TooltipRenderArgs) => {
    if (args.trackId !== 'clinvar') return null;
    const r = args.feature as ClinVarRecord | null;
    if (!r) return null;
    return (
      <div>
        <div style={{ fontWeight: 600 }}>{r.label}</div>
        <div style={{ opacity: 0.75, fontSize: '0.72rem' }}>
          {r.reviewStatus ?? humanSig(r.significance)}
        </div>
        {r.condition && (
          <div style={{ opacity: 0.6, fontSize: '0.7rem' }}>{r.condition}</div>
        )}
      </div>
    );
  };

  return (
    <section className="scenario" aria-labelledby="scenario-clinvar">
      <h2 id="scenario-clinvar">ClinVar — density clustering and cluster popover</h2>
      <p className="scenario-blurb">
        Click a diamond to expand the cluster into its member variants. Zoom in
        (<code>=</code>) on the DNA-binding domain and the clusters dissolve as
        the per-pixel spacing grows past the cluster threshold. Marks colour by
        the strongest clinical significance present. Toggle the significance
        chips to narrow the visible record set — the track re-clusters against
        the survivors via the host-supplied <code>filter</code> predicate.
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
        <span data-testid="clinvar-last-clicked" style={{ fontVariantNumeric: 'tabular-nums' }}>
          last clicked: <strong>{lastClicked ?? '—'}</strong>
        </span>
        <div
          data-testid="clinvar-significance-filter"
          style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}
        >
          <span style={{ opacity: 0.75 }}>significance:</span>
          {SIGNIFICANCE_CHIPS.map((sig) => {
            const active = !excluded.has(sig);
            return (
              <button
                key={sig}
                type="button"
                data-testid={`clinvar-chip-${sig}`}
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
      </div>
      <GeneGlyph
        ref={viewerRef}
        transcript={TP53_TRANSCRIPT}
        protein={TP53_PROTEIN}
        tracks={tracks}
        trackHeightBudget={220}
        collapsedGroupIds={collapsedGroups}
        onCollapsedGroupChange={setCollapsedGroups}
        renderTooltip={renderTooltip}
        onFeatureClick={(featureId: string, trackId: string) => {
          if (trackId === 'clinvar') setLastClicked(featureId);
        }}
      >
        <GeneGlyph.LeftGutter width={120}>
          {(item: GutterItem) => {
            if (item.kind === 'group' && item.id === CLINVAR_GROUP_ID) {
              return (
                <span style={{ alignSelf: 'flex-start', paddingTop: 1 }}>
                  <DefaultTrackChevron
                    item={item}
                    collapsed={collapsedGroups.has(item.id)}
                    onToggle={() => viewerRef.current?.toggleGroup(item.id)}
                  />
                </span>
              );
            }
            return null;
          }}
        </GeneGlyph.LeftGutter>
      </GeneGlyph>
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
