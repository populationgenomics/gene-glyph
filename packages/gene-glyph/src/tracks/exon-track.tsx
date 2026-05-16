import { Fragment, type CSSProperties, type ReactNode } from 'react';
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
  /** Half-width (in px) of the hidden-feature indicator badge rendered over
   *  each intron gap in spliced / protein modes (Slice 15). */
  hiddenMarkHalfWidth?: number;
}

interface ExonTrackData {
  // The exon track is purely transcript-derived; load returns an empty marker.
  ready: true;
}

const DEFAULT_HEIGHT = 24;
const DEFAULT_HALF = 8;
const DEFAULT_FLANK_PX = 12;
const DEFAULT_CHEVRON_LIFT = 6;
const DEFAULT_HIDDEN_HALF_W = 9;

export function exonTrack(config: ExonTrackConfig = {}): Track<ExonTrackConfig, ExonTrackData> {
  const id = config.id ?? 'exon-track';
  const trackHeight = config.height ?? DEFAULT_HEIGHT;
  const exonHalf = config.exonHalfHeight ?? DEFAULT_HALF;
  const flankPx = config.flankPx ?? DEFAULT_FLANK_PX;
  const chevronLift = config.chevronLift ?? DEFAULT_CHEVRON_LIFT;
  const hiddenHalfW = config.hiddenMarkHalfWidth ?? DEFAULT_HIDDEN_HALF_W;

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
      const { rect, viewport, painter, hiddenByIntron, onFeatureClick } = args;
      const geom = viewport.baselineGeometry();
      const midY = (rect.yTop + rect.yBottom) / 2;
      const exonY = midY - exonHalf;
      const exonH = exonHalf * 2;
      const intronY = midY;

      const exonRects: ReactNode[] = [];
      const intronDecorations: ReactNode[] = [];
      const hiddenMarks: ReactNode[] = [];

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

        // Slice 15: hidden-feature indicator sits at the gap's *current* screen
        // position (centre, accounting for the gap's collapsed width in
        // spliced / protein modes) and fades opposite to --vv-intron-scale so
        // it only shows when the intron's own decorations have collapsed.
        const bucket = hiddenByIntron?.get(`${gap.exonIdxA}:${gap.exonIdxB}`);
        if (!bucket) continue;
        const featureId = `__hidden_intron_${gap.exonIdxA}_${gap.exonIdxB}`;
        const w = hiddenHalfW * 2;
        const y0 = intronY - hiddenHalfW;
        const handler = onFeatureClick ? () => onFeatureClick(featureId) : undefined;
        const wrapperStyle: CSSProperties = {
          transform:
            `translateX(calc(var(--vv-intron-x-${gap.exonIdxA}, 0px)` +
            ` + var(--vv-intron-w-${gap.exonIdxA}, 0px)` +
            ` * var(--vv-intron-scale-x-${gap.exonIdxA}, 1) / 2))`,
          transformOrigin: '0 0',
          opacity: `calc(1 - var(--vv-intron-scale))`,
          pointerEvents: 'var(--vv-hidden-mark-pointer, auto)' as CSSProperties['pointerEvents'],
        };
        hiddenMarks.push(
          <g
            key={`hidden-${gap.exonIdxA}-${gap.exonIdxB}`}
            className="vv-hidden-feature-mark"
            data-vv-feature-id={featureId}
            data-vv-hidden-count={bucket.count}
            data-vv-intron-from={gap.exonIdxA}
            data-vv-intron-to={gap.exonIdxB}
            style={wrapperStyle}
            onClick={handler}
            role={handler ? 'button' : undefined}
            tabIndex={handler ? 0 : undefined}
            aria-label={`${bucket.count} feature${bucket.count === 1 ? '' : 's'} hidden in intron between exon ${gap.exonIdxA + 1} and exon ${gap.exonIdxB + 1}`}
          >
            <rect
              className="vv-hidden-feature-bg"
              x={-hiddenHalfW}
              y={y0}
              width={w}
              height={hiddenHalfW * 2}
              rx={hiddenHalfW}
              ry={hiddenHalfW}
              fill={painter.color('vv-color-hidden-mark-bg', '#fef3c7')}
              stroke={painter.color('vv-color-hidden-mark-stroke', '#92400e')}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <text
              className="vv-hidden-feature-count"
              x={0}
              y={intronY}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={10}
              fill={painter.color('vv-color-hidden-mark-text', '#92400e')}
            >
              {bucket.count}
            </text>
          </g>,
        );
      }

      return (
        <g className="vv-exon-track" data-vv-track-id={id} key={id}>
          {intronDecorations}
          {exonRects}
          {hiddenMarks.length > 0 && (
            <g className="vv-hidden-feature-marks" key="hidden-marks">
              {hiddenMarks}
            </g>
          )}
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
