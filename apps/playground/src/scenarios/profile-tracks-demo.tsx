import { useRef, useState } from 'react';
import {
  GeneGlyph,
  exonTrack,
  profileTrack,
  scaleTrack,
  variantTrack,
} from '@populationgenomics/gene-glyph';
import type { GeneGlyphRef, ViewMode } from '@populationgenomics/gene-glyph';
import { TP53_PROTEIN, TP53_TRANSCRIPT, TP53_VARIANTS } from '../fixtures/tp53.js';
import { TP53_CONSERVATION, TP53_MISSENSE_DENSITY } from '../fixtures/tp53-profile.js';

/**
 * Slice 31 — numeric profile tracks. Two visuals from one factory:
 *
 *   1. **Conservation heatmap** — per-aa PhyloP-style scores (a
 *      smoothed proxy fixture), rendered as a viridis colour band.
 *      Bright streaks at codons 175 / 248 / 273 match the ClinVar
 *      hotspots above.
 *   2. **Missense density histogram** — per-aa missense-variant
 *      counts derived from the dense TP53 fixture, rendered as an
 *      area-fill. The silhouette shows where in p53 our synthetic
 *      population data clusters.
 *
 * The two tracks share `profileTrack`; only the `render` discriminator
 * (and aggregator defaults) differs.
 */
export function ProfileTracksScenario() {
  const ref = useRef<GeneGlyphRef | null>(null);
  const [mode, setMode] = useState<ViewMode>('protein');

  return (
    <section className="scenario" aria-labelledby="scenario-profile">
      <h2 id="scenario-profile">Conservation + missense density — TP53</h2>
      <p className="scenario-blurb">
        Two profile tracks driven by the same <code>profileTrack</code>{' '}
        factory. The heatmap is per-aa conservation; the histogram is
        per-aa missense variant density. Both aggregate by display
        pixel so the silhouette stays faithful at every zoom level.
      </p>
      <div
        role="group"
        aria-label="Profile-track controls"
        style={{ display: 'inline-flex', gap: 8, alignItems: 'center', marginBottom: 8 }}
      >
        <label style={{ fontSize: '0.85rem', color: '#475569' }}>
          Mode{' '}
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as ViewMode)}
            data-testid="profile-mode"
            style={{ font: 'inherit', padding: '2px 6px' }}
          >
            <option value="protein">Protein</option>
            <option value="genome">Genome</option>
            <option value="transcript">Transcript</option>
          </select>
        </label>
        <button
          type="button"
          data-testid="profile-fit-gene"
          onClick={() => ref.current?.fitTo({ kind: 'gene' })}
        >
          Fit gene
        </button>
        <button
          type="button"
          data-testid="profile-zoom-dbd"
          onClick={() =>
            ref.current?.fitTo({
              kind: 'range',
              range: mode === 'protein' ? [100, 300] : [298, 900],
            })
          }
          title="Zoom to the DNA-binding domain"
        >
          Zoom DBD
        </button>
      </div>
      <GeneGlyph
        ref={ref}
        transcript={TP53_TRANSCRIPT}
        protein={TP53_PROTEIN}
        mode={mode}
        tracks={[
          scaleTrack({}),
          exonTrack({}),
          variantTrack({ id: 'variants', source: TP53_VARIANTS }),
          profileTrack({
            id: 'conservation',
            source: TP53_CONSERVATION,
            coordSystem: 'protein',
            render: 'heatmap',
            heightPx: 18,
            yScale: { domain: [0, 1] },
          }),
          profileTrack({
            id: 'missense-density',
            source: TP53_MISSENSE_DENSITY,
            coordSystem: 'protein',
            render: 'histogram',
            heightPx: 36,
            length: TP53_PROTEIN.length,
            histogramFill: '#0ea5e9',
          }),
        ]}
        trackHeightBudget={260}
      />
    </section>
  );
}
