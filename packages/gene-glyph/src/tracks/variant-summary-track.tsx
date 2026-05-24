import { Fragment, type ReactNode } from 'react';
import { variantCategoryColor } from '../symbol-encoding.js';
import {
  isDataSource,
  type ExonBaseline,
  type Track,
  type TrackHeightArgs,
  type TrackHeightResult,
  type TrackLoadArgs,
  type TrackRenderArgs,
  type ViewerVariant,
  type ViewportQuery,
} from '../types.js';
import { partitionVariants, type VariantSource } from './variant-track.js';

export interface VariantSummaryTrackConfig {
  id?: string;
  source: VariantSource;
  /** Track height in px. Default 16. */
  height?: number;
  /** Tick stroke width. Default 1.5 (rendered with non-scaling-stroke). */
  strokeWidth?: number;
}

export interface VariantSummaryTrackData {
  variants: ViewerVariant[];
}

const DEFAULT_HEIGHT = 16;
const DEFAULT_STROKE = 1.5;

/**
 * One-row rug-plot summary of a variant set. Each placed variant emits a
 * single short vertical tick in its host exon, coloured by category via the
 * existing {@link variantCategoryColor}. No clustering, no lane packing —
 * dense regions read as a coloured rug at fit-gene, ticks separate at
 * deeper zoom. Designed to slot into a folded `TrackGroup.summaryTrack`
 * so a stacked variant detail track can recover its vertical real estate
 * without losing the "there are variants here" signal. RD-1110.
 */
export function variantSummaryTrack(
  config: VariantSummaryTrackConfig,
): Track<VariantSummaryTrackConfig, VariantSummaryTrackData> {
  const id = config.id ?? 'variant-summary-track';
  const trackHeight = config.height ?? DEFAULT_HEIGHT;
  const strokeWidth = config.strokeWidth ?? DEFAULT_STROKE;
  const source = config.source;

  return {
    id,
    coordSystem: 'cds',
    heightPolicy: 'fixed',

    async load({ viewport, signal }: TrackLoadArgs): Promise<VariantSummaryTrackData> {
      const variants = isDataSource<ViewportQuery, ViewerVariant[]>(source)
        ? await source.query({ mode: viewport.mode, range: viewport.range }, signal)
        : source.slice();
      return { variants };
    },

    height(_: TrackHeightArgs<VariantSummaryTrackData>): TrackHeightResult {
      return { px: trackHeight, didTruncate: false };
    },

    render(args: TrackRenderArgs<VariantSummaryTrackData>): ReactNode {
      const { data, rect, viewport, mapper, painter } = args;
      const { placed } = partitionVariants(data.variants, viewport, mapper);

      const baseline = viewport.baselineGeometry();
      const exonByIdx = new Map<number, ExonBaseline>();
      for (const eb of baseline.exons) exonByIdx.set(eb.exonIdx, eb);

      const y1 = rect.yTop + 1;
      const y2 = rect.yBottom - 1;

      const byExon = new Map<number, ReactNode[]>();
      for (const p of placed) {
        const exon = exonByIdx.get(p.exonIdx);
        if (!exon) continue;
        const color = variantCategoryColor(p.variant.category);
        let arr = byExon.get(p.exonIdx);
        if (!arr) {
          arr = [];
          byExon.set(p.exonIdx, arr);
        }
        arr.push(
          <line
            key={p.variant.id}
            className={`vv-variant-summary-tick vv-variant-${p.variant.category}`}
            data-vv-feature-id={p.variant.id}
            data-vv-category={p.variant.category}
            x1={p.localX}
            x2={p.localX}
            y1={y1}
            y2={y2}
            stroke={color}
            strokeWidth={strokeWidth}
            vectorEffect="non-scaling-stroke"
          />,
        );
      }

      const groups: ReactNode[] = [];
      for (const [exonIdx, ticks] of byExon) {
        groups.push(
          painter.placeInExonGroup(
            exonIdx,
            <Fragment key={`variant-summary-exon-${exonIdx}`}>{ticks}</Fragment>,
          ),
        );
      }

      return (
        <g
          className="vv-variant-summary-track"
          data-vv-track-id={id}
          data-testid={`gene-glyph-track-${id}`}
          data-vv-track-kind="variant-summary"
          key={id}
        >
          {groups}
        </g>
      );
    },

    toJSON() {
      return { id, source, height: trackHeight, strokeWidth };
    },
  };
}
