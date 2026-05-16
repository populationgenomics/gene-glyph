import { Fragment, type CSSProperties, type ReactNode } from 'react';
import {
  isDataSource,
  type CoordinateMapper,
  type DataSource,
  type HiddenFeatureBucket,
  type HiddenFeaturesArgs,
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

/** Locate the intron a non-exonic variant falls in (Slice 15). Returns the
 *  exon-pair `{exonIdxA, exonIdxB}` that brackets the variant, or `null` when
 *  the variant projects onto an exon (no intron) or its anchor can't be
 *  resolved against the transcript. Used by `hiddenFeaturesByIntron` to feed
 *  per-gap counts to the exon track. */
export function variantIntronGap(
  v: ViewerVariant,
  mapper: CoordinateMapper,
): { exonIdxA: number; exonIdxB: number } | null {
  let cPos: number;
  let offset: number;
  switch (v.coord.kind) {
    case 'protein':
      return null;
    case 'cds':
      cPos = v.coord.cPos;
      offset = v.coord.offset;
      break;
    case 'genomic': {
      const g = mapper.genomicToCds(v.coord.chr, v.coord.pos);
      if (!g) return null;
      cPos = g.cPos;
      offset = g.offset;
      break;
    }
  }
  if (offset === 0) return null;
  const exonHit = mapper.findExonByCds(cPos);
  if (!exonHit) return null;
  const lastIdx = mapper.transcript.exons.length - 1;
  // Convention from cdsToGenomic: positive offset is anchored on the upstream
  // exon (intron after); negative offset on the downstream exon (intron
  // before). Mid-exon malformed cPos still picks the neighbouring intron
  // matching the offset's sign.
  if (offset > 0) {
    if (exonHit.exonIdx >= lastIdx) return null;
    return { exonIdxA: exonHit.exonIdx, exonIdxB: exonHit.exonIdx + 1 };
  }
  if (exonHit.exonIdx <= 0) return null;
  return { exonIdxA: exonHit.exonIdx - 1, exonIdxB: exonHit.exonIdx };
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
  // Intronic offsets land in the unplaced bucket; Slice 10 keeps the same
  // contract (intronic features bubble into the bottom track) until Slice 15
  // teaches the exon track to draw hidden-feature indicators in the gap.
  if (offset !== 0) return null;
  const exonHit = mapper.findExonByCds(cPos);
  if (!exonHit) return null;
  const baseline = viewport.baselineGeometry();
  const eb = baseline.exons[exonHit.exonIdx];
  if (!eb) return null;
  // Baseline localX: the variant's position within its exon's fit-gene frame.
  // The exon `<g>` carries the live translate + scale; the figure SVG clips
  // off-figure renderings so the variant stays in the DOM even when its
  // current screen position is outside [0, width].
  const variantBaselineX = viewport.cdsToBaselineX(cPos);
  return { variant: v, exonIdx: exonHit.exonIdx, localX: variantBaselineX - eb.xStart };
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

    hiddenFeaturesByIntron({ data, mapper }: HiddenFeaturesArgs<VariantTrackData>): HiddenFeatureBucket[] {
      // Intronic variants — those whose CDS offset is non-zero, or whose
      // genomic position lies between exons — are never placed on an exon
      // ribbon, regardless of mode. The exon track folds these counts onto
      // dashed-gap polylines (visible in spliced / protein modes) so users
      // see where data is hidden by the collapse.
      const byKey = new Map<string, HiddenFeatureBucket>();
      for (const v of data.variants) {
        const gap = variantIntronGap(v, mapper);
        if (!gap) continue;
        const key = `${gap.exonIdxA}:${gap.exonIdxB}`;
        const prev = byKey.get(key);
        if (prev) {
          prev.count += 1;
          prev.featureIds!.push(v.id);
        } else {
          byKey.set(key, { ...gap, count: 1, featureIds: [v.id] });
        }
      }
      return [...byKey.values()];
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
  // The parent exon group applies scaleX(--vv-exon-scale-x-{N}). The tick is
  // a vertical line so horizontal scale doesn't visually stretch it (only
  // stroke-width would, and `vector-effect: non-scaling-stroke` keeps that
  // constant). The dot and ring are circles though, and would render as
  // ellipses under horizontal scale, so we wrap them in a counter-scale
  // group that undoes the parent zoom.
  const counterScale = `scaleX(calc(1 / var(--vv-exon-scale-x-${placement.exonIdx}, 1)))`;
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
        <line
          className="vv-variant-tick"
          x1={0}
          x2={0}
          y1={tickTop}
          y2={tickBottom}
          stroke={color}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
        <g
          className="vv-variant-shape"
          style={{ transform: counterScale, transformOrigin: '0 0' }}
        >
          <circle
            className="vv-variant-ring"
            cx={0}
            cy={dotCy}
            r={dotRadius + 3}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
          <circle
            className="vv-variant-dot"
            cx={0}
            cy={dotCy}
            r={dotRadius}
            fill={color}
            stroke="var(--vv-variant-dot-stroke, #ffffff)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      </g>
    </g>
  );
}
