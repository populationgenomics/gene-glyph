import { Fragment, type ReactNode } from 'react';
import type {
  Track,
  TrackHeightArgs,
  TrackHeightResult,
  TrackLoadArgs,
  TrackRenderArgs,
} from '../types.js';

export interface ExonTrackConfig {
  id?: string;
  /** Total track height in pixels; the exon ribbon sits on its vertical centre. */
  height?: number;
  /** Half-thickness of the exon rectangle. */
  exonHalfHeight?: number;
  /** Pixel width of the donor / acceptor flank drawn at exon scale on either
   *  side of every collapsed intron. Drawn inside the intron-decoration group
   *  whose opacity is tied to `--vv-intron-scale`. When the inter-exon gap is
   *  narrow the flank is capped so the central chevron-peaked section keeps a
   *  visible horizontal extent. */
  flankPx?: number;
  /** Vertical lift of the chevron peak above the intron baseline. */
  chevronLift?: number;
}

interface ExonTrackData {
  // The exon track is purely transcript-derived; load returns an empty marker.
  ready: true;
}

const DEFAULT_HEIGHT = 24;
const DEFAULT_HALF = 8;
const DEFAULT_FLANK_PX = 12;
const DEFAULT_CHEVRON_LIFT = 6;

export function exonTrack(config: ExonTrackConfig = {}): Track<ExonTrackConfig, ExonTrackData> {
  const id = config.id ?? 'exon-track';
  const trackHeight = config.height ?? DEFAULT_HEIGHT;
  const exonHalf = config.exonHalfHeight ?? DEFAULT_HALF;
  const flankPx = config.flankPx ?? DEFAULT_FLANK_PX;
  const chevronLift = config.chevronLift ?? DEFAULT_CHEVRON_LIFT;

  return {
    id,
    coordSystem: 'cds',
    heightPolicy: 'fixed',

    async load(_args: TrackLoadArgs): Promise<ExonTrackData> {
      return { ready: true };
    },

    height(_args: TrackHeightArgs<ExonTrackData>): TrackHeightResult {
      return { px: trackHeight, didTruncate: false };
    },

    render(args: TrackRenderArgs<ExonTrackData>): ReactNode {
      const { rect, viewport, mapper, painter } = args;
      const exons = mapper.transcript.exons;
      const midY = (rect.yTop + rect.yBottom) / 2;
      const exonY = midY - exonHalf;
      const exonH = exonHalf * 2;
      const intronY = midY;
      const [rangeLo, rangeHi] = viewport.range;

      const exonRects: ReactNode[] = [];
      const intronDecorations: ReactNode[] = [];

      // `clipCdsToScreen` projects a CDS position that may sit outside the
      // active range. Without this, partially-visible exons drop out entirely
      // (their `cdsStart` < `rangeLo` returns `null`) and any intron decoration
      // between two visible neighbours appears to trail into empty space at
      // the figure edge. Clipping to the range edge keeps a sliver of exon
      // visible so the intron always lands on something solid.
      const clipCdsToScreen = (cPos: number): number | null => {
        const clipped = Math.max(rangeLo, Math.min(rangeHi, cPos));
        return viewport.cdsToScreen(clipped, 0);
      };

      for (let i = 0; i < exons.length; i++) {
        const e = exons[i]!;
        const visibleLo = Math.max(rangeLo, e.cdsStart);
        const visibleHi = Math.min(rangeHi, e.cdsEnd);
        if (visibleHi < visibleLo) continue;
        const xStart = viewport.cdsToScreen(visibleLo, 0);
        const xEnd = viewport.cdsToScreen(visibleHi, 0);
        if (xStart === null || xEnd === null) continue;
        const w = Math.max(1, xEnd - xStart);
        exonRects.push(
          painter.placeInExonGroup(
            i,
            <Fragment key={`exon-${i}`}>
              {painter.drawRect({
                key: `exon-rect-${i}`,
                x: 0,
                y: exonY,
                width: w,
                height: exonH,
                fill: painter.color('vv-color-exon-fill', '#94a3b8'),
                stroke: painter.color('vv-color-exon-stroke', '#475569'),
                strokeWidth: 1,
                className: 'vv-exon-rect',
              })}
            </Fragment>,
          ),
        );
      }

      for (let i = 0; i < exons.length - 1; i++) {
        const a = exons[i]!;
        const b = exons[i + 1]!;
        const aEnd = clipCdsToScreen(a.cdsEnd);
        const bStart = clipCdsToScreen(b.cdsStart);
        if (aEnd === null || bStart === null) continue;
        const gapWidth = bStart - aEnd;
        if (gapWidth <= 0) continue;
        // The inter-exon group is translated by --vv-intron-x-{i} = aEnd, so
        // the polyline renders in local-x [0, gapWidth] instead of absolute
        // screen-x. Local coords let the wrapping <g>'s CSS transition slide
        // the whole shape between range changes rather than React snapping
        // its `points` attribute to new absolute coordinates each frame.
        const flank = Math.min(flankPx, gapWidth / 3);
        const donorEnd = flank;
        const acceptorStart = gapWidth - flank;
        const peakX = gapWidth / 2;
        const peakY = intronY - chevronLift;
        const stroke = painter.color('vv-color-intron-line', '#475569');
        const points = `0,${intronY} ${donorEnd},${intronY} ${peakX},${peakY} ${acceptorStart},${intronY} ${gapWidth},${intronY}`;
        intronDecorations.push(
          painter.placeInInterExon(
            i,
            i + 1,
            <Fragment key={`intron-${i}-${i + 1}`}>
              <polyline
                key={`intron-line-${i}`}
                points={points}
                fill="none"
                stroke={stroke}
                strokeWidth={1.5}
                strokeLinejoin="round"
                strokeLinecap="round"
                className="vv-intron-polyline"
              />
            </Fragment>,
          ),
        );
      }

      return (
        <g className="vv-exon-track" data-vv-track-id={id} key={id}>
          {intronDecorations}
          {exonRects}
        </g>
      );
    },

    resolveAnchor(_data, anchorId, viewport) {
      const match = /^exon:(\d+)$/.exec(anchorId);
      if (!match) return null;
      const idx = Number(match[1]);
      const exon = viewport.resolveAnchor({ kind: 'intron-boundary', exonIdx: idx, side: 'acceptor' });
      return exon;
    },

    toJSON() {
      return {
        id,
        height: trackHeight,
        exonHalfHeight: exonHalf,
        flankPx,
        chevronLift,
      };
    },
  };
}
