import { Fragment, type CSSProperties, type ReactNode } from 'react';
import { glyphPath, type SymbolEncoding } from '../symbol-encoding.js';
import { formatCdsPosition } from '../coordinate-mapper.js';
import { resolveSourceData } from '../data-source.js';
import { intronMarkPath } from './exon-edge.js';
import { packLanes } from '../pack-lanes.js';
import {
  type CdsPosition,
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

export type VariantSource = ViewerVariant[] | DataSource<ViewportQuery, ViewerVariant[]>;

export interface VariantTrackConfig {
  id?: string;
  /** Name of the track, for the gutter and for the list of unplaced
   *  variants when the figure has several such lists. */
  label?: string;
  source: VariantSource;
  /** Total track height in pixels (tick+dot style only). Ignored when
   *  {@link stackedVariantStyle} is set — stacked render uses
   *  `heightPolicy: 'data-dependent'` and grows to fit packed lanes. */
  height?: number;
  /** Half-height of the variant tick line. */
  tickHalfHeight?: number;
  /** Radius of the dot drawn above the ribbon. */
  dotRadius?: number;
  /** Opt in to the stacked-symbol render (Slice 27). When supplied, the
   *  track suppresses the tick+dot row in favour of a stacked column of
   *  pure-symbol glyphs — shape, fill, and (optional) colour independently
   *  encode three orthogonal feature attributes via the supplied
   *  {@link SymbolEncoding}. */
  stackedVariantStyle?: SymbolEncoding<ViewerVariant>;
  /** Per-row pitch for stacked render. Defaults to `2 * markRadius + 2` so
   *  adjacent rows just clear each other. */
  stackLanePx?: number;
  /** Glyph radius for stacked render. Defaults to {@link dotRadius}. */
  stackMarkRadius?: number;
}

export interface VariantTrackData {
  variants: ViewerVariant[];
  /** Variants in an intron, by id, with their c. position and its HGVS
   *  text. They are drawn at the edge of the exon beside the intron, so
   *  their hover text states the position. */
  intronic?: ReadonlyMap<string, { cds: CdsPosition; hgvs: string }>;
  /** Pre-computed stacked layout — populated only when the track was
   *  constructed with a `stackedVariantStyle`. Stored on the data payload
   *  so `height()` and `render()` agree on the row count without
   *  re-projecting through the coordinate mapper. */
  stackLayout?: VariantStackLayout;
}

export interface StackedVariantPlacement extends VariantPlacement {
  /** Global row index — `0` is closest to the exon ribbon (track top),
   *  rows count downward into the track area. */
  row: number;
  /** Lane-group key returned by {@link SymbolEncoding.lane} (or `_` when
   *  the encoding omits the accessor). */
  laneKey: string;
}

export interface VariantStackLayout {
  rowCount: number;
  placements: StackedVariantPlacement[];
}

export interface VariantPlacement {
  variant: ViewerVariant;
  /** Exon index the variant lives in, used to pick the per-exon group. A
   *  variant in a UTR-only exon or a UTR part lives in the first or last
   *  exon's group, at a `localX` inside its UTR cap. */
  exonIdx: number;
  /** Screen-x relative to the exon group's origin. */
  localX: number;
  /** Set for a variant in an intron: it is drawn on the exon edge on this
   *  side (`donor` = the exon's 3' edge, `acceptor` = its 5' edge), with a
   *  marker pointing into the intron. */
  intronSide?: 'donor' | 'acceptor';
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
  // Protein coords are always exonic (a residue is one codon's worth of
  // bp, which lives inside an exon by definition) — short-circuit so the
  // resolveCds call doesn't get asked an answerable-but-meaningless
  // question.
  if (v.coord.kind === 'protein') return null;
  const cds = mapper.resolveCds(v.coord);
  if (!cds || cds.offset === 0) return null;
  const { cPos, offset } = cds;
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

/** Partition the variant list into features drawn on the figure (placed) and
 *  those listed below it (unplaced). In genome and transcript modes a
 *  variant is placed when it lies on the transcript: in a coding part, a UTR
 *  part or a UTR-only exon at its own position, in an intron at the edge of
 *  the exon its c. position is anchored on. Unplaced are variants off the
 *  transcript (another chromosome, beyond its ends, a genomic base the
 *  exon's alignment blocks leave out) and, in protein mode, variants outside
 *  the coding parts. */
export function partitionVariants(
  variants: ViewerVariant[],
  viewport: Viewport,
  // Placement resolves through the viewport's own mapper; the parameter
  // stays so existing three-argument calls keep compiling.
  _mapper?: CoordinateMapper,
): VariantPartition {
  const placed: VariantPlacement[] = [];
  const unplaced: ViewerVariant[] = [];
  for (const v of variants) {
    const placement = placeVariant(v, viewport);
    if (placement) placed.push(placement);
    else unplaced.push(v);
  }
  return { placed, unplaced };
}

/** Variant's ruler position for the current viewport mode — CDS bp in CDS
 *  modes, aa in protein. Used by selection-highlight logic (Slice 16) to
 *  decide whether a placed variant intersects a brush range. Returns `null`
 *  for variants whose coord can't be resolved in the active mode (e.g., a
 *  genomic coord that doesn't land on any exon). */
export function variantRulerPos(
  v: ViewerVariant,
  viewport: Viewport,
  mapper: CoordinateMapper,
): number | null {
  const cds = mapper.resolveCds(v.coord);
  if (!cds || cds.offset !== 0) return null;
  return viewport.mode === 'protein' ? mapper.cdsToProtein(cds.cPos) : cds.cPos;
}

function placeVariant(v: ViewerVariant, viewport: Viewport): VariantPlacement | null {
  const placement = viewport.placePosition(v.coord);
  if (!placement) return null;
  const { exonIdx, localX, intronSide } = placement;
  return { variant: v, exonIdx, localX, ...(intronSide ? { intronSide } : {}) };
}

/** Greedy lane packing in baseline (fit-gene) screen-x. Group placed variants
 *  by `encoding.lane()` — items with the same key share a contiguous row
 *  block; items with different keys never share a row, even when their
 *  baseline-x positions don't overlap (strict lane separation). Within each
 *  group, sort by baseline-x and assign each item to the lowest local row
 *  whose previous occupant's right edge has cleared. Pack against baseline-x
 *  rather than the live screen-x so the row count stays stable across pan
 *  and zoom (deep zoom only spreads glyphs apart). */
export function packStackedVariants(
  placed: VariantPlacement[],
  encoding: SymbolEncoding<ViewerVariant>,
  viewport: Viewport,
  markRadius: number,
): VariantStackLayout {
  const baseline = viewport.baselineGeometry();
  const byExon = new Map<number, { xStart: number }>();
  for (const eb of baseline.exons) byExon.set(eb.exonIdx, { xStart: eb.xStart });

  const groups = new Map<string, VariantPlacement[]>();
  for (const p of placed) {
    const key = encoding.lane?.(p.variant) ?? '_';
    let arr = groups.get(key);
    if (!arr) {
      arr = [];
      groups.set(key, arr);
    }
    arr.push(p);
  }
  // Lane block order: declared `laneOrder` first, then any remaining
  // keys alphabetically. Deterministic across reloads, source orderings,
  // and gene changes so a given variant always lands on the same row.
  const groupOrder = orderedLaneKeysForVariants(groups, encoding.laneOrder);

  const placements: StackedVariantPlacement[] = [];
  let rowOffset = 0;
  for (const key of groupOrder) {
    const items = groups.get(key)!;
    const inputs = items.map((p) => {
      const exonStart = byExon.get(p.exonIdx)?.xStart ?? 0;
      const baselineX = exonStart + p.localX;
      const r = encoding.radius?.(p.variant) ?? markRadius;
      return {
        item: p,
        xStart: baselineX - r,
        xEnd: baselineX + r,
      };
    });
    // Primary: baseline-x. Secondary: variant.id — stable tie-break for
    // variants at the same baseline position.
    inputs.sort(
      (a, b) =>
        (a.xStart + a.xEnd) / 2 - (b.xStart + b.xEnd) / 2 ||
        cmpStr(a.item.variant.id, b.item.variant.id),
    );
    const packed = packLanes(inputs, 0);
    for (const p of packed.items) {
      placements.push({
        ...p.item,
        row: rowOffset + p.lane,
        laneKey: key,
      });
    }
    rowOffset += packed.laneCount;
  }
  return { rowCount: rowOffset, placements };
}

export function variantTrack(
  config: VariantTrackConfig,
): Track<VariantTrackConfig, VariantTrackData> {
  const id = config.id ?? 'variant-track';
  const trackHeight = config.height ?? DEFAULT_HEIGHT;
  const tickHalf = config.tickHalfHeight ?? DEFAULT_TICK_HALF;
  const dotRadius = config.dotRadius ?? DEFAULT_DOT_RADIUS;
  const source = config.source;
  const stackedEncoding = config.stackedVariantStyle;
  const stackMarkRadius = config.stackMarkRadius ?? dotRadius;
  const stackLanePx = config.stackLanePx ?? 2 * stackMarkRadius + 2;
  const stackTopPad = 2;
  const stackBottomPad = 2;

  const labelOf = (data: VariantTrackData, v: ViewerVariant): string => {
    const intronic = data.intronic?.get(v.id);
    return intronic ? `${v.label} (${intronic.hgvs})` : v.label;
  };

  return {
    id,
    label: config.label,
    coordSystem: 'cds',
    heightPolicy: stackedEncoding ? 'data-dependent' : 'fixed',

    async load({ viewport, mapper, signal }: TrackLoadArgs): Promise<VariantTrackData> {
      const variants = await resolveSourceData(
        source,
        { mode: viewport.mode, range: viewport.range },
        signal,
      );
      let stackLayout: VariantStackLayout | undefined;
      if (stackedEncoding) {
        const { placed } = partitionVariants(variants, viewport, mapper);
        stackLayout = packStackedVariants(placed, stackedEncoding, viewport, stackMarkRadius);
      }
      const intronic = new Map<string, { cds: CdsPosition; hgvs: string }>();
      for (const v of variants) {
        if (v.coord.kind === 'protein') continue;
        const cds = mapper.resolveTranscript(v.coord);
        if (cds && cds.offset !== 0) {
          intronic.set(v.id, { cds, hgvs: formatCdsPosition(cds, mapper.transcript.cdsLength) });
        }
      }
      return { variants, stackLayout, intronic };
    },

    height({ data }: TrackHeightArgs<VariantTrackData>): TrackHeightResult {
      if (stackedEncoding) {
        const rows = data?.stackLayout?.rowCount ?? 0;
        const px = Math.max(trackHeight, stackTopPad + rows * stackLanePx + stackBottomPad);
        return { px, didTruncate: false };
      }
      return { px: trackHeight, didTruncate: false };
    },

    hiddenFeaturesByIntron({
      data,
      viewport,
      mapper,
    }: HiddenFeaturesArgs<VariantTrackData>): HiddenFeatureBucket[] {
      // Intronic variants the figure does not draw (protein mode has no
      // place for them) are counted per intron, and the exon track shows
      // the counts on the collapsed introns.
      const byKey = new Map<string, HiddenFeatureBucket>();
      for (const v of data.variants) {
        const gap = variantIntronGap(v, mapper);
        if (!gap || placeVariant(v, viewport)) continue;
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
      const { data, rect, viewport, mapper, interaction, painter, onFeatureHover, onFeatureClick } =
        args;
      const brush = interaction.brushRange;
      const inBrushIds = new Set<string>();
      if (brush) {
        const lo = Math.min(brush[0], brush[1]);
        const hi = Math.max(brush[0], brush[1]);
        for (const v of data.variants) {
          const r = variantRulerPos(v, viewport, mapper);
          if (r === null) continue;
          if (r >= lo && r <= hi) inBrushIds.add(v.id);
        }
      }

      if (stackedEncoding) {
        // Stacked render: data.stackLayout is pre-packed in load(). On the
        // first paint before load() resolves stackLayout may be missing
        // (data was constructed elsewhere), so fall back to live packing.
        const layout =
          data.stackLayout ??
          packStackedVariants(
            partitionVariants(data.variants, viewport, mapper).placed,
            stackedEncoding,
            viewport,
            stackMarkRadius,
          );
        return renderStackedVariants({
          id,
          layout,
          encoding: stackedEncoding,
          rect,
          markRadius: stackMarkRadius,
          laneHeight: stackLanePx,
          topPad: stackTopPad,
          interaction,
          inBrushIds,
          labelOf: (v) => labelOf(data, v),
          onFeatureHover,
          onFeatureClick,
          painter,
        });
      }

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
            inBrush: inBrushIds.has(p.variant.id),
            label: labelOf(data, p.variant),
            painter,
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
      const { data, viewport, mapper, interaction, trackName, onFeatureHover, onFeatureClick } =
        args;
      const partition = partitionVariants(data.variants, viewport, mapper);
      if (partition.unplaced.length === 0) return null;
      const where = trackName ? ` in ${trackName}` : '';
      return (
        <div className="vv-unplaced-variants" data-vv-track-id={id} data-testid={`${id}-unplaced`}>
          <span className="vv-unplaced-label">
            Unplaced{where} ({partition.unplaced.length})
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
                  title={labelOf(data, v)}
                  aria-label={trackName ? `${labelOf(data, v)}, ${trackName}` : undefined}
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
      // Anchored where the variant is drawn: UTR variants in the caps,
      // intronic ones on their exon edge.
      const placement = viewport.placePosition(v.coord);
      const x = placement && viewport.baselineXToScreen(placement.baselineX);
      return x === null || x === undefined ? null : { x, y: 0 };
    },

    resolveFeature(data, featureId) {
      return data.variants.find((v) => v.id === featureId) ?? null;
    },

    featureLabel(data, featureId) {
      const v = data.variants.find((x) => x.id === featureId);
      return v ? labelOf(data, v) : null;
    },

    toJSON() {
      return {
        id,
        label: config.label,
        source,
        height: trackHeight,
        tickHalfHeight: tickHalf,
        dotRadius,
        stackedVariantStyle: stackedEncoding,
        stackLanePx,
        stackMarkRadius,
      };
    },
  };
}

interface RenderStackedArgs {
  id: string;
  layout: VariantStackLayout;
  encoding: SymbolEncoding<ViewerVariant>;
  rect: { yTop: number; yBottom: number };
  markRadius: number;
  laneHeight: number;
  topPad: number;
  interaction: TrackRenderArgs<VariantTrackData>['interaction'];
  inBrushIds: ReadonlySet<string>;
  labelOf: (v: ViewerVariant) => string;
  onFeatureHover?: (featureId: string | null) => void;
  onFeatureClick?: (featureId: string) => void;
  painter: TrackRenderArgs<VariantTrackData>['painter'];
}

function renderStackedVariants(args: RenderStackedArgs): ReactNode {
  const {
    id,
    layout,
    encoding,
    rect,
    markRadius,
    laneHeight,
    topPad,
    interaction,
    inBrushIds,
    labelOf,
    onFeatureHover,
    onFeatureClick,
    painter,
  } = args;
  const byExon = new Map<number, StackedVariantPlacement[]>();
  for (const p of layout.placements) {
    let arr = byExon.get(p.exonIdx);
    if (!arr) {
      arr = [];
      byExon.set(p.exonIdx, arr);
    }
    arr.push(p);
  }

  const groups: ReactNode[] = [];
  for (const [exonIdx, placements] of byExon) {
    const inner = placements.map((p) => {
      const v = p.variant;
      const r = encoding.radius?.(v) ?? markRadius;
      // Row 0 sits at top of track + topPad + r so the first glyph just
      // clears the upper edge. Subsequent rows step downward by laneHeight.
      const cy = rect.yTop + topPad + r + p.row * laneHeight;
      const shape = encoding.shape(v);
      const fill = encoding.fill(v);
      const stroke = encoding.color?.(v) ?? fill;
      const d = glyphPath(shape, r);
      const isHovered = interaction.hoveredFeatureId === v.id;
      const isSelected = interaction.selectedFeatureIds.has(v.id);
      const inBrush = inBrushIds.has(v.id);
      const cls = [
        'vv-variant',
        'vv-variant-stacked',
        `vv-variant-${v.category}`,
        p.intronSide && 'is-intronic',
        onFeatureClick && 'is-clickable',
        isHovered && 'is-hovered',
        isSelected && 'is-selected',
        inBrush && 'is-in-brush',
      ]
        .filter(Boolean)
        .join(' ');
      const counterScale = `scaleX(calc(1 / var(--vv-exon-scale-x-${exonIdx}, 1)))`;
      return (
        <g
          key={v.id}
          className={cls}
          data-vv-feature-id={v.id}
          data-vv-category={v.category}
          data-vv-stack-row={p.row}
          data-vv-stack-lane={p.laneKey}
          data-vv-shape={shape}
          data-vv-intron-side={p.intronSide}
          transform={`translate(${p.localX} 0)`}
          onMouseEnter={onFeatureHover ? () => onFeatureHover(v.id) : undefined}
          onMouseLeave={onFeatureHover ? () => onFeatureHover(null) : undefined}
          onClick={onFeatureClick ? () => onFeatureClick(v.id) : undefined}
          tabIndex={0}
          role="button"
          aria-label={labelOf(v)}
        >
          <g className="vv-variant-inner">
            <g
              className="vv-variant-shape"
              style={{ transform: counterScale, transformOrigin: '0 0' }}
            >
              <g transform={`translate(0 ${cy})`}>
                {p.intronSide &&
                  painter.drawPath({
                    className: 'vv-variant-intron-mark',
                    d: intronMarkPath(p.intronSide, r + 1, 0),
                    fill: 'none',
                    stroke,
                    strokeWidth: 1.5,
                    vectorEffect: 'non-scaling-stroke',
                  })}
                <circle
                  className="vv-variant-ring"
                  cx={0}
                  cy={0}
                  r={r + 3}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={1.5}
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  className="vv-variant-glyph"
                  d={d}
                  fill={fill}
                  stroke="var(--vv-variant-dot-stroke, #ffffff)"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            </g>
          </g>
        </g>
      );
    });
    groups.push(
      painter.placeInExonGroup(
        exonIdx,
        <Fragment key={`variants-stacked-exon-${exonIdx}`}>{inner}</Fragment>,
      ),
    );
  }

  return (
    <g
      className="vv-variant-track vv-variant-track-stacked"
      data-vv-track-id={id}
      data-vv-stack-rows={layout.rowCount}
      key={id}
    >
      {groups}
    </g>
  );
}

interface RenderVariantArgs {
  placement: VariantPlacement;
  dotCy: number;
  tickTop: number;
  tickBottom: number;
  dotRadius: number;
  interaction: TrackRenderArgs<VariantTrackData>['interaction'];
  inBrush: boolean;
  label: string;
  painter: TrackRenderArgs<VariantTrackData>['painter'];
  onFeatureHover?: (featureId: string | null) => void;
  onFeatureClick?: (featureId: string) => void;
}

function renderVariant(args: RenderVariantArgs): ReactNode {
  const {
    placement,
    dotCy,
    tickTop,
    tickBottom,
    dotRadius,
    interaction,
    inBrush,
    label,
    painter,
    onFeatureHover,
    onFeatureClick,
  } = args;
  const v = placement.variant;
  const isHovered = interaction.hoveredFeatureId === v.id;
  const isSelected = interaction.selectedFeatureIds.has(v.id);
  const wrapperClass = [
    'vv-variant',
    `vv-variant-${v.category}`,
    placement.intronSide && 'is-intronic',
    onFeatureClick && 'is-clickable',
    isHovered && 'is-hovered',
    isSelected && 'is-selected',
    inBrush && 'is-in-brush',
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
      data-vv-intron-side={placement.intronSide}
      transform={`translate(${placement.localX} 0)`}
      onMouseEnter={onFeatureHover ? () => onFeatureHover(v.id) : undefined}
      onMouseLeave={onFeatureHover ? () => onFeatureHover(null) : undefined}
      onClick={onFeatureClick ? () => onFeatureClick(v.id) : undefined}
      tabIndex={0}
      role="button"
      aria-label={label}
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
        <g className="vv-variant-shape" style={{ transform: counterScale, transformOrigin: '0 0' }}>
          {placement.intronSide &&
            painter.drawPath({
              className: 'vv-variant-intron-mark',
              d: intronMarkPath(placement.intronSide, 0, tickTop, tickBottom),
              fill: 'none',
              stroke: color,
              strokeWidth: 1.5,
              vectorEffect: 'non-scaling-stroke',
            })}
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

function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function orderedLaneKeysForVariants<T>(
  groups: Map<string, T>,
  declared: readonly string[] | undefined,
): string[] {
  const allKeys = [...groups.keys()];
  if (!declared || declared.length === 0) return allKeys.slice().sort(cmpStr);
  const declaredSet = new Set(declared);
  const ordered = declared.filter((k) => groups.has(k));
  const leftovers = allKeys.filter((k) => !declaredSet.has(k)).sort(cmpStr);
  return [...ordered, ...leftovers];
}
