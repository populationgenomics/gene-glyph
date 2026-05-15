import { GeneGlyph, exonTrack, interProTrack } from '@populationgenomics/gene-glyph';
import type { GutterItem } from '@populationgenomics/gene-glyph';
import { TP53_PROTEIN, TP53_TRANSCRIPT } from '../fixtures/tp53.js';

/**
 * InterPro scenario — first slice that exercises track groups + lane packing
 * + the LeftGutter slot.
 *
 * The `interProTrack` factory returns a `TrackGroup` with one sub-track per
 * entry-type (family, domain, repeat, homologous_superfamily). Each sub-track
 * lane-packs its visible domains, so the two overlapping TP53 family entries
 * (TAD + TAD2) stack into two rows while the single-record lanes collapse to
 * one. The `GeneGlyph.LeftGutter` render-prop receives an item per visible
 * track / group; here it surfaces the InterPro group label vertically centred
 * on the group's y-extent (the slice's stated visual treatment).
 */
export function InterProDemoScenario() {
  return (
    <section className="scenario" aria-labelledby="scenario-interpro">
      <h2 id="scenario-interpro">InterPro — TP53</h2>
      <p className="scenario-blurb">
        Slice 6 acceptance bar: InterPro lanes render at functional parity
        with lit-manager. The group label appears in the left gutter, vertically
        centred on the group&apos;s y-extent; overlapping family entries
        lane-pack into two rows without crashing labels.
      </p>
      <GeneGlyph
        transcript={TP53_TRANSCRIPT}
        protein={TP53_PROTEIN}
        tracks={[exonTrack({}), interProTrack({})]}
        trackHeightBudget={220}
      >
        <GeneGlyph.LeftGutter width={88}>
          {(item: GutterItem) => {
            // Only render the group label; the slice's stated visual is the
            // italic group label vertically centred on the group's y-extent.
            // Sub-track entry-type chrome lands when DefaultTrackChevron
            // arrives in slice 18 — until then we leave the lanes unlabelled
            // in the gutter so there's nothing for the group label to
            // collide with.
            if (item.kind !== 'group') return null;
            return (
              <span style={{ fontWeight: 600 }} title={item.label}>
                {item.label}
              </span>
            );
          }}
        </GeneGlyph.LeftGutter>
      </GeneGlyph>
    </section>
  );
}
