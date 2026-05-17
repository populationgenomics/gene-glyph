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
        InterPro lanes render in the <code>minimal</code> style by default —
        a thin coloured line per domain with end-cap ticks and a label
        left-aligned to the domain&apos;s start. Pfam stays rect-shaped, so
        InterPro reads as secondary annotation. The left gutter renders the
        nesting structure: the <em>InterPro</em> group label sits at the
        top of the group&apos;s y-extent, with the entry-type sub-track
        labels (Family, Domain, Repeat, Homologous SF) indented below.
        Overlapping family entries still lane-pack into two rows without
        crashing labels.
      </p>
      <GeneGlyph
        transcript={TP53_TRANSCRIPT}
        protein={TP53_PROTEIN}
        tracks={[exonTrack({}), interProTrack({})]}
        trackHeightBudget={220}
      >
        <GeneGlyph.LeftGutter width={120}>
          {(item: GutterItem) => {
            // Multi-level gutter: groups render their label in italic
            // bold; the entry-type sub-tracks render their per-track
            // `label` indented underneath to make the nesting structure
            // visible. Sub-tracks without a label (the exon track, etc.)
            // are skipped — the gutter row is reserved by the layout
            // engine regardless, so the figure rows stay aligned.
            if (item.kind === 'group') {
              // Top-align the group label so it sits at the *top* of the
              // group's y-extent. The sub-track rows are centred within
              // their own smaller rects, so without this override the
              // group label (centred on the whole group rect) collides
              // vertically with whichever sub-track row happens to sit at
              // the group's midline.
              return (
                <span
                  style={{
                    alignSelf: 'flex-start',
                    paddingTop: 2,
                    fontWeight: 700,
                    fontStyle: 'italic',
                  }}
                  title={item.label}
                >
                  {item.label}
                </span>
              );
            }
            if (!item.label) return null;
            return (
              <span
                style={{
                  paddingLeft: 14,
                  fontSize: '0.8rem',
                  color: '#64748b',
                }}
                title={item.label}
              >
                {item.label}
              </span>
            );
          }}
        </GeneGlyph.LeftGutter>
      </GeneGlyph>
    </section>
  );
}
