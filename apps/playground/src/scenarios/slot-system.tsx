import { useState } from 'react';
import {
  GeneGlyph,
  exonTrack,
  interProTrack,
  variantTrack,
} from '@populationgenomics/gene-glyph';
import type { GutterItem, ViewMode } from '@populationgenomics/gene-glyph';
import { TP53_PROTEIN, TP53_TRANSCRIPT, TP53_VARIANTS } from '../fixtures/tp53.js';

/**
 * Slot-system scenario — Slice 7 acceptance bar.
 *
 * Demonstrates all four compound-component slots together: a custom header
 * with a mode dropdown + zoom controls placeholder, a left-gutter group label,
 * a right-gutter truncation badge, and a footer with placeholder text. The
 * header dropdown and zoom buttons are inert in this slice (mode transitions
 * land in Slice 12; the imperative zoom API lands in Slice 8); they exist to
 * exercise slot layout reservation against real-shaped chrome.
 */
export function SlotSystemScenario() {
  const [mode, setMode] = useState<ViewMode>('cds-with-introns');

  return (
    <section className="scenario" aria-labelledby="scenario-slots">
      <h2 id="scenario-slots">Slot system — TP53</h2>
      <p className="scenario-blurb">
        Slice 7 acceptance bar: header, footer, and both gutters render as
        siblings of the figure SVG. The header dropdown / zoom controls and the
        right-gutter truncation badges are wired to live state but the
        viewport-mutating callbacks are still placeholders (they light up in
        slices 8 + 12).
      </p>
      <GeneGlyph
        transcript={TP53_TRANSCRIPT}
        protein={TP53_PROTEIN}
        tracks={[
          exonTrack({}),
          variantTrack({ source: TP53_VARIANTS }),
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
          <div role="group" aria-label="Zoom controls" style={{ display: 'inline-flex', gap: 4 }}>
            <button type="button" disabled title="Zoom out (Slice 8)">−</button>
            <button type="button" disabled title="Fit gene (Slice 8)">Fit</button>
            <button type="button" disabled title="Zoom in (Slice 8)">+</button>
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
