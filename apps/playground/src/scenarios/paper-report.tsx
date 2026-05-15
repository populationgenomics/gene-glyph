import { useState } from 'react';
import { GeneGlyph, exonTrack, variantTrack } from '@populationgenomics/gene-glyph';
import { TP53_PROTEIN, TP53_TRANSCRIPT, TP53_VARIANTS } from '../fixtures/tp53.js';

/**
 * Paper-report scenario — mirrors lit-manager's current usage on the reports
 * page. Slice 4 extends Slice 3 with a variant track wired into controlled
 * `hoveredFeatureId` / `selectedFeatureIds` props. The host-side table on the
 * right exercises the same controlled-prop hover lift that lit-manager will
 * drive from its results table.
 */
export function PaperReportScenario() {
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <section className="scenario" aria-labelledby="scenario-paper-report">
      <h2 id="scenario-paper-report">Paper report — TP53</h2>
      <p className="scenario-blurb">
        Slice 4 acceptance bar: variants render at correct positions, hover on
        a row lifts the matching tick (controlled prop), click toggles
        selection (ring), and variants that don&apos;t project (intronic
        offsets, out-of-bounds) appear in the unplaced row below the figure.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 24, alignItems: 'start' }}>
        <GeneGlyph
          transcript={TP53_TRANSCRIPT}
          protein={TP53_PROTEIN}
          tracks={[exonTrack({}), variantTrack({ source: TP53_VARIANTS })]}
          trackHeightBudget={120}
          hoveredFeatureId={hovered}
          selectedFeatureIds={selected}
          onHover={(featureId) => setHovered(featureId)}
          onFeatureClick={(featureId) => toggleSelected(featureId)}
        />
        <VariantTable
          variants={TP53_VARIANTS}
          hovered={hovered}
          selected={selected}
          onHover={setHovered}
          onClick={toggleSelected}
        />
      </div>
    </section>
  );
}

interface VariantTableProps {
  variants: typeof TP53_VARIANTS;
  hovered: string | null;
  selected: ReadonlySet<string>;
  onHover: (id: string | null) => void;
  onClick: (id: string) => void;
}

function VariantTable({ variants, hovered, selected, onHover, onClick }: VariantTableProps) {
  return (
    <table
      style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: '0.85rem',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <thead>
        <tr style={{ textAlign: 'left', borderBottom: '1px solid #cbd5e1' }}>
          <th style={{ padding: '4px 8px' }}>Variant</th>
          <th style={{ padding: '4px 8px' }}>Category</th>
        </tr>
      </thead>
      <tbody>
        {variants.map((v) => {
          const isHovered = hovered === v.id;
          const isSelected = selected.has(v.id);
          return (
            <tr
              key={v.id}
              onMouseEnter={() => onHover(v.id)}
              onMouseLeave={() => onHover(null)}
              onClick={() => onClick(v.id)}
              style={{
                background: isHovered
                  ? '#e2e8f0'
                  : isSelected
                  ? '#f1f5f9'
                  : 'transparent',
                cursor: 'pointer',
                borderBottom: '1px solid #e2e8f0',
              }}
            >
              <td style={{ padding: '4px 8px', fontFamily: 'ui-monospace, monospace' }}>
                {v.label}
              </td>
              <td style={{ padding: '4px 8px', color: '#475569' }}>{v.category}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
