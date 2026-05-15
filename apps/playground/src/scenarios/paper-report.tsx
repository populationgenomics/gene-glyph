import { GeneGlyph } from '@populationgenomics/gene-glyph';
import { TP53_PROTEIN, TP53_TRANSCRIPT } from '../fixtures/tp53.js';

/**
 * Paper-report scenario — mirrors lit-manager's current usage on the reports
 * page. Renders the TP53 schematic at fit-gene zoom using the default exon
 * track. Variants, Pfam, and InterPro overlays land in later slices.
 */
export function PaperReportScenario() {
  return (
    <section className="scenario" aria-labelledby="scenario-paper-report">
      <h2 id="scenario-paper-report">Paper report — TP53</h2>
      <p className="scenario-blurb">
        Single transcript, exon track only. Slice 3 acceptance bar: a
        recognisable gene schematic at fit-gene zoom with collapsed introns.
      </p>
      <GeneGlyph transcript={TP53_TRANSCRIPT} protein={TP53_PROTEIN} />
    </section>
  );
}
