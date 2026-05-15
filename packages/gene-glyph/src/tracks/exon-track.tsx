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
   *  whose opacity is tied to `--vv-intron-scale`. */
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

      const exonRects: ReactNode[] = [];
      const intronDecorations: ReactNode[] = [];

      for (let i = 0; i < exons.length; i++) {
        const e = exons[i]!;
        const xStart = viewport.cdsToScreen(e.cdsStart, 0);
        const xEnd = viewport.cdsToScreen(e.cdsEnd, 0);
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
        const aEnd = viewport.cdsToScreen(a.cdsEnd, 0);
        const bStart = viewport.cdsToScreen(b.cdsStart, 0);
        if (aEnd === null || bStart === null) continue;
        if (bStart <= aEnd) continue;
        const flank = Math.min(flankPx, (bStart - aEnd) / 2);
        const donorEnd = aEnd + flank;
        const acceptorStart = bStart - flank;
        const peakX = (donorEnd + acceptorStart) / 2;
        const peakY = intronY - chevronLift;
        const stroke = painter.color('vv-color-intron-line', '#475569');
        const points = `${aEnd},${intronY} ${donorEnd},${intronY} ${peakX},${peakY} ${acceptorStart},${intronY} ${bStart},${intronY}`;
        intronDecorations.push(
          painter.placeInInterExon(
            i,
            i + 1,
            <Fragment key={`intron-${i}-${i + 1}`}>
              {/* Whole chevron-peaked polyline drawn as a single path so the
                  joins between flanks and peak stay continuous. */}
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
