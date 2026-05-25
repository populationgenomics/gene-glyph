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

    height(args: TrackHeightArgs<ClinVarSummaryTrackData>): TrackHeightResult {
      // Butterfly view needs vertical room for two stacked sides; the
      // single-significance fallback (per-sig subgroups) is a compact
      // one-row sparkline. Grow by 3x only when there are ≥2 *directional*
      // (P/LP/LB/B) buckets — VUS/conflicting on their own don't trigger
      // butterfly since they aren't rendered there.
      const records = args.data?.records ?? [];
      const filtered = filter ? records.filter(filter) : records;
      const directional = new Set<string>();
      for (const r of filtered) {
        const s = r.significance;
        if (s === 'pathogenic') directional.add('p');
        else if (s === 'likely_pathogenic') directional.add('lp');
        else if (s === 'likely_benign') directional.add('lb');
        else if (s === 'benign') directional.add('b');
      }
      const isButterfly = directional.size >= 2;
      return { px: isButterfly ? trackHeight * 3 : trackHeight, didTruncate: false };
    },

    render(args: TrackRenderArgs<ClinVarSummaryTrackData>): ReactNode {
      const { data, rect, viewport, mapper } = args;
      const records = filter ? data.records.filter(filter) : data.records;
      const { placed } = placeClinVarRecords(records, viewport, mapper);
      const width = viewport.width;
      const binCount = Math.max(1, Math.ceil(width / binPx));

      // One stack band per significance, ordered bottom-to-top from least to
      // most pathogenic. `other` records are lumped with VUS (no clinical
      // direction). Conflicting sits between VUS and LP, matching the
      // SIGNIFICANCE_RANK ordering used elsewhere.
      const benRaw = new Int32Array(binCount);
      const lbRaw = new Int32Array(binCount);
      const vusRaw = new Int32Array(binCount);
      const confRaw = new Int32Array(binCount);
      const lpRaw = new Int32Array(binCount);
      const pathRaw = new Int32Array(binCount);
      let placedInWindow = 0;

      for (const p of placed) {
        if (!Number.isFinite(p.screenX)) continue;
        if (p.screenX < 0 || p.screenX > width) continue;
        const bin = Math.min(binCount - 1, Math.floor(p.screenX / binPx));
        const sig = p.record.significance;
        if (sig === 'pathogenic') pathRaw[bin]!++;
        else if (sig === 'likely_pathogenic') lpRaw[bin]!++;
        else if (sig === 'conflicting') confRaw[bin]!++;
        else if (sig === 'uncertain_significance' || sig === 'other') vusRaw[bin]!++;
        else if (sig === 'likely_benign') lbRaw[bin]!++;
        else if (sig === 'benign') benRaw[bin]!++;
        placedInWindow++;
      }

      if (placedInWindow === 0) return null;

      // 5-bin binomial kernel (1-4-6-4-1) — wider than the original 1-2-1
      // pass so regional bias dominates over single-bin noise. Operates on
      // either Int32Array (raw counts) or Float32Array (already smoothed),
      // so it can be applied iteratively to build the heavily-smoothed
      // prior used for VUS attribution below.
      const smooth = (raw: Int32Array | Float32Array): Float32Array => {
        const out = new Float32Array(binCount);
        const get = (i: number) => (i < 0 || i >= binCount ? 0 : raw[i]!);
        for (let i = 0; i < binCount; i++) {
          out[i] =
            (get(i - 2) + 4 * get(i - 1) + 6 * get(i) + 4 * get(i + 1) + get(i + 2)) /
            16;
        }
        return out;
      };
      const benS = smooth(benRaw);
      const lbS = smooth(lbRaw);
      const vusS = smooth(vusRaw);
      const confS = smooth(confRaw);
      const lpS = smooth(lpRaw);
      const pathS = smooth(pathRaw);

      // Build a smooth area whose top edge tracks `cum`, anchored to
      // `baseline`. `direction = 'up'` draws above the baseline (smaller y);
      // `'down'` draws below it (larger y).
      const buildRibbon = (
        cum: Float32Array,
        saturation: number,
        maxH: number,
        baseline: number,
        direction: 'up' | 'down',
      ): { area: string; line: string } | null => {
        const sign = direction === 'up' ? -1 : 1;
        const clampSide = direction === 'up' ? 'above' : 'below';
        const points: { x: number; y: number }[] = [];
        points.push({ x: -binPx * 0.5, y: baseline });
        let nonzero = false;
        for (let i = 0; i < binCount; i++) {
          const x = (i + 0.5) * binPx;
          const h = Math.min(1, cum[i]! / saturation) * maxH;
          if (h > 0) nonzero = true;
          points.push({ x, y: baseline + sign * h });
        }
        points.push({ x: width + binPx * 0.5, y: baseline });
        if (!nonzero) return null;
        const spline = buildSmoothSpline(points, baseline, clampSide);
        if (!spline) return null;
        const last = points[points.length - 1]!;
        const first = points[0]!;
        const area =
          spline + ` L ${last.x} ${baseline} L ${first.x} ${baseline} Z`;
        return { area, line: spline };
      };

      const hasOwn = (own: Int32Array): boolean => {
        for (let i = 0; i < binCount; i++) if (own[i]! > 0) return true;
        return false;
      };

      // Pick a render mode based on how many directional buckets are active.
      // VUS / conflicting are not visualised in the butterfly (their spatial
      // distribution can diverge from the directional calls), so they only
      // matter for the per-sig-subgroup fallback where the host filter has
      // narrowed the data to one of them.
      const allBuckets: {
        raw: Int32Array;
        smoothed: Float32Array;
        sig: ClinVarSignificance;
      }[] = [
        { raw: pathRaw, smoothed: pathS, sig: 'pathogenic' },
        { raw: lpRaw, smoothed: lpS, sig: 'likely_pathogenic' },
        { raw: vusRaw, smoothed: vusS, sig: 'uncertain_significance' },
        { raw: confRaw, smoothed: confS, sig: 'conflicting' },
        { raw: lbRaw, smoothed: lbS, sig: 'likely_benign' },
        { raw: benRaw, smoothed: benS, sig: 'benign' },
      ];
      const activeBuckets = allBuckets.filter(({ raw }) => hasOwn(raw));
      const directionalBuckets = activeBuckets.filter(({ sig }) =>
        sig === 'pathogenic' ||
        sig === 'likely_pathogenic' ||
        sig === 'likely_benign' ||
        sig === 'benign',
      );

      // Single-ribbon mode: render a lone directional bucket if present, or
      // a lone non-directional bucket if the host filter narrowed the data
      // to just VUS or just conflicting (per-sig subgroups in live-data-demo).
      let soloBucket: (typeof activeBuckets)[number] | null = null;
      if (directionalBuckets.length === 1) {
        soloBucket = directionalBuckets[0]!;
      } else if (
        directionalBuckets.length === 0 &&
        activeBuckets.length === 1
      ) {
        soloBucket = activeBuckets[0]!;
      }

      if (soloBucket) {
        let maxC = 0;
        for (let i = 0; i < binCount; i++) {
          if (soloBucket.smoothed[i]! > maxC) maxC = soloBucket.smoothed[i]!;
        }
        const saturation = Math.max(1, Math.min(SATURATION_COUNT, maxC));
        const yBaseline = rect.yBottom - 1;
        const trackHeightVal = rect.yBottom - rect.yTop - 2;
        const built = buildRibbon(
          soloBucket.smoothed,
          saturation,
          Math.max(1, trackHeightVal - 1),
          yBaseline,
          'up',
        );
        if (!built) return null;
        const color = clinVarSignificanceColor(soloBucket.sig);
        return (
          <g
            className="vv-clinvar-summary-track"
            data-vv-track-id={id}
            data-testid={`gene-glyph-track-${id}`}
            data-vv-track-kind="clinvar-summary"
            data-vv-bin-px={binPx}
            key={id}
          >
            <g
              key={soloBucket.sig}
              className={`vv-clinvar-summary-cell vv-clinvar-summary-${soloBucket.sig}`}
              data-vv-significance={soloBucket.sig}
            >
              <path d={built.area} fill={color} fillOpacity={1} />
              <path d={built.line} fill="none" stroke={color} strokeWidth={1.5} />
            </g>
          </g>
        );
      }

      // Fewer than two directional buckets present and no clean single-sig
      // fallback to take. Nothing meaningful to render.
      if (directionalBuckets.length < 2) return null;

      // Pure directional butterfly — VUS and conflicting are intentionally
      // dropped from the rendering. They aren't necessarily spatially
      // co-distributed with the directional calls (in BRCA1, for example,
      // they cluster differently), so attributing them to P/LP/LB/B via a
      // local prior would put colour where the data doesn't justify it. The
      // honest view shows only what's been clinically resolved.
      const yCenter = (rect.yTop + rect.yBottom) / 2;
      const halfHeight = Math.max(1, (rect.yBottom - rect.yTop) / 2 - 1);

      // Cumulatives from the directional smoothed signal.
      const cumLpUp = new Float32Array(binCount);
      const cumPathUp = new Float32Array(binCount);
      const cumLbDn = new Float32Array(binCount);
      const cumBenDn = new Float32Array(binCount);
      let maxCum = 0;
      for (let i = 0; i < binCount; i++) {
        cumLpUp[i] = lpS[i]!;
        cumPathUp[i] = lpS[i]! + pathS[i]!;
        cumLbDn[i] = lbS[i]!;
        cumBenDn[i] = lbS[i]! + benS[i]!;
        if (cumPathUp[i]! > maxCum) maxCum = cumPathUp[i]!;
        if (cumBenDn[i]! > maxCum) maxCum = cumBenDn[i]!;
      }
      // No directional data at all → render nothing. (VUS/conf-only datasets
      // are caught by the single-significance fallback when activeBuckets is
      // a single bucket; the two-or-more VUS/conf case falls through to here
      // and produces an empty summary, which is the honest answer.)
      if (maxCum === 0) return null;

      // Dynamic saturation = actual peak. Lets the tallest bin reach the
      // band edge and everything else scale proportionally.
      const saturation = maxCum;

      // Summary-track local override: LP/LB read as a blend of their
      // definitive call and VUS so the stack reads as a continuous
      // benign-uncertain-pathogenic gradient rather than discrete hues.
      const colorPath = clinVarSignificanceColor('pathogenic');
      const colorBen = clinVarSignificanceColor('benign');
      const colorVus = clinVarSignificanceColor('uncertain_significance');
      const colorLp = `color-mix(in oklab, ${colorPath} 50%, ${colorVus})`;
      const colorLb = `color-mix(in oklab, ${colorBen} 50%, ${colorVus})`;

      const children: ReactNode[] = [];

      // Painter's algo per side: P drawn first (largest cumulative), then
      // LP overpaints the lower portion. Mirror for the benign side.
      // A layer is skipped when its bucket is empty.
      const upperLayers: {
        cum: Float32Array;
        eff: Float32Array;
        sig: ClinVarSignificance;
        color: string;
      }[] = [
        { cum: cumPathUp, eff: pathS, sig: 'pathogenic', color: colorPath },
        { cum: cumLpUp, eff: lpS, sig: 'likely_pathogenic', color: colorLp },
      ];
      const hasEff = (eff: Float32Array): boolean => {
        for (let i = 0; i < binCount; i++) if (eff[i]! > 1e-6) return true;
        return false;
      };
      for (const { cum, eff, sig, color } of upperLayers) {
        if (!hasEff(eff)) continue;
        const built = buildRibbon(cum, saturation, halfHeight, yCenter, 'up');
        if (!built) continue;
        children.push(
          <g
            key={sig}
            className={`vv-clinvar-summary-cell vv-clinvar-summary-${sig}`}
            data-vv-significance={sig}
          >
            <path d={built.area} fill={color} fillOpacity={1} />
            <path d={built.line} fill="none" stroke={color} strokeWidth={1} />
          </g>,
        );
      }

      const lowerLayers: {
        cum: Float32Array;
        eff: Float32Array;
        sig: ClinVarSignificance;
        color: string;
      }[] = [
        { cum: cumBenDn, eff: benS, sig: 'benign', color: colorBen },
        { cum: cumLbDn, eff: lbS, sig: 'likely_benign', color: colorLb },
      ];
      for (const { cum, eff, sig, color } of lowerLayers) {
        if (!hasEff(eff)) continue;
        const built = buildRibbon(cum, saturation, halfHeight, yCenter, 'down');
        if (!built) continue;
        children.push(
          <g
            key={sig}
            className={`vv-clinvar-summary-cell vv-clinvar-summary-${sig}`}
            data-vv-significance={sig}
          >
            <path d={built.area} fill={color} fillOpacity={1} />
            <path d={built.line} fill="none" stroke={color} strokeWidth={1} />
          </g>,
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
          {children}
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

function buildSmoothSpline(
  points: { x: number; y: number }[],
  yBaseline: number,
  clampSide: 'above' | 'below' = 'above',
): string {
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

    // 'above' = curve sits above the baseline (smaller y in SVG); prevent
    // control points dipping below it. 'below' = mirror: curve sits below,
    // prevent control points rising above it.
    const clamp = clampSide === 'above'
      ? (y: number) => Math.min(yBaseline, y)
      : (y: number) => Math.max(yBaseline, y);
    const clampCp1y = clamp(cp1y);
    const clampCp2y = clamp(cp2y);

    d += ` C ${cp1x} ${clampCp1y}, ${cp2x} ${clampCp2y}, ${p2.x} ${p2.y}`;
  }

  return d;
}
