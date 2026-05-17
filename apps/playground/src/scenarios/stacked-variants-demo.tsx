import { useMemo, useState } from 'react';
import {
  GeneGlyph,
  defaultClinVarSymbolEncoding,
  defaultVariantSymbolEncoding,
  clinVarTrack,
  exonTrack,
  pfamTrack,
  variantTrack,
} from '@populationgenomics/gene-glyph';
import { TP53_DENSE_VARIANTS } from '../fixtures/tp53-dense.js';
import { TP53_CLINVAR } from '../fixtures/tp53-clinvar.js';
import { TP53_PROTEIN, TP53_TRANSCRIPT } from '../fixtures/tp53.js';

/**
 * Slice 27 — stacked variant view (Decipher-style).
 *
 * Side-by-side comparison of the same data rendered in both styles. The
 * default tick+dot row above; the stacked-glyph column below. The dense
 * fixture (60+ variants, hotspot piles around codons 175 / 248 / 273) lets
 * the user see how three orthogonal attribute axes — shape × fill × lane —
 * carry information without per-glyph legend lookups.
 */
export function StackedVariantsDemoScenario() {
  const [variant, setVariant] = useState<string | null>(null);

  const tracksClassic = useMemo(
    () => [
      exonTrack({}),
      variantTrack({ id: 'variants-classic', source: TP53_DENSE_VARIANTS }),
      pfamTrack({}),
    ],
    [],
  );

  const tracksStacked = useMemo(
    () => [
      exonTrack({}),
      variantTrack({
        id: 'variants-stacked',
        source: TP53_DENSE_VARIANTS,
        stackedVariantStyle: defaultVariantSymbolEncoding,
      }),
      pfamTrack({}),
    ],
    [],
  );

  const tracksClinVarStacked = useMemo(
    () => [
      exonTrack({}),
      clinVarTrack({
        id: 'clinvar-stacked',
        source: TP53_CLINVAR,
        stackedVariantStyle: defaultClinVarSymbolEncoding,
      }),
    ],
    [],
  );

  return (
    <section className="scenario" aria-labelledby="scenario-stacked-variants">
      <h2 id="scenario-stacked-variants">Stacked variant view — Decipher-style</h2>
      <p className="scenario-blurb">
        Same data, two render styles. The classic tick+dot row hides variant
        depth at hotspot codons; the stacked column shows each variant as its
        own glyph with shape × fill × lane encoding category, predicted
        effect, and lane group. Track height grows to fit the deepest stack.
      </p>
      <div
        style={{
          display: 'flex',
          gap: 16,
          alignItems: 'center',
          marginBottom: 8,
          fontSize: '0.85rem',
          color: '#475569',
        }}
      >
        <span
          data-testid="stacked-last-clicked"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          last clicked: <strong>{variant ?? '—'}</strong>
        </span>
      </div>
      <div data-testid="stacked-side-classic" style={{ marginBottom: 16 }}>
        <h3 style={{ margin: '4px 0', fontSize: '0.9rem' }}>tick + dot</h3>
        <GeneGlyph
          transcript={TP53_TRANSCRIPT}
          protein={TP53_PROTEIN}
          tracks={tracksClassic}
          trackHeightBudget={260}
          onFeatureClick={(featureId) => setVariant(featureId)}
        />
      </div>
      <div data-testid="stacked-side-stacked">
        <h3 style={{ margin: '4px 0', fontSize: '0.9rem' }}>stacked glyph</h3>
        <GeneGlyph
          transcript={TP53_TRANSCRIPT}
          protein={TP53_PROTEIN}
          tracks={tracksStacked}
          trackHeightBudget={260}
          onFeatureClick={(featureId) => setVariant(featureId)}
        />
      </div>
      <h3 style={{ marginTop: 24, fontSize: '0.9rem' }}>ClinVar in stacked mode</h3>
      <p
        className="scenario-blurb"
        style={{ marginTop: 0 }}
      >
        Stacking suppresses ClinVar's density clustering — every record gets
        its own glyph. Shape encodes clinical significance (diamond
        pathogenic, circle benign, pentagon conflicting, …).
      </p>
      <GeneGlyph
        transcript={TP53_TRANSCRIPT}
        protein={TP53_PROTEIN}
        tracks={tracksClinVarStacked}
        trackHeightBudget={180}
        onFeatureClick={(featureId) => setVariant(featureId)}
      />
    </section>
  );
}
