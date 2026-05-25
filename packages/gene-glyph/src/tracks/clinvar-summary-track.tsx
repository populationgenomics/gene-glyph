import { type ReactNode } from 'react';
import { resolveSourceData } from '../data-source.js';
import {
  type Track,
  type TrackHeightArgs,
  type TrackHeightResult,
  type TrackLoadArgs,
  type TrackRenderArgs,
} from '../types.js';
import {
  clinVarSignificanceColor,
  placeClinVarRecords,
  type ClinVarRecord,
  type ClinVarSignificance,
  type ClinVarSource,
} from './clinvar-track.js';

export interface ClinVarSummaryTrackConfig {
  id?: string;
  source: ClinVarSource;
  /** Track height in px. Default 18. */
  height?: number;
  /** Bin width in *screen* pixels. Default 4. Smaller bins reveal more
   *  local structure; larger bins read as smoother density. */
  binPx?: number;
  /** Optional predicate applied to the loaded record set before binning.
   *  Mirrors `clinVarTrack`'s host-supplied filter so the same chip /
   *  toggle UI can narrow both the detail and the summary view
   *  consistently (RD-1110). */
  filter?: (record: ClinVarRecord) => boolean;
}

export interface ClinVarSummaryTrackData {
  records: ClinVarRecord[];
}

const DEFAULT_HEIGHT = 18;
const DEFAULT_BIN_PX = 4;

const CLINVAR_SIGNIFICANCE_ORDER: ClinVarSignificance[] = [
  'benign',
  'likely_benign',
  'uncertain_significance',
  'conflicting',
  'likely_pathogenic',
  'pathogenic',
  'other',
];

/**
 * One-row density heat-strip for ClinVar records. Bins the figure's visible
 * width into fixed-screen-pixel cells (default 4 px); each cell's fill
 * saturation encodes record density within the bin, hue encodes the
 * strongest clinical significance present. Carries the same `filter`
 * predicate as `clinVarTrack` so the host can narrow both the detail and
 * summary views with one toggle. RD-1110.
 */
export function clinVarSummaryTrack(
  config: ClinVarSummaryTrackConfig,
): Track<ClinVarSummaryTrackConfig, ClinVarSummaryTrackData> {
  const id = config.id ?? 'clinvar-summary-track';
  const trackHeight = config.height ?? DEFAULT_HEIGHT;
  const binPx = Math.max(1, config.binPx ?? DEFAULT_BIN_PX);
  const source = config.source;
  const filter = config.filter;

  return {
    id,
    coordSystem: 'genomic',
    heightPolicy: 'fixed',

    async load({ viewport, signal }: TrackLoadArgs): Promise<ClinVarSummaryTrackData> {
      const records = await resolveSourceData(
        source,
        { mode: viewport.mode, range: viewport.range },
        signal,
      );
      return { records };
    },

    height(_: TrackHeightArgs<ClinVarSummaryTrackData>): TrackHeightResult {
      return { px: trackHeight, didTruncate: false };
    },

    render(args: TrackRenderArgs<ClinVarSummaryTrackData>): ReactNode {
      const { data, rect, viewport, mapper } = args;
      const records = filter ? data.records.filter(filter) : data.records;
      const { placed } = placeClinVarRecords(records, viewport, mapper);
      const width = viewport.width;
      const binCount = Math.max(1, Math.ceil(width / binPx));

      // 1. Identify active significance categories and their counts per bin
      const binCounts: Record<ClinVarSignificance, Int32Array> = {} as any;
      for (const sig of CLINVAR_SIGNIFICANCE_ORDER) {
        binCounts[sig] = new Int32Array(binCount);
      }

      let hasData = false;
      for (const p of placed) {
        if (!Number.isFinite(p.screenX)) continue;
        if (p.screenX < 0 || p.screenX > width) continue;
        const bin = Math.min(binCount - 1, Math.floor(p.screenX / binPx));
        const sig = p.record.significance;
        if (binCounts[sig]) {
          binCounts[sig][bin]++;
          hasData = true;
        }
      }

      // If no records are placed, render nothing
      if (!hasData) return null;

      // 2. Apply moving average (Gaussian-like) smoothing to the counts of each category
      const smoothedCounts: Record<ClinVarSignificance, Float32Array> = {} as any;
      for (const sig of CLINVAR_SIGNIFICANCE_ORDER) {
        const counts = binCounts[sig];
        const smoothed = new Float32Array(binCount);
        for (let i = 0; i < binCount; i++) {
          const val0 = i > 0 ? counts[i - 1]! : 0;
          const val1 = counts[i]!;
          const val2 = i < binCount - 1 ? counts[i + 1]! : 0;
          smoothed[i] = val0 * 0.25 + val1 * 0.5 + val2 * 0.25;
        }
        smoothedCounts[sig] = smoothed;
      }

      // 3. Compute cumulative heights at each bin and find the local max stacked sum for dynamic Y auto-scaling
      const stackedHeights = new Float32Array(binCount);
      for (let i = 0; i < binCount; i++) {
        let sum = 0;
        for (const sig of CLINVAR_SIGNIFICANCE_ORDER) {
          sum += smoothedCounts[sig][i];
        }
        stackedHeights[i] = sum;
      }

      let maxStackedSum = 0;
      for (let i = 0; i < binCount; i++) {
        if (stackedHeights[i] > maxStackedSum) {
          maxStackedSum = stackedHeights[i];
        }
      }

      // Auto-scale saturation based on maximum stacked height, minimum of 1.0 (to avoid division by zero and handle low density beautifully)
      const saturation = Math.max(1, maxStackedSum);

      // 4. Render each significance category as a stacked ribbon from bottom to top
      const sparklines: ReactNode[] = [];
      const yBaseline = rect.yBottom - 1;
      const trackHeightVal = rect.yBottom - rect.yTop - 2;

      // Track the cumulative height from the bottom up
      const currentBottomHeights = new Float32Array(binCount);

      for (const sig of CLINVAR_SIGNIFICANCE_ORDER) {
        const smoothed = smoothedCounts[sig];

        // Skip categories that have no data in the current view
        let sigHasData = false;
        for (let i = 0; i < binCount; i++) {
          if (smoothed[i] > 0) {
            sigHasData = true;
            break;
          }
        }
        if (!sigHasData) continue;

        // Build top and bottom points for the current ribbon
        const topPoints: { x: number; y: number }[] = [];
        const bottomPoints: { x: number; y: number }[] = [];

        // Left padding point anchored to baseline
        topPoints.push({ x: -binPx * 0.5, y: yBaseline });
        bottomPoints.push({ x: -binPx * 0.5, y: yBaseline });

        for (let i = 0; i < binCount; i++) {
          const x = (i + 0.5) * binPx;
          const hBottom = (currentBottomHeights[i] / saturation) * (trackHeightVal - 1);
          const hTop = ((currentBottomHeights[i] + smoothed[i]) / saturation) * (trackHeightVal - 1);

          bottomPoints.push({ x, y: yBaseline - hBottom });
          topPoints.push({ x, y: yBaseline - hTop });

          // Update current bottom height for the next category
          currentBottomHeights[i] += smoothed[i];
        }

        // Right padding point anchored to baseline
        topPoints.push({ x: width + binPx * 0.5, y: yBaseline });
        bottomPoints.push({ x: width + binPx * 0.5, y: yBaseline });

        // Calculate curves
        const splineTop = buildSmoothSpline(topPoints, yBaseline);
        const bottomPointsReversed = [...bottomPoints].reverse();
        const splineBottomReversed = buildSmoothSpline(bottomPointsReversed, yBaseline);

        if (!splineTop || !splineBottomReversed) continue;

        const fillD = splineTop + ' L' + splineBottomReversed.substring(1) + ' Z';
        const color = clinVarSignificanceColor(sig);

        sparklines.push(
          <g
            key={sig}
            className={`vv-clinvar-summary-cell vv-clinvar-summary-${sig}`}
            data-vv-significance={sig}
          >
            <path
              d={fillD}
              fill={color}
              fillOpacity={0.4}
            />
            <path
              d={splineTop}
              fill="none"
              stroke={color}
              strokeWidth={1.5}
            />
          </g>
        );
      }

      return (
        <g
          className="vv-clinvar-summary-track"
          data-vv-track-id={id}
          data-testid={`gene-glyph-track-${id}`}
          data-vv-track-kind="clinvar-summary"
          data-vv-bin-px={binPx}
          key={id}
        >
          {sparklines}
        </g>
      );
    },

    resolveFeature(data, featureId) {
      return data.records.find((r) => r.id === featureId) ?? null;
    },

    toJSON() {
      return { id, source, height: trackHeight, binPx };
    },
  };
}

function buildSmoothSpline(points: { x: number; y: number }[], yBaseline: number): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  let d = `M ${points[0].x} ${points[0].y}`;
  const tension = 0.25;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;

    const cp1x = p1.x + (p2.x - p0.x) * tension;
    const cp1y = p1.y + (p2.y - p0.y) * tension;

    const cp2x = p2.x - (p3.x - p1.x) * tension;
    const cp2y = p2.y - (p3.y - p1.y) * tension;

    const clampCp1y = Math.min(yBaseline, cp1y);
    const clampCp2y = Math.min(yBaseline, cp2y);

    d += ` C ${cp1x} ${clampCp1y}, ${cp2x} ${clampCp2y}, ${p2.x} ${p2.y}`;
  }

  return d;
}
