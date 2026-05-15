import { GeneGlyph, exonTrack, pfamTrack } from '@populationgenomics/gene-glyph';
import { TP53_PROTEIN, TP53_TRANSCRIPT } from '../fixtures/tp53.js';

/**
 * Pfam scenario — first slice to exercise range-projection-returns-segments.
 *
 * The TP53 P53 DNA-binding domain spans aa 94..312, which crosses several
 * exon boundaries on NM_000546.6. The track therefore renders one rounded
 * rectangle per intersected exon, joined by a thin linker drawn over the
 * dashed-gap polyline. The TAD domain at the N-terminus fits inside exon 2
 * (single segment) and the tetramerisation motif near the C-terminus spans
 * two exons. Together these exercise the single-segment, multi-segment, and
 * width-aware label-truncation paths in one figure.
 */
export function PfamDemoScenario() {
  return (
    <section className="scenario" aria-labelledby="scenario-pfam">
      <h2 id="scenario-pfam">Pfam — TP53</h2>
      <p className="scenario-blurb">
        Slice 5 acceptance bar: each Pfam domain renders as joined per-exon
        rectangles with a thin linker over each collapsed-intron gap; centred
        labels truncate to half-distance against their neighbours so they
        never bleed into adjacent labels.
      </p>
      <GeneGlyph
        transcript={TP53_TRANSCRIPT}
        protein={TP53_PROTEIN}
        tracks={[exonTrack({}), pfamTrack({})]}
        trackHeightBudget={120}
      />
    </section>
  );
}
