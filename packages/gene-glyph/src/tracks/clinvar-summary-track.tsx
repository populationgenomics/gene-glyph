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
/** Density at which a bin saturates. Chosen so a single record
 *  per 4-px bin reads as a faint wash and a handful of records per bin reads
 *  as fully saturated — at TP53 / BRCA1 zoom levels both ends of the scale
 *  are reachable. */
const SATURATION_COUNT = 6;

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

      // 1. Identify which significance categories have records in the visible screen window
      const activeSigs = new Set<ClinVarSignificance>();
      for (const p of placed) {
        if (!Number.isFinite(p.screenX)) continue;
        if (p.screenX < 0 || p.screenX > width) continue;
        activeSigs.add(p.record.significance);
      }

      // If no records are placed, render nothing
      if (placed.length === 0 || activeSigs.size === 0) return null;

      // 2. Find the global maxCount across all bins and significances to establish standard saturation scaling
      const globalCounts = new Int32Array(binCount);
      for (const p of placed) {
        if (!Number.isFinite(p.screenX)) continue;
        if (p.screenX < 0 || p.screenX > width) continue;
        const bin = Math.min(binCount - 1, Math.floor(p.screenX / binPx));
        globalCounts[bin] = (globalCounts[bin] ?? 0) + 1;
      }
      let maxCount = 0;
      for (let i = 0; i < binCount; i++) {
        if (globalCounts[i]! > maxCount) maxCount = globalCounts[i]!;
      }
      // Dynamic vertical scaling: when zoomed in and variants are sparse (e.g. maxCount = 1 or 2),
      // we scale down the saturation cap (down to a minimum of 1) so individual peaks remain beautifully
      // tall and clearly visible at deep zoom levels. When zoomed out, we clamp the saturation cap
      // to at least SATURATION_COUNT (6) to prevent a massive hotspot from flattening the rest of the gene.
      const saturation = Math.max(1, Math.min(SATURATION_COUNT, maxCount));

      // 3. For each active significance, render a gorgeous smooth sparkline density spline
      const sparklines: ReactNode[] = [];
      const yBaseline = rect.yBottom - 1;
      const trackHeightVal = rect.yBottom - rect.yTop - 2;

      for (const sig of activeSigs) {
        const sigCounts = new Int32Array(binCount);
        for (const p of placed) {
          if (p.record.significance !== sig) continue;
          if (!Number.isFinite(p.screenX)) continue;
          if (p.screenX < 0 || p.screenX > width) continue;
          const bin = Math.min(binCount - 1, Math.floor(p.screenX / binPx));
          sigCounts[bin] = (sigCounts[bin] ?? 0) + 1;
        }

        // Apply a moving average (Gaussian-like) smooth kernel on counts to make the curve organic
        const smoothed = new Float32Array(binCount);
        for (let i = 0; i < binCount; i++) {
          const val0 = i > 0 ? sigCounts[i - 1]! : 0;
          const val1 = sigCounts[i]!;
          const val2 = i < binCount - 1 ? sigCounts[i + 1]! : 0;
          smoothed[i] = val0 * 0.25 + val1 * 0.5 + val2 * 0.25;
        }

        const points: { x: number; y: number }[] = [];
        // Add left padding point anchored to baseline
        points.push({ x: -binPx * 0.5, y: yBaseline });

        for (let i = 0; i < binCount; i++) {
          const x = (i + 0.5) * binPx;
          const h = Math.min(1, smoothed[i]! / saturation) * (trackHeightVal - 1);
          points.push({ x, y: yBaseline - h });
        }

        // Add right padding point anchored to baseline
        points.push({ x: width + binPx * 0.5, y: yBaseline });

        const spline = buildSmoothSpline(points, yBaseline);
        if (!spline) continue;

        const fillD = spline + ` L ${points[points.length - 1]!.x} ${yBaseline} L ${points[0]!.x} ${yBaseline} Z`;
        const color = clinVarSignificanceColor(sig);

        // Render both the beautiful filled area and outline path
        sparklines.push(
          <g
            key={sig}
            className={`vv-clinvar-summary-cell vv-clinvar-summary-${sig}`}
            data-vv-significance={sig}
          >
            <path
              d={fillD}
              fill={color}
              fillOpacity={0.22}
            />
            <path
              d={spline}
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
