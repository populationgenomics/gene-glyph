import { useRef, useState } from 'react';
import {
  GeneGlyph,
  exonTrack,
  scaleTrack,
  segmentBandTrack,
} from '@populationgenomics/gene-glyph';
import type { GeneGlyphRef, ViewMode } from '@populationgenomics/gene-glyph';
import { TP53_PROTEIN, TP53_TRANSCRIPT } from '../fixtures/tp53.js';

/**
 * Slice 30 — `segmentBandTrack` demos. Three scenarios drive the same
 * factory:
 *   1. **NMD escape** — boolean per exon. Categorical with two values.
 *   2. **Regional Missense Constraint** — four-way categorical along
 *      the protein, synthesised so the high-constraint stretch
 *      overlaps the TP53 DNA-binding domain.
 *   3. **Secondary structure** — three-way (helix / sheet / loop) run-
 *      length encoding sized to the protein.
 *
 * All three share one factory + one render path; only the palette and
 * source data differ.
 */
type NmdCategory = 'escape' | 'sensitive';
type RmcCategory =
  | 'intol-1'
  | 'intol-2'
  | 'intol-3'
  | 'intol-4'
  | 'intol-5'
  | 'not-significant';
type SsCategory = 'helix' | 'sheet' | 'loop';

const NMD_PALETTE: Record<NmdCategory, string> = {
  escape: '#facc15',
  sensitive: '#94a3b8',
};

// Six-bin RMC palette — matches the gnomAD intolerance tiers (Slice 40).
const RMC_PALETTE: Record<RmcCategory, string> = {
  'intol-1': '#b91c1c',
  'intol-2': '#f97316',
  'intol-3': '#facc15',
  'intol-4': '#a3e635',
  'intol-5': '#bbf7d0',
  'not-significant': '#e2e8f0',
};

const SS_PALETTE: Record<SsCategory, string> = {
  helix: '#ef4444',
  sheet: '#f59e0b',
  loop: '#cbd5e1',
};

// NMD escape: last exon and (per the 50-nt rule) the penultimate
// downstream of any premature stops are NMD-escape territory. Encode
// the TP53 exons accordingly — exons 10 and 11 escape, the rest are
// sensitive. cdsStart/cdsEnd are 1-indexed inclusive CDS bp.
const NMD_DATA = TP53_TRANSCRIPT.exons.map((e, i, all) => ({
  id: `nmd-exon-${e.number}`,
  start: e.cdsStart,
  end: e.cdsEnd,
  category: (i >= all.length - 2 ? 'escape' : 'sensitive') as NmdCategory,
  label: `Exon ${e.number}`,
}));

// Synthesised RMC bins along the TP53 protein (393 aa). The intolerant
// stretch (94-312) covers the Pfam DBD; flanks are increasingly
// tolerant. Uses the six-bin palette that gnomAD's RMC strip would
// surface for a constraint-rich gene (Slice 40).
const RMC_DATA = [
  { id: 'rmc-nter', start: 1, end: 93, category: 'intol-4' as const, label: 'N-term' },
  { id: 'rmc-dbd', start: 94, end: 312, category: 'intol-1' as const, label: 'DBD' },
  { id: 'rmc-tet', start: 313, end: 356, category: 'intol-3' as const, label: 'Tetramer' },
  {
    id: 'rmc-cterm',
    start: 357,
    end: TP53_PROTEIN.length,
    category: 'not-significant' as const,
    label: 'C-term',
  },
];

// Synthetic DSSP-style secondary structure runs. Coarsened by hand —
// enough variety to read as three categories without needing the real
// DSSP fixture in the playground.
const SS_DATA = [
  { start: 1, end: 25, category: 'loop' as const },
  { start: 26, end: 60, category: 'helix' as const },
  { start: 61, end: 90, category: 'loop' as const },
  { start: 91, end: 110, category: 'sheet' as const },
  { start: 111, end: 140, category: 'helix' as const },
  { start: 141, end: 175, category: 'sheet' as const },
  { start: 176, end: 220, category: 'helix' as const },
  { start: 221, end: 260, category: 'sheet' as const },
  { start: 261, end: 290, category: 'loop' as const },
  { start: 291, end: 320, category: 'helix' as const },
  { start: 321, end: 360, category: 'helix' as const },
  { start: 361, end: TP53_PROTEIN.length, category: 'loop' as const },
];

export function SegmentBandDemoScenario() {
  const ref = useRef<GeneGlyphRef | null>(null);
  const [mode, setMode] = useState<ViewMode>('protein');
  return (
    <section className="scenario" aria-labelledby="scenario-segment-band">
      <h2 id="scenario-segment-band">Segment band track — TP53</h2>
      <p className="scenario-blurb">
        One factory, three palettes. The NMD-escape strip uses CDS coords;
        the Regional Missense Constraint and secondary-structure strips
        sit on the protein axis. All three stay aligned under mode
        changes, pan, and zoom.
      </p>
      <div
        role="group"
        aria-label="Segment band controls"
        style={{ display: 'inline-flex', gap: 8, alignItems: 'center', marginBottom: 8 }}
      >
        <label style={{ fontSize: '0.85rem', color: '#475569' }}>
          Mode{' '}
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as ViewMode)}
            data-testid="segment-band-mode"
            style={{ font: 'inherit', padding: '2px 6px' }}
          >
            <option value="protein">Protein</option>
            <option value="transcript">Transcript</option>
            <option value="genome">Genome</option>
          </select>
        </label>
        <button
          type="button"
          data-testid="segment-band-fit-gene"
          onClick={() => ref.current?.fitTo({ kind: 'gene' })}
        >
          Fit gene
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
          segmentBandTrack({
            id: 'nmd-escape',
            source: NMD_DATA,
            coordSystem: 'cds',
            palette: NMD_PALETTE,
            showLabels: true,
            minLabelWidthPx: 36,
            gapAbove: 8,
            heightPx: 14,
          }),
          segmentBandTrack({
            id: 'rmc',
            source: RMC_DATA,
            coordSystem: 'protein',
            palette: RMC_PALETTE,
            showLabels: true,
            minLabelWidthPx: 36,
            gapAbove: 4,
            heightPx: 14,
          }),
          segmentBandTrack({
            id: 'secondary-structure',
            source: SS_DATA,
            coordSystem: 'protein',
            palette: SS_PALETTE,
            gapAbove: 4,
            heightPx: 10,
          }),
        ]}
        trackHeightBudget={260}
      />
    </section>
  );
}
