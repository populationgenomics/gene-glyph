import { useState } from 'react';
import {
  GeneGlyph,
  exonTrack,
  interProTrack,
  pfamTrack,
  variantTrack,
} from '@populationgenomics/gene-glyph';
import type {
  ProteinDomain,
  TooltipRenderArgs,
  ViewerVariant,
} from '@populationgenomics/gene-glyph';
import { TP53_PROTEIN, TP53_TRANSCRIPT, TP53_VARIANTS } from '../fixtures/tp53.js';

/**
 * Slice 17 — overlay layer with default and host-supplied tooltips.
 *
 * Two viewers side-by-side:
 *   • Left: no `renderTooltip` — the viewer's built-in tooltip displays
 *     `Track.featureLabel` for variants and Pfam domains.
 *   • Right: custom `renderTooltip` that pulls richer detail off the resolved
 *     feature object (variant category, Pfam description).
 *
 * Both viewers prove the overlay layer is structurally outside the figure SVG
 * — exportSVG() (Slice 19) will never pull tooltip DOM into the serialised
 * output. ClinVar tooltips arrive automatically with Slice 21.
 */
export function TooltipDemoScenario() {
  const [showCustom, setShowCustom] = useState(true);

  const customRenderer = (args: TooltipRenderArgs) => {
    if (args.trackId === 'variants') {
      const v = args.feature as ViewerVariant | null;
      if (!v) return null;
      return (
        <div>
          <div style={{ fontWeight: 600 }}>{v.label}</div>
          <div style={{ opacity: 0.75, fontSize: '0.72rem' }}>{v.category}</div>
        </div>
      );
    }
    if (args.trackId === 'pfam' || args.trackId.startsWith('interpro')) {
      const d = args.feature as ProteinDomain | null;
      if (!d) return null;
      return (
        <div>
          <div style={{ fontWeight: 600 }}>{d.shortName}</div>
          <div style={{ opacity: 0.75, fontSize: '0.72rem' }}>{d.description}</div>
          <div style={{ opacity: 0.6, fontSize: '0.7rem' }}>
            {d.source} · aa {d.aaStart}–{d.aaEnd}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <section className="scenario" aria-labelledby="scenario-tooltips">
      <h2 id="scenario-tooltips">Overlay tooltips — TP53</h2>
      <p className="scenario-blurb">
        Hover a variant or domain to surface its tooltip. Toggle to compare the
        viewer's built-in label tooltip with a host-supplied{' '}
        <code>renderTooltip</code> that pulls richer detail from the resolved
        feature.
      </p>
      <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: '0.85rem' }}>
        <input
          type="checkbox"
          data-testid="tooltip-custom-toggle"
          checked={showCustom}
          onChange={(e) => setShowCustom(e.target.checked)}
        />
        Use host <code>renderTooltip</code>
      </label>
      <GeneGlyph
        transcript={TP53_TRANSCRIPT}
        protein={TP53_PROTEIN}
        tracks={[
          exonTrack({}),
          variantTrack({ id: 'variants', source: TP53_VARIANTS }),
          pfamTrack({ id: 'pfam' }),
          interProTrack({ id: 'interpro', groups: ['family', 'domain'] }),
        ]}
        trackHeightBudget={260}
        renderTooltip={showCustom ? customRenderer : undefined}
      />
    </section>
  );
}
