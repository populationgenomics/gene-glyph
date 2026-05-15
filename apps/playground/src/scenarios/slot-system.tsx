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
 * Slice 8 imperative-ref API.
 *
 * The header dropdown is still inert pending Slice 12 (mode transitions); the
 * zoom toolbar now drives `fitTo` / `zoomBy` through a `GeneGlyphRef` and
 * shows a live readout from `getViewportInfo`. "Fit Variant" picks the first
 * hotspot variant from the fixture so the user can watch the viewport zoom
 * onto it.
 */
export function SlotSystemScenario() {
  const [mode, setMode] = useState<ViewMode>('cds-with-introns');
  const ref = useRef<GeneGlyphRef | null>(null);
  const [info, setInfo] = useState<ViewportInfo | null>(null);
  const refreshReadout = () => {
    if (ref.current) setInfo(ref.current.getViewportInfo());
  };
  useEffect(() => {
    refreshReadout();
  }, []);

  const focusVariant = TP53_VARIANTS[0]?.id ?? null;
  const focusLabel = TP53_VARIANTS[0]?.label ?? null;

  return (
    <section className="scenario" aria-labelledby="scenario-slots">
      <h2 id="scenario-slots">Slot system — TP53</h2>
      <p className="scenario-blurb">
        Slice 8 wires the toolbar through the imperative ref API. Fit-gene,
        fit-variant, and zoom buttons drive the viewport via{' '}
        <code>GeneGlyphRef</code>; the right-hand readout pulls live state from{' '}
        <code>getViewportInfo()</code>. The mode dropdown is still inert
        (animated mode transitions land in Slice 12).
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
                refreshReadout();
              }}
            >
              −
            </button>
            <button
              type="button"
              title="Fit gene"
              onClick={() => {
                ref.current?.fitTo({ kind: 'gene' });
                refreshReadout();
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
                refreshReadout();
              }}
            >
              Variant
            </button>
            <button
              type="button"
              title="Zoom in"
              onClick={() => {
                ref.current?.zoomBy(2);
                refreshReadout();
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
        </GeneGlyph.Footer>
      </GeneGlyph>
    </section>
  );
}
