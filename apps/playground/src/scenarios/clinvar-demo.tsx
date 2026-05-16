import { useMemo, useState } from 'react';
import {
  GeneGlyph,
  clinVarTrack,
  exonTrack,
  pfamTrack,
} from '@populationgenomics/gene-glyph';
import type {
  ClinVarRecord,
  TooltipRenderArgs,
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
export function ClinVarDemoScenario() {
  const [lastClicked, setLastClicked] = useState<string | null>(null);

  const tracks = useMemo(
    () => [
      exonTrack({}),
      pfamTrack({}),
      clinVarTrack({ id: 'clinvar', source: TP53_CLINVAR }),
    ],
    [],
  );

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
        the strongest clinical significance present.
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
      </div>
      <GeneGlyph
        transcript={TP53_TRANSCRIPT}
        protein={TP53_PROTEIN}
        tracks={tracks}
        trackHeightBudget={220}
        renderTooltip={renderTooltip}
        onFeatureClick={(featureId: string, trackId: string) => {
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
