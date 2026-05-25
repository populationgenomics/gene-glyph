import { type ReactNode } from 'react';
import { resolveSourceData } from '../data-source.js';
import {
  type Track,
  type TrackHeightArgs,
  type TrackHeightResult,
  type TrackLoadArgs,
  type TrackRenderArgs,
  type ViewportQuery,
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
const MIN_ALPHA = 0.18;
const MAX_ALPHA = 1.0;
/** Density at which a bin saturates to MAX_ALPHA. Chosen so a single record
 *  per 4-px bin reads as a faint wash and a handful of records per bin reads
 *  as fully saturated — at TP53 / BRCA1 zoom levels both ends of the scale
 *  are reachable. */
const SATURATION_COUNT = 6;

/** Ranking used to pick a bin's dominant significance. Lower rank wins —
 *  pathogenic beats every other call, conflicting trails the path/benign
 *  axis so a bin of conflicting calls still reads as conflicting, and
 *  `other` is the floor. Mirrors the clinvar-track cluster representative
 *  selection so the summary's hue matches what an expanded cluster would
 *  paint. */
const SIGNIFICANCE_RANK: Record<ClinVarSignificance, number> = {
  pathogenic: 0,
  likely_pathogenic: 1,
  conflicting: 2,
  uncertain_significance: 3,
  likely_benign: 4,
  benign: 5,
  other: 6,
};

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

      // Per-bin counts + a per-bin best (lowest-rank) significance. Off-
      // screen placements carry screenX = Infinity; skip them so they
      // don't pile into a synthetic last bin past the right edge.
      const counts = new Int32Array(binCount);
      const sigs: (ClinVarSignificance | null)[] = new Array(binCount).fill(null);
      let maxCount = 0;
      for (const p of placed) {
        if (!Number.isFinite(p.screenX)) continue;
        if (p.screenX < 0 || p.screenX > width) continue;
        const bin = Math.min(binCount - 1, Math.floor(p.screenX / binPx));
        counts[bin] = (counts[bin] ?? 0) + 1;
        const cur = sigs[bin];
        if (cur === null || SIGNIFICANCE_RANK[p.record.significance] < SIGNIFICANCE_RANK[cur]) {
          sigs[bin] = p.record.significance;
        }
        if (counts[bin]! > maxCount) maxCount = counts[bin]!;
      }

      const saturation = Math.max(SATURATION_COUNT, maxCount);
      const rectNodes: ReactNode[] = [];
      for (let i = 0; i < binCount; i++) {
        const c = counts[i] ?? 0;
        if (c === 0) continue;
        const sig = sigs[i];
        if (!sig) continue;
        const alpha = MIN_ALPHA + (MAX_ALPHA - MIN_ALPHA) * Math.min(1, c / saturation);
        rectNodes.push(
          <rect
            key={i}
            className={`vv-clinvar-summary-cell vv-clinvar-summary-${sig}`}
            data-vv-bin={i}
            data-vv-bin-count={c}
            data-vv-significance={sig}
            x={i * binPx}
            y={rect.yTop + 1}
            width={binPx}
            height={Math.max(1, rect.yBottom - rect.yTop - 2)}
            fill={clinVarSignificanceColor(sig)}
            fillOpacity={alpha}
          />,
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
          {rectNodes}
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
