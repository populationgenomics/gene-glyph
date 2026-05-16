import { useEffect, useRef, useState } from 'react';
import {
  GeneGlyph,
  exonTrack,
  interProTrack,
  variantTrack,
} from '@populationgenomics/gene-glyph';
import type {
  GeneGlyphRef,
  GutterItem,
  ViewMode,
  ViewportInfo,
} from '@populationgenomics/gene-glyph';
import { TP53_PROTEIN, TP53_TRANSCRIPT, TP53_VARIANTS } from '../fixtures/tp53.js';

/**
 * Slot-system scenario — exercises every compound-component slot plus the
 * Slice 8 imperative-ref API and the Slice 14 mode transition.
 *
 * The header `<select>` is wired as a controlled `mode` prop; switching
 * cross-fades intron decorations and slides per-exon transforms onto the new
 * mode's baseline via the 450ms ease-in-out-quart curve in `styles.css`. The
 * zoom toolbar drives `fitTo` / `zoomBy` through a `GeneGlyphRef`; the
 * right-hand readout pulls live state from `getViewportInfo`.
 */
export function SlotSystemScenario() {
  const [mode, setMode] = useState<ViewMode>('cds-with-introns');
  const ref = useRef<GeneGlyphRef | null>(null);
  const [info, setInfo] = useState<ViewportInfo | null>(null);
  const [hiddenClick, setHiddenClick] = useState<{ trackId: string; featureId: string } | null>(
    null,
  );

  // The readout polls via rAF: `getViewportInfo()` returns the *interpolated*
  // range during a transition, so reading it immediately after each button
  // click would always lag one operation behind (t=0 of the new transition
  // equals the previous target). A 60Hz tick keeps the value synced and lets
  // the host see the same easing curve the user sees on screen.
  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      if (ref.current) setInfo(ref.current.getViewportInfo());
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const focusVariant = TP53_VARIANTS[0]?.id ?? null;
  const focusLabel = TP53_VARIANTS[0]?.label ?? null;

  return (
    <section className="scenario" aria-labelledby="scenario-slots">
      <h2 id="scenario-slots">Slot system — TP53</h2>
      <p className="scenario-blurb">
        Fit-gene, fit-variant, and zoom buttons drive the viewport via{' '}
        <code>GeneGlyphRef</code>; the right-hand readout pulls live state from{' '}
        <code>getViewportInfo()</code>. The mode dropdown is now live — switching
        cross-fades intron decorations and slides exons onto the new ruler.
      </p>
      <GeneGlyph
        ref={ref}
        transcript={TP53_TRANSCRIPT}
        protein={TP53_PROTEIN}
        tracks={[
          exonTrack({}),
          variantTrack({ id: 'variants', source: TP53_VARIANTS }),
          interProTrack({}),
        ]}
        trackHeightBudget={240}
        mode={mode}
        onFeatureClick={(featureId, trackId) => {
          if (featureId.startsWith('__hidden_intron_')) {
            setHiddenClick({ trackId, featureId });
          }
        }}
      >
        <GeneGlyph.Header height={36}>
          <label style={{ fontSize: '0.85rem', color: '#475569' }}>
            Mode{' '}
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as ViewMode)}
              style={{ font: 'inherit', padding: '2px 6px' }}
            >
              <option value="cds-with-introns">CDS with introns</option>
              <option value="cds-spliced">Spliced CDS</option>
              <option value="protein">Protein</option>
            </select>
          </label>
          <span style={{ flex: 1 }} />
          <div
            role="group"
            aria-label="Zoom controls"
            style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}
          >
            {info && (
              <span
                style={{
                  fontSize: '0.72rem',
                  color: '#64748b',
                  fontVariantNumeric: 'tabular-nums',
                  marginRight: 8,
                }}
                title={`Range ${info.range[0].toFixed(0)}–${info.range[1].toFixed(0)}`}
              >
                {info.zoom.toFixed(2)}×
              </span>
            )}
            <button
              type="button"
              title="Zoom out"
              onClick={() => {
                ref.current?.zoomBy(0.5);
              }}
            >
              −
            </button>
            <button
              type="button"
              title="Fit gene"
              onClick={() => {
                ref.current?.fitTo({ kind: 'gene' });
              }}
            >
              Fit
            </button>
            <button
              type="button"
              title={focusLabel ? `Fit ${focusLabel}` : 'No variant available'}
              disabled={!focusVariant}
              onClick={() => {
                if (!focusVariant) return;
                ref.current?.fitTo({
                  kind: 'feature',
                  trackId: 'variants',
                  featureId: focusVariant,
                });
              }}
            >
              Variant
            </button>
            <button
              type="button"
              title="Zoom in"
              onClick={() => {
                ref.current?.zoomBy(2);
              }}
            >
              +
            </button>
          </div>
        </GeneGlyph.Header>

        <GeneGlyph.LeftGutter width={96}>
          {(item: GutterItem) => {
            if (item.kind !== 'group') return null;
            return (
              <span style={{ fontWeight: 600 }} title={item.label}>
                {item.label}
              </span>
            );
          }}
        </GeneGlyph.LeftGutter>

        <GeneGlyph.RightGutter width={56}>
          {(item: GutterItem) => {
            if (!item.didTruncate || item.droppedCount <= 0) return null;
            return (
              <span
                title={`${item.droppedCount} item(s) dropped to fit`}
                style={{
                  display: 'inline-block',
                  padding: '0 6px',
                  borderRadius: 999,
                  background: '#fef3c7',
                  color: '#92400e',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                }}
              >
                +{item.droppedCount}
              </span>
            );
          }}
        </GeneGlyph.RightGutter>

        <GeneGlyph.Footer height={28}>
          <span>
            Placeholder footer — minimap lands in Slice 18; scale bar in a later
            slice.
          </span>
          {hiddenClick && (
            <span
              data-testid="hidden-click-readout"
              style={{
                marginLeft: 12,
                padding: '2px 8px',
                borderRadius: 999,
                background: '#fef3c7',
                color: '#92400e',
                fontSize: '0.72rem',
                fontWeight: 600,
              }}
            >
              Clicked {hiddenClick.featureId} on {hiddenClick.trackId}
            </span>
          )}
        </GeneGlyph.Footer>
      </GeneGlyph>
    </section>
  );
}
