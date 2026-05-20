import { Fragment, type CSSProperties, type ReactNode } from 'react';
import type {
  MinimapRenderArgs,
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
      //
      // Extend the ribbon visually by a constant `overhangPx` of *screen*
      // pixels on each side so per-bp markers (nt/aa letters, variant
      // lollipops, ruler ticks) sit inside the ribbon at the 5′/3′ exon
      // boundaries. `cdsToBaselineX` returns the bp's centre point —
      // without the pad, the bp at cdsStart / cdsEnd anchors at the ribbon's
      // hard edge and its 12-px-wide letter glyph hangs half off into the
      // padding zone / intron gap.
      //
      // The pad lives inside the exon group's `scaleX(exon-scale)` transform,
      // so we counter-scale via CSS `calc(... / var(--vv-exon-scale-x-N))`.
      // That keeps the screen-pixel overhang constant across zoom — a
      // baseline-units pad would grow linearly with zoom and swallow the
      // inter-exon gap whole at deep zoom (no zigzag visible past ~30×).
      const overhangPx = 6;
      // The cell-width invariant gives each bp/aa a baseline cell of
      // pxPerBp / pxPerAa, so the exon rect already covers the FULL extent
      // of its first and last cells — no half-bp baseline pad is needed
      // here. (Previously transcript mode added one because the lattice
      // model anchored bp 1 at xStart and bp N at xEnd, leaving a half-cell
      // gap between adjacent exons' last/first cells.)
      // Phase 3: index flanks by adjacent exon so each exon group can
      // render its splice-site decorations. The donor flank sits on the
      // exon's 3' side (intron i.donor for exon i); the acceptor flank
      // on the 5' side (intron (i-1).acceptor for exon i).
      const flankByExonAndSide = new Map<string, number>();
      for (const flank of geom.flanks ?? []) {
        if (flank.side === 'donor') {
          flankByExonAndSide.set(`${flank.intronIdx}:donor`, flank.width);
        } else {
          flankByExonAndSide.set(`${flank.intronIdx + 1}:acceptor`, flank.width);
        }
      }
      const flankFill = painter.color('vv-color-exon-fill', '#94a3b8');
      const flankStroke = painter.color('vv-color-exon-stroke', '#475569');
      const flankH = Math.max(2, Math.floor(exonH / 2));
      const flankY = (exonY + exonH / 2) - flankH / 2;
      for (const eb of geom.exons) {
        const scaleVar = `var(--vv-exon-scale-x-${eb.exonIdx}, 1)`;
        const rectStyle = {
          // SVG2: x / width as CSS properties so we can use calc with the
          // live exon-scale CSS var. Browser support is Chrome 88+, Firefox
          // 76+, Safari 14+ — all the targets the rest of the viewer assumes.
          x: `calc(-1 * ${overhangPx}px / ${scaleVar})`,
          width: `calc(${eb.width}px + 2 * ${overhangPx}px / ${scaleVar})`,
        } as unknown as CSSProperties;
        const donorWidth = flankByExonAndSide.get(`${eb.exonIdx}:donor`) ?? 0;
        const acceptorWidth =
          flankByExonAndSide.get(`${eb.exonIdx}:acceptor`) ?? 0;
        exonRects.push(
          painter.placeInExonGroup(
            eb.exonIdx,
            <Fragment key={`exon-${eb.exonIdx}`}>
              {acceptorWidth > 0 && (
                <rect
                  key={`flank-acceptor-${eb.exonIdx}`}
                  x={-acceptorWidth}
                  y={flankY}
                  width={acceptorWidth}
                  height={flankH}
                  fill={flankFill}
                  stroke={flankStroke}
                  strokeWidth={1}
                  strokeOpacity={0.6}
                  fillOpacity={0.35}
                  vectorEffect="non-scaling-stroke"
                  className="vv-exon-flank vv-exon-flank-acceptor"
                  data-vv-intron-idx={eb.exonIdx - 1}
                />
              )}
              {donorWidth > 0 && (
                <rect
                  key={`flank-donor-${eb.exonIdx}`}
                  x={eb.width}
                  y={flankY}
                  width={donorWidth}
                  height={flankH}
                  fill={flankFill}
                  stroke={flankStroke}
                  strokeWidth={1}
                  strokeOpacity={0.6}
                  fillOpacity={0.35}
                  vectorEffect="non-scaling-stroke"
                  className="vv-exon-flank vv-exon-flank-donor"
                  data-vv-intron-idx={eb.exonIdx}
                />
              )}
              <rect
                key={`exon-rect-${eb.exonIdx}`}
                y={exonY}
                height={exonH}
                fill={painter.color('vv-color-exon-fill', '#94a3b8')}
                stroke={painter.color('vv-color-exon-stroke', '#475569')}
                strokeWidth={viewport.mode === 'protein' ? 0 : 1}
                vectorEffect="non-scaling-stroke"
                className="vv-exon-rect"
                style={rectStyle}
              />
            </Fragment>,
          ),
        );
      }

      // Each intron decoration renders inside its inter-exon `<g>`, in the
      // baseline gap-frame [0, baseline_gap_width]. Translate + scale on the
      // wrapper handle the live screen position; the polyline geometry never
      // changes after first render.
      //
      // Inset by `halfSlot` on each side so the polyline tucks into the
      // visible gap between the two exon ribbons — without the inset, the
      // donor / acceptor flanks would draw under the surrounding exon
      // rectangles (which now overhang the baseline gap by `halfSlot` on
      // each side per the half-slot ribbon extension above).
      for (const gap of geom.gaps) {
        // Phase 3: with the soft-collapse spec, `gap.width` covers the
        // whole intron (flanks + bulk). The polyline renders inside the
        // inter-exon `<g>` which is positioned on the bulk only, so we
        // size against the bulk's width (gap.width minus per-side flank
        // widths) rather than the full intron baseline.
        const intronDonorWidth =
          flankByExonAndSide.get(`${gap.exonIdxA + 1}:acceptor`) ?? 0;
        const intronAcceptorWidth =
          flankByExonAndSide.get(`${gap.exonIdxA}:donor`) ?? 0;
        const bulkWidth = Math.max(
          0,
          gap.width - intronDonorWidth - intronAcceptorWidth,
        );
        // Polyline spans the FULL bulk width, meeting the flank rects
        // (or, in modes without flanks, the exon ribbons) cleanly. The
        // legacy `overhangPx` inset existed when the inter-exon <g>
        // covered the whole intron and the polyline needed to stay
        // clear of overhanging exon ribbons; Phase 3 moves the
        // exon-rect overhang out of the bulk's <g> entirely.
        if (bulkWidth > 0) {
          const flank = Math.min(flankPx, bulkWidth / 3);
          const left = 0;
          const right = bulkWidth;
          const donorEnd = left + flank;
          const acceptorStart = right - flank;
          const peakX = (left + right) / 2;
          const peakY = intronY - chevronLift;
          const stroke = painter.color('vv-color-intron-line', '#475569');
          const points = `${left},${intronY} ${donorEnd},${intronY} ${peakX},${peakY} ${acceptorStart},${intronY} ${right},${intronY}`;
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

      // Protein mode: one continuous outline encloses the whole protein
      // strip. Per-exon fills (rendered without strokes — see strokeWidth
      // branch above) sit underneath, so the strip reads as a single
      // filled bar with one continuous border around it. The outline
      // rides the per-exon CSS variables of the first and last exons so
      // it tracks pan/zoom without React re-render.
      let proteinOutline: ReactNode = null;
      if (viewport.mode === 'protein' && geom.exons.length > 0) {
        const first = geom.exons[0]!;
        const last = geom.exons[geom.exons.length - 1]!;
        const proteinStyle: CSSProperties = {
          x: `var(--vv-exon-x-${first.exonIdx}, 0px)`,
          width:
            `calc(var(--vv-exon-x-${last.exonIdx}, 0px)` +
            ` + ${last.width}px * var(--vv-exon-scale-x-${last.exonIdx}, 1)` +
            ` - var(--vv-exon-x-${first.exonIdx}, 0px))`,
        } as unknown as CSSProperties;
        proteinOutline = (
          <rect
            key="protein-outline"
            className="vv-protein-outline"
            y={exonY}
            height={exonH}
            fill="none"
            stroke={painter.color('vv-color-exon-stroke', '#475569')}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
            style={proteinStyle}
          />
        );
      }

      return (
        <g className="vv-exon-track" data-vv-track-id={id} key={id}>
          {intronDecorations}
          {exonRects}
          {proteinOutline}
          {hiddenMarks.length > 0 && (
            <g className="vv-hidden-feature-marks" key="hidden-marks">
              {hiddenMarks}
            </g>
          )}
        </g>
      );
    },

    renderMinimap(args: MinimapRenderArgs<ExonTrackData>): ReactNode {
      // The mini-viewport is pinned to fit-gene at the target width, so
      // its baseline geometry is the display-space layout. No live
      // CSS-variable transforms are applied here — the minimap is pure
      // pixel math.
      const { width: mmWidth, height: mmHeight, viewport: mini } = args;
      const geom = mini.baselineGeometry();
      const exonH = Math.max(2, mmHeight - 6);
      const exonY = (mmHeight - exonH) / 2;
      const midY = mmHeight / 2;
      const intronStroke = 'var(--vv-color-intron-line, #64748b)';
      const exonFill = 'var(--vv-color-exon-fill, #cbd5e1)';
      const exonStroke = 'var(--vv-color-exon-stroke, #475569)';
      return (
        <g className="vv-exon-track-minimap" data-vv-track-id={id}>
          {geom.gaps.map((g) =>
            g.width > 0 ? (
              <line
                key={`mm-gap-${g.exonIdxA}-${g.exonIdxB}`}
                className="vv-exon-minimap-intron"
                x1={g.xStart}
                x2={g.xEnd}
                y1={midY}
                y2={midY}
                stroke={intronStroke}
                strokeWidth={1}
                pointerEvents="none"
              />
            ) : null,
          )}
          {geom.exons.map((e) => (
            <rect
              key={`mm-exon-${e.exonIdx}`}
              className="vv-exon-minimap-exon"
              x={e.xStart}
              y={exonY}
              width={Math.max(1, e.width)}
              height={exonH}
              rx={1.5}
              ry={1.5}
              fill={exonFill}
              stroke={exonStroke}
              strokeWidth={0.75}
              pointerEvents="none"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {/* `mmWidth` is the contract: render fills `[0, mmWidth]`. */}
          <rect
            className="vv-exon-minimap-frame"
            x={0}
            y={0}
            width={mmWidth}
            height={mmHeight}
            fill="none"
            stroke="none"
            pointerEvents="none"
          />
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
