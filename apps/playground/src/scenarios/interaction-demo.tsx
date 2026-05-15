import { useEffect, useRef, useState } from 'react';
import {
  GeneGlyph,
  exonTrack,
  interProTrack,
  variantTrack,
} from '@populationgenomics/gene-glyph';
import type {
  GeneGlyphRef,
  InteractionMode,
  ViewMode,
  ViewportChangeReason,
  ViewportInfo,
} from '@populationgenomics/gene-glyph';
import { TP53_PROTEIN, TP53_TRANSCRIPT, TP53_VARIANTS } from '../fixtures/tp53.js';

/**
 * Slice 9 — default pan / zoom / keyboard bindings.
 *
 * Demonstrates every gesture from design §7:
 *   • drag-to-pan
 *   • wheel = horizontal pan (falls through at the limit)
 *   • Cmd/Ctrl + wheel or pinch = cursor-anchored zoom
 *   • keyboard `+ -` zoom, `← →` pan, `1` fit-gene, `f` fit feature
 *
 * Toggles between `interactionMode` profiles and exposes a controlled-vs-
 * uncontrolled switch so reviewers can verify the controlled-prop path fires
 * `onViewportChange` and respects host-supplied range.
 */
export function InteractionDemoScenario() {
  const ref = useRef<GeneGlyphRef | null>(null);
  const [mode] = useState<ViewMode>('cds-with-introns');
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('standard');
  const [controlled, setControlled] = useState(false);
  const [range, setRange] = useState<readonly [number, number]>([1, TP53_TRANSCRIPT.cdsLength]);
  const [lastReason, setLastReason] = useState<ViewportChangeReason | null>(null);
  const [info, setInfo] = useState<ViewportInfo | null>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (ref.current) setInfo(ref.current.getViewportInfo());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <section className="scenario" aria-labelledby="scenario-interactions">
      <h2 id="scenario-interactions">Pan, zoom & keyboard — TP53</h2>
      <p className="scenario-blurb">
        Click the figure to focus it, then drag, wheel, pinch, or use{' '}
        <code>+ − ← → 1 f</code>. Cmd/Ctrl + wheel zooms on the cursor.
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
        <label>
          Interaction mode{' '}
          <select
            value={interactionMode}
            onChange={(e) => setInteractionMode(e.target.value as InteractionMode)}
          >
            <option value="standard">standard</option>
            <option value="embed">embed (no wheel-zoom)</option>
            <option value="fullscreen">fullscreen</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={controlled}
            onChange={(e) => setControlled(e.target.checked)}
          />{' '}
          Controlled <code>viewportRange</code>
        </label>
        {info && (
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            range [{info.range[0].toFixed(0)}–{info.range[1].toFixed(0)}] · zoom{' '}
            {info.zoom.toFixed(2)}×
          </span>
        )}
        {lastReason && <span>last: {lastReason}</span>}
      </div>
      <GeneGlyph
        ref={ref}
        transcript={TP53_TRANSCRIPT}
        protein={TP53_PROTEIN}
        mode={mode}
        interactionMode={interactionMode}
        viewportRange={controlled ? range : undefined}
        defaultViewportRange={undefined}
        onViewportChange={(r, reason) => {
          setLastReason(reason);
          if (controlled) setRange([r[0], r[1]]);
        }}
        tracks={[
          exonTrack({}),
          variantTrack({ id: 'variants', source: TP53_VARIANTS }),
          interProTrack({}),
        ]}
        trackHeightBudget={220}
      />
    </section>
  );
}
