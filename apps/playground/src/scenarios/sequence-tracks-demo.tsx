import { useRef, useState } from 'react';
import {
  GeneGlyph,
  aaTrack,
  exonTrack,
  nucleotideTrack,
  scaleTrack,
  variantTrack,
} from '@populationgenomics/gene-glyph';
import type { GeneGlyphRef, ViewMode } from '@populationgenomics/gene-glyph';
import { TP53_PROTEIN, TP53_TRANSCRIPT, TP53_VARIANTS } from '../fixtures/tp53.js';
import {
  TP53_CDS,
  TP53_HOTSPOT_CODONS,
  TP53_PROTEIN_SEQ,
} from '../fixtures/tp53-sequence.js';

/**
 * Slice 29 — zoom-gated nucleotide + amino-acid sequence tracks.
 *
 * At fit-gene zoom the sequence rows contribute zero height (the
 * letters would render at sub-pixel widths and be unreadable). Click
 * one of the hotspot buttons to zoom to a TP53 cancer-hotspot codon;
 * once the per-bp / per-aa width crosses the readability threshold,
 * both tracks unfurl and one glyph appears under every visible bp /
 * codon. The aa letters sit at the centre bp of their codon, so the
 * stack reads as a sequence ladder lining up with the ClinVar
 * lollipops above.
 */
export function SequenceTracksScenario() {
  const ref = useRef<GeneGlyphRef | null>(null);
  const [mode, setMode] = useState<ViewMode>('cds-with-introns');

  const zoomToCodon = (aa: number, padBp = 12) => {
    const center = (aa - 1) * 3 + 2;
    if (mode === 'protein') {
      const padAa = Math.max(2, Math.round(padBp / 3));
      ref.current?.fitTo({ kind: 'range', range: [aa - padAa, aa + padAa] });
    } else {
      ref.current?.fitTo({ kind: 'range', range: [center - padBp, center + padBp] });
    }
  };

  return (
    <section className="scenario" aria-labelledby="scenario-sequence">
      <h2 id="scenario-sequence">Sequence ladder — TP53 hotspots</h2>
      <p className="scenario-blurb">
        Nucleotide + amino-acid letters appear under the exon ribbon
        once zoom crosses the readability threshold (~8 px/bp,
        ~14 px/aa). Click a hotspot to zoom in on a known TP53
        cancer-driver codon.
      </p>
      <div
        role="group"
        aria-label="Sequence-track controls"
        style={{ display: 'inline-flex', gap: 8, alignItems: 'center', marginBottom: 8 }}
      >
        <label style={{ fontSize: '0.85rem', color: '#475569' }}>
          Mode{' '}
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as ViewMode)}
            data-testid="sequence-mode"
            style={{ font: 'inherit', padding: '2px 6px' }}
          >
            <option value="cds-with-introns">CDS with introns</option>
            <option value="cds-spliced">Spliced CDS</option>
            <option value="protein">Protein</option>
          </select>
        </label>
        <button
          type="button"
          data-testid="fit-gene"
          onClick={() => ref.current?.fitTo({ kind: 'gene' })}
        >
          Fit gene
        </button>
        {TP53_HOTSPOT_CODONS.map(({ aa, residue }) => (
          <button
            key={aa}
            type="button"
            data-testid={`zoom-codon-${aa}`}
            onClick={() => zoomToCodon(aa)}
            title={`Zoom to ${residue}${aa}`}
          >
            {residue}
            {aa}
          </button>
        ))}
      </div>
      <GeneGlyph
        ref={ref}
        transcript={TP53_TRANSCRIPT}
        protein={TP53_PROTEIN}
        mode={mode}
        tracks={[
          scaleTrack({}),
          exonTrack({}),
          nucleotideTrack({ source: TP53_CDS }),
          aaTrack({ proteinSource: TP53_PROTEIN_SEQ }),
          variantTrack({ id: 'variants', source: TP53_VARIANTS }),
        ]}
        trackHeightBudget={260}
      />
    </section>
  );
}
