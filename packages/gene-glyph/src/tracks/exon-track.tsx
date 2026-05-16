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
      const { rect, viewport, painter } = args;
      const geom = viewport.baselineGeometry();
      const midY = (rect.yTop + rect.yBottom) / 2;
      const exonY = midY - exonHalf;
      const exonH = exonHalf * 2;
      const intronY = midY;

      const exonRects: ReactNode[] = [];
      const intronDecorations: ReactNode[] = [];

      // Every exon renders at its baseline width — never recomputed against
      // the active range. The wrapping `<g>` applies the live translate +
      // scale; the figure SVG's `overflow: hidden` clips edge exons that
      // slide off-figure during pan / zoom.
      for (const eb of geom.exons) {
        exonRects.push(
          painter.placeInExonGroup(
            eb.exonIdx,
            <Fragment key={`exon-${eb.exonIdx}`}>
              {painter.drawRect({
                key: `exon-rect-${eb.exonIdx}`,
                x: 0,
                y: exonY,
                width: eb.width,
                height: exonH,
                fill: painter.color('vv-color-exon-fill', '#94a3b8'),
                stroke: painter.color('vv-color-exon-stroke', '#475569'),
                strokeWidth: 1,
                vectorEffect: 'non-scaling-stroke',
                className: 'vv-exon-rect',
              })}
            </Fragment>,
          ),
        );
      }

      // Each intron decoration renders inside its inter-exon `<g>`, in the
      // baseline gap-frame [0, baseline_gap_width]. Translate + scale on the
      // wrapper handle the live screen position; the polyline geometry never
      // changes after first render.
      for (const gap of geom.gaps) {
        if (gap.width <= 0) continue;
        const flank = Math.min(flankPx, gap.width / 3);
        const donorEnd = flank;
        const acceptorStart = gap.width - flank;
        const peakX = gap.width / 2;
        const peakY = intronY - chevronLift;
        const stroke = painter.color('vv-color-intron-line', '#475569');
        const points = `0,${intronY} ${donorEnd},${intronY} ${peakX},${peakY} ${acceptorStart},${intronY} ${gap.width},${intronY}`;
        intronDecorations.push(
          painter.placeInInterExon(
            gap.exonIdxA,
            gap.exonIdxB,
            <Fragment key={`intron-${gap.exonIdxA}-${gap.exonIdxB}`}>
              <polyline
                key={`intron-line-${gap.exonIdxA}`}
                points={points}
                fill="none"
                stroke={stroke}
                strokeWidth={1.5}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
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
