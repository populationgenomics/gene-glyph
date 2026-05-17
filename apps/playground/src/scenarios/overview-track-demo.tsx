import { useMemo, useRef } from 'react';
import {
  DefaultMinimap,
  GeneGlyph,
  exonTrack,
  overviewTrack,
  pfamTrack,
  variantTrack,
} from '@populationgenomics/gene-glyph';
import type { GeneGlyphRef, Track } from '@populationgenomics/gene-glyph';
import { TP53_PROTEIN, TP53_TRANSCRIPT, TP53_VARIANTS } from '../fixtures/tp53.js';

/**
 * Slice 26 — overview track + minimap, side by side.
 *
 * The top figure uses `overviewTrack` as the first row of the track stack:
 * the overview lives inside the figure SVG, so `exportSVG()` carries it
 * along with the rest of the figure. The bottom figure uses
 * `DefaultMinimap` in the Footer slot — chrome that doesn't make it into
 * exports.
 *
 * Both wire to the same direct-manipulation contract: drag the window to
 * pan, drag the edge handles to zoom, click outside the window to jump.
 */
function OverviewSubFigure() {
  const ref = useRef<GeneGlyphRef | null>(null);
  // The overview's `tracks` list is the upstream tracks we want
  // represented in the minimap. The exon track contributes its
  // `renderMinimap` ribbon; the other tracks don't (yet), so the overview
  // just shows the exon thumbnail. Memoize so the overviewTrack identity
  // is stable across renders (otherwise the viewer would reload tracks
  // on every render).
  const upstream = useMemo<Track[]>(
    () => [
      exonTrack({}),
      variantTrack({ id: 'variants', source: TP53_VARIANTS }),
      pfamTrack({}),
    ],
    [],
  );
  const tracks = useMemo(
    () => [overviewTrack({ viewerRef: ref, tracks: upstream }), ...upstream],
    [upstream],
  );
  return (
    <GeneGlyph
      ref={ref}
      transcript={TP53_TRANSCRIPT}
      protein={TP53_PROTEIN}
      tracks={tracks}
      trackHeightBudget={260}
    />
  );
}

export function OverviewTrackDemoScenario() {
  const minimapRef = useRef<GeneGlyphRef | null>(null);

  return (
    <section className="scenario" aria-labelledby="scenario-overview-track">
      <h2 id="scenario-overview-track">Overview track vs minimap — TP53</h2>
      <p className="scenario-blurb">
        Both navigation widgets share the same imperative-ref plumbing.{' '}
        <code>overviewTrack</code> lives inside the figure SVG (top) so it
        rides along on <code>exportSVG()</code>; <code>&lt;DefaultMinimap&gt;</code>{' '}
        lives in the Footer slot (bottom) as React DOM chrome that's dropped
        on export.
      </p>

      <div style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: '0.95rem', color: '#475569', marginBottom: 4 }}>
          overviewTrack (in-figure)
        </h3>
        <OverviewSubFigure />
      </div>

      <div>
        <h3 style={{ fontSize: '0.95rem', color: '#475569', marginBottom: 4 }}>
          DefaultMinimap (footer chrome)
        </h3>
        <GeneGlyph
          ref={minimapRef}
          transcript={TP53_TRANSCRIPT}
          protein={TP53_PROTEIN}
          tracks={[
            exonTrack({}),
            variantTrack({ id: 'variants', source: TP53_VARIANTS }),
            pfamTrack({}),
          ]}
          trackHeightBudget={220}
        >
          <GeneGlyph.Footer height={40}>
            <DefaultMinimap viewerRef={minimapRef} width={520} height={28} />
          </GeneGlyph.Footer>
        </GeneGlyph>
      </div>
    </section>
  );
}
