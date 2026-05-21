import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DefaultMinimap,
  GeneGlyph,
  exonTrack,
  overviewTrack,
  pfamTrack,
  variantTrack,
} from '@populationgenomics/gene-glyph';
import type {
  GeneGlyphRef,
  Track,
  ViewportInfo,
} from '@populationgenomics/gene-glyph';
import { TP53_PROTEIN, TP53_TRANSCRIPT, TP53_VARIANTS } from '../fixtures/tp53.js';

/** Live readout of the viewport's canonical state. Subscribes to the
 *  viewer via the imperative ref and re-renders on every committed
 *  change. Useful for sanity-checking what the underlying state is
 *  doing — especially "is the baseline window moving smoothly or
 *  snapping?" — without having to read the figure pixels. */
function ViewportDebug({ refForward }: { refForward: React.RefObject<GeneGlyphRef | null> }) {
  const [info, setInfo] = useState<ViewportInfo | null>(null);
  useEffect(() => {
    const v = refForward.current;
    if (!v) return;
    setInfo(v.getViewportInfo());
    return v.subscribe(() => {
      const live = refForward.current;
      if (live) setInfo(live.getViewportInfo());
    });
  }, [refForward]);
  if (!info) return null;
  const fmt = (n: number) => n.toFixed(2);
  const fmtRange = (r: readonly [number, number]) => `[${fmt(r[0])}, ${fmt(r[1])}]`;
  const baselineSpan = info.baselineWindow[1] - info.baselineWindow[0];
  return (
    <pre
      style={{
        background: '#0f172a',
        color: '#e2e8f0',
        padding: '8px 12px',
        borderRadius: 4,
        fontSize: 11,
        lineHeight: 1.5,
        margin: '4px 0 12px',
        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
      }}
    >
      mode={info.mode}  zoom={fmt(info.zoom)}{'\n'}
      range         = {fmtRange(info.range)}  (ruler, derived){'\n'}
      naturalRange  = {fmtRange(info.naturalRange)}{'\n'}
      baselineWindow= {fmtRange(info.baselineWindow)}  span={fmt(baselineSpan)} (display){'\n'}
      figureBaseline= [0, {fmt(info.baselineGeometry.totalWidth)}]  pxPerBp={fmt(info.baselineGeometry.pxPerBp)}  gapPx={fmt(info.baselineGeometry.gapPx)}
    </pre>
  );
}

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
    <>
      <GeneGlyph
        ref={ref}
        transcript={TP53_TRANSCRIPT}
        protein={TP53_PROTEIN}
        tracks={tracks}
        trackHeightBudget={260}
      />
      <ViewportDebug refForward={ref} />
    </>
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
        <ViewportDebug refForward={minimapRef} />
      </div>
    </section>
  );
}
