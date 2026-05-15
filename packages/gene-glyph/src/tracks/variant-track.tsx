import { Fragment, type CSSProperties, type ReactNode } from 'react';
import {
  isDataSource,
  type CoordinateMapper,
  type DataSource,
  type Track,
  type TrackHeightArgs,
  type TrackHeightResult,
  type TrackLoadArgs,
  type TrackRenderArgs,
  type VariantCategory,
  type ViewerVariant,
  type Viewport,
  type ViewportQuery,
} from '../types.js';

export type VariantSource =
  | ViewerVariant[]
  | DataSource<ViewportQuery, ViewerVariant[]>;

export interface VariantTrackConfig {
  id?: string;
  source: VariantSource;
  /** Total track height in pixels. */
  height?: number;
  /** Half-height of the variant tick line. */
  tickHalfHeight?: number;
  /** Radius of the dot drawn above the ribbon. */
  dotRadius?: number;
}

export interface VariantTrackData {
  variants: ViewerVariant[];
}

export interface VariantPlacement {
  variant: ViewerVariant;
  /** Exon index the variant lives in, used to pick the per-exon group. */
  exonIdx: number;
  /** Screen-x relative to the exon group's origin. */
  localX: number;
}

export interface VariantPartition {
  placed: VariantPlacement[];
  unplaced: ViewerVariant[];
}

const DEFAULT_HEIGHT = 28;
const DEFAULT_TICK_HALF = 8;
const DEFAULT_DOT_RADIUS = 4;

/** Maps each VariantCategory to its CSS-variable name (sans leading `--`). */
const CATEGORY_VAR: Record<VariantCategory, string> = {
  missense: 'vv-variant-color-missense',
  nonsense: 'vv-variant-color-nonsense',
  synonymous: 'vv-variant-color-synonymous',
  frameshift: 'vv-variant-color-frameshift',
  inframe_indel: 'vv-variant-color-inframe-indel',
  splice: 'vv-variant-color-splice',
  start_lost: 'vv-variant-color-start-lost',
  stop_lost: 'vv-variant-color-stop-lost',
  regulatory: 'vv-variant-color-regulatory',
  utr: 'vv-variant-color-utr',
  intronic: 'vv-variant-color-intronic',
  structural: 'vv-variant-color-structural',
  other: 'vv-variant-color-other',
  unknown: 'vv-variant-color-unknown',
};

const CATEGORY_FALLBACK: Record<VariantCategory, string> = {
  missense: '#f59e0b',
  nonsense: '#dc2626',
  synonymous: '#94a3b8',
  frameshift: '#b91c1c',
  inframe_indel: '#f97316',
  splice: '#8b5cf6',
  start_lost: '#dc2626',
  stop_lost: '#dc2626',
  regulatory: '#0ea5e9',
  utr: '#64748b',
  intronic: '#94a3b8',
  structural: '#ec4899',
  other: '#94a3b8',
  unknown: '#cbd5e1',
};

function categoryColor(category: VariantCategory): string {
  return `var(--${CATEGORY_VAR[category]}, ${CATEGORY_FALLBACK[category]})`;
}

/** Partition the variant list into features that project to a visible exon at
 *  the current viewport (placed) and those that don't (unplaced). A CDS
 *  coord-system track skips variants whose `cdsToScreen` returns null, which
 *  covers intronic offsets, out-of-range, and (in spliced/protein modes)
 *  features that fall on collapsed introns. */
export function partitionVariants(
  variants: ViewerVariant[],
  viewport: Viewport,
  mapper: CoordinateMapper,
): VariantPartition {
  const placed: VariantPlacement[] = [];
  const unplaced: ViewerVariant[] = [];
  for (const v of variants) {
    const placement = placeVariant(v, viewport, mapper);
    if (placement) placed.push(placement);
    else unplaced.push(v);
  }
  return { placed, unplaced };
}

function placeVariant(
  v: ViewerVariant,
  viewport: Viewport,
  mapper: CoordinateMapper,
): VariantPlacement | null {
  let cPos: number;
  let offset: number;
  switch (v.coord.kind) {
    case 'cds':
      cPos = v.coord.cPos;
      offset = v.coord.offset;
      break;
    case 'protein':
      cPos = mapper.proteinToCds(v.coord.aa);
      offset = 0;
      break;
    case 'genomic': {
      const g = mapper.genomicToCds(v.coord.chr, v.coord.pos);
      if (!g) return null;
      cPos = g.cPos;
      offset = g.offset;
      break;
    }
  }
  const variantX = viewport.cdsToScreen(cPos, offset);
  if (variantX === null) return null;
  const exonHit = mapper.findExonByCds(cPos);
  if (!exonHit) return null;
  const exon = mapper.transcript.exons[exonHit.exonIdx]!;
  const exonStartX = viewport.cdsToScreen(exon.cdsStart, 0);
  if (exonStartX === null) return null;
  return { variant: v, exonIdx: exonHit.exonIdx, localX: variantX - exonStartX };
}

export function variantTrack(
  config: VariantTrackConfig,
): Track<VariantTrackConfig, VariantTrackData> {
  const id = config.id ?? 'variant-track';
  const trackHeight = config.height ?? DEFAULT_HEIGHT;
  const tickHalf = config.tickHalfHeight ?? DEFAULT_TICK_HALF;
  const dotRadius = config.dotRadius ?? DEFAULT_DOT_RADIUS;
  const source = config.source;

  return {
    id,
    coordSystem: 'cds',
    heightPolicy: 'fixed',

    async load({ viewport, signal }: TrackLoadArgs): Promise<VariantTrackData> {
      const variants = isDataSource<ViewportQuery, ViewerVariant[]>(source)
        ? await source.query({ mode: viewport.mode, range: viewport.range }, signal)
        : source.slice();
      return { variants };
    },

    height(_args: TrackHeightArgs<VariantTrackData>): TrackHeightResult {
      return { px: trackHeight, didTruncate: false };
    },

    render(args: TrackRenderArgs<VariantTrackData>): ReactNode {
      const { data, rect, viewport, mapper, interaction, painter, onFeatureHover, onFeatureClick } = args;
      const partition = partitionVariants(data.variants, viewport, mapper);
      const midY = (rect.yTop + rect.yBottom) / 2;
      const dotCy = rect.yTop + dotRadius + 2;
      const tickTop = midY - tickHalf;
      const tickBottom = midY + tickHalf;

      const byExon = new Map<number, VariantPlacement[]>();
      for (const p of partition.placed) {
        let arr = byExon.get(p.exonIdx);
        if (!arr) {
          arr = [];
          byExon.set(p.exonIdx, arr);
        }
        arr.push(p);
      }

      const groups: ReactNode[] = [];
      for (const [exonIdx, placements] of byExon) {
        const inner = placements.map((p) =>
          renderVariant({
            placement: p,
            dotCy,
            tickTop,
            tickBottom,
            dotRadius,
            interaction,
            onFeatureHover,
            onFeatureClick,
          }),
        );
        groups.push(
          painter.placeInExonGroup(
            exonIdx,
            <Fragment key={`variants-exon-${exonIdx}`}>{inner}</Fragment>,
          ),
        );
      }

      return (
        <g className="vv-variant-track" data-vv-track-id={id} key={id}>
          {groups}
        </g>
      );
    },

    renderBelow(args: TrackRenderArgs<VariantTrackData>): ReactNode | null {
      const { data, viewport, mapper, interaction, onFeatureHover, onFeatureClick } = args;
      const partition = partitionVariants(data.variants, viewport, mapper);
      if (partition.unplaced.length === 0) return null;
      return (
        <div
          className="vv-unplaced-variants"
          data-vv-track-id={id}
          data-testid={`${id}-unplaced`}
        >
          <span className="vv-unplaced-label">
            Unplaced ({partition.unplaced.length})
          </span>
          <ul className="vv-unplaced-list">
            {partition.unplaced.map((v) => {
              const isHovered = interaction.hoveredFeatureId === v.id;
              const isSelected = interaction.selectedFeatureIds.has(v.id);
              const cls = [
                'vv-unplaced-chip',
                isHovered && 'is-hovered',
                isSelected && 'is-selected',
              ]
                .filter(Boolean)
                .join(' ');
              const style: CSSProperties = {
                ['--vv-variant-color' as keyof CSSProperties]: categoryColor(v.category),
              } as CSSProperties;
              return (
                <li
                  key={v.id}
                  className={cls}
                  data-vv-feature-id={v.id}
                  data-vv-category={v.category}
                  style={style}
                  onMouseEnter={() => onFeatureHover?.(v.id)}
                  onMouseLeave={() => onFeatureHover?.(null)}
                  onClick={() => onFeatureClick?.(v.id)}
                  title={v.label}
                >
                  <span className="vv-unplaced-dot" aria-hidden />
                  <span className="vv-unplaced-text">{v.label}</span>
                </li>
              );
            })}
          </ul>
        </div>
      );
    },

    resolveAnchor(data, anchorId, viewport) {
      const v = data.variants.find((x) => x.id === anchorId);
      if (!v) return null;
      switch (v.coord.kind) {
        case 'cds':
          return viewport.resolveAnchor({ kind: 'cds-pos', cPos: v.coord.cPos, offset: v.coord.offset });
        case 'protein':
          return viewport.resolveAnchor({ kind: 'protein-aa', aa: v.coord.aa });
        case 'genomic':
          return viewport.resolveAnchor({ kind: 'genomic-pos', chr: v.coord.chr, pos: v.coord.pos });
      }
    },

    toJSON() {
      return {
        id,
        source,
        height: trackHeight,
        tickHalfHeight: tickHalf,
        dotRadius,
      };
    },
  };
}

interface RenderVariantArgs {
  placement: VariantPlacement;
  dotCy: number;
  tickTop: number;
  tickBottom: number;
  dotRadius: number;
  interaction: TrackRenderArgs<VariantTrackData>['interaction'];
  onFeatureHover?: (featureId: string | null) => void;
  onFeatureClick?: (featureId: string) => void;
}

function renderVariant(args: RenderVariantArgs): ReactNode {
  const { placement, dotCy, tickTop, tickBottom, dotRadius, interaction, onFeatureHover, onFeatureClick } = args;
  const v = placement.variant;
  const isHovered = interaction.hoveredFeatureId === v.id;
  const isSelected = interaction.selectedFeatureIds.has(v.id);
  const wrapperClass = [
    'vv-variant',
    `vv-variant-${v.category}`,
    isHovered && 'is-hovered',
    isSelected && 'is-selected',
  ]
    .filter(Boolean)
    .join(' ');
  const color = categoryColor(v.category);
  return (
    <g
      key={v.id}
      className={wrapperClass}
      data-vv-feature-id={v.id}
      data-vv-category={v.category}
      transform={`translate(${placement.localX} 0)`}
      onMouseEnter={onFeatureHover ? () => onFeatureHover(v.id) : undefined}
      onMouseLeave={onFeatureHover ? () => onFeatureHover(null) : undefined}
      onClick={onFeatureClick ? () => onFeatureClick(v.id) : undefined}
      style={{ cursor: onFeatureClick ? 'pointer' : undefined }}
      tabIndex={0}
      role="button"
      aria-label={v.label}
    >
      <g className="vv-variant-inner">
        <circle
          className="vv-variant-ring"
          cx={0}
          cy={dotCy}
          r={dotRadius + 3}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
        />
        <line
          className="vv-variant-tick"
          x1={0}
          x2={0}
          y1={tickTop}
          y2={tickBottom}
          stroke={color}
          strokeWidth={1.5}
        />
        <circle
          className="vv-variant-dot"
          cx={0}
          cy={dotCy}
          r={dotRadius}
          fill={color}
          stroke="var(--vv-variant-dot-stroke, #ffffff)"
          strokeWidth={1}
        />
      </g>
    </g>
  );
}
