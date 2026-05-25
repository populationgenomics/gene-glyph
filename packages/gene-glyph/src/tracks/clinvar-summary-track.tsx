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

      // 1-2-1 smoothing kernel — gives the ribbons their organic curve.
      const smooth = (raw: Int32Array): Float32Array => {
        const out = new Float32Array(binCount);
        for (let i = 0; i < binCount; i++) {
          const v0 = i > 0 ? raw[i - 1]! : 0;
          const v1 = raw[i]!;
          const v2 = i < binCount - 1 ? raw[i + 1]! : 0;
          out[i] = v0 * 0.25 + v1 * 0.5 + v2 * 0.25;
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

      // Single-significance fallback: when the host narrows the data to one
      // significance (per-sig subgroups in the multi-row ClinVar layout),
      // the butterfly has no bias to show and would render asymmetric or
      // tiny. Detect this and emit the original single upward ribbon in the
      // significance's native colour, full band height.
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

      if (activeBuckets.length === 1) {
        const only = activeBuckets[0]!;
        let maxC = 0;
        for (let i = 0; i < binCount; i++) {
          if (only.smoothed[i]! > maxC) maxC = only.smoothed[i]!;
        }
        const saturation = Math.max(1, Math.min(SATURATION_COUNT, maxC));
        const yBaseline = rect.yBottom - 1;
        const trackHeightVal = rect.yBottom - rect.yTop - 2;
        const built = buildRibbon(
          only.smoothed,
          saturation,
          Math.max(1, trackHeightVal - 1),
          yBaseline,
          'up',
        );
        if (!built) return null;
        const color = clinVarSignificanceColor(only.sig);
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
              key={only.sig}
              className={`vv-clinvar-summary-cell vv-clinvar-summary-${only.sig}`}
              data-vv-significance={only.sig}
            >
              <path d={built.area} fill={color} fillOpacity={1} />
              <path d={built.line} fill="none" stroke={color} strokeWidth={1.5} />
            </g>
          </g>
        );
      }

      // Butterfly layout: pathogenic (P + LP) streams upward from a
      // centerline, benign (B + LB) streams downward. The visible asymmetry
      // = bias signal. VUS + conflicting collapse to a thin grey strip on
      // the centerline — present-but-non-directional, so they shouldn't
      // dominate the view the way a stacked rollup made them.
      const cumLpUp = new Float32Array(binCount); // lp alone
      const cumPathUp = new Float32Array(binCount); // lp + path
      const cumLbDn = new Float32Array(binCount); // lb alone
      const cumBenDn = new Float32Array(binCount); // lb + ben
      const neutralS = new Float32Array(binCount); // vus + conf

      let maxDir = 0;
      let maxNeutral = 0;
      for (let i = 0; i < binCount; i++) {
        cumLpUp[i] = lpS[i]!;
        cumPathUp[i] = lpS[i]! + pathS[i]!;
        cumLbDn[i] = lbS[i]!;
        cumBenDn[i] = lbS[i]! + benS[i]!;
        neutralS[i] = vusS[i]! + confS[i]!;
        if (cumPathUp[i]! > maxDir) maxDir = cumPathUp[i]!;
        if (cumBenDn[i]! > maxDir) maxDir = cumBenDn[i]!;
        if (neutralS[i]! > maxNeutral) maxNeutral = neutralS[i]!;
      }
      // Shared directional saturation so a region heavily skewed toward one
      // side reads taller than a balanced region.
      const saturationDir = Math.max(1, Math.min(SATURATION_COUNT, maxDir));
      const saturationNeutral = Math.max(1, Math.min(SATURATION_COUNT, maxNeutral));

      const yCenter = (rect.yTop + rect.yBottom) / 2;
      const halfHeight = Math.max(1, (rect.yBottom - rect.yTop) / 2 - 1);
      // Neutral strip is deliberately small — it's a "data present, no
      // direction" indicator, not the main signal. Cap at ~25% of half-band
      // or 2px, whichever is smaller.
      const neutralHalfMax = Math.min(2, halfHeight * 0.25);

      // Summary-track local override: LP/LB read as a blend of their
      // definitive call and VUS so the stack reads as a continuous
      // benign-uncertain-pathogenic gradient, rather than two pairs of
      // discrete hues. The neutral strip uses the global conflicting colour
      // (now grey) directly.
      const colorPath = clinVarSignificanceColor('pathogenic');
      const colorBen = clinVarSignificanceColor('benign');
      const colorVus = clinVarSignificanceColor('uncertain_significance');
      const colorLp = `color-mix(in oklab, ${colorPath} 50%, ${colorVus})`;
      const colorLb = `color-mix(in oklab, ${colorBen} 50%, ${colorVus})`;
      const colorNeutral = clinVarSignificanceColor('conflicting');

      const children: ReactNode[] = [];

      // Neutral strip drawn first — directional ribbons opaque-paint over it
      // where they exist, so the grey is only visible where it's the *only*
      // signal in a bin (which is exactly when the host needs to know
      // "data present, no clinical direction").
      if (maxNeutral > 0) {
        const up = buildRibbon(neutralS, saturationNeutral, neutralHalfMax, yCenter, 'up');
        const dn = buildRibbon(neutralS, saturationNeutral, neutralHalfMax, yCenter, 'down');
        if (up || dn) {
          children.push(
            <g
              key="neutral"
              className="vv-clinvar-summary-neutral"
              data-vv-neutral-strip="true"
            >
              {up && (
                <path d={up.area} fill={colorNeutral} fillOpacity={0.7} />
              )}
              {dn && (
                <path d={dn.area} fill={colorNeutral} fillOpacity={0.7} />
              )}
            </g>,
          );
        }
      }

      // Pathogenic side (above centerline). Painter's algo: P (largest
      // cumulative) drawn first, LP overpaints the lower part.
      const upperLayers: {
        cum: Float32Array;
        own: Int32Array;
        sig: ClinVarSignificance;
        color: string;
      }[] = [
        { cum: cumPathUp, own: pathRaw, sig: 'pathogenic', color: colorPath },
        { cum: cumLpUp, own: lpRaw, sig: 'likely_pathogenic', color: colorLp },
      ];
      for (const { cum, own, sig, color } of upperLayers) {
        if (!hasOwn(own)) continue;
        const built = buildRibbon(cum, saturationDir, halfHeight, yCenter, 'up');
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

      // Benign side (below centerline). Painter's algo: B drawn first, LB
      // overpaints the part closer to the centerline.
      const lowerLayers: {
        cum: Float32Array;
        own: Int32Array;
        sig: ClinVarSignificance;
        color: string;
      }[] = [
        { cum: cumBenDn, own: benRaw, sig: 'benign', color: colorBen },
        { cum: cumLbDn, own: lbRaw, sig: 'likely_benign', color: colorLb },
      ];
      for (const { cum, own, sig, color } of lowerLayers) {
        if (!hasOwn(own)) continue;
        const built = buildRibbon(cum, saturationDir, halfHeight, yCenter, 'down');
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
