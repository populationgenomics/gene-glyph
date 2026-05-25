import { Fragment, type CSSProperties, type ReactNode } from 'react';
import type {
  CoordSystem,
  CoordinateMapper,
  ExonBaseline,
  Track,
  TrackHeightArgs,
  TrackHeightResult,
  TrackLoadArgs,
  TrackRenderArgs,
  Viewport,
} from '../types.js';
import { livePxPerUnit } from './nucleotide-track.js';

/** One sample on the position axis. `position` is in the track's
 *  declared `coordSystem` (1-indexed CDS bp or aa); `value` is the raw
 *  signal at that position. */
export interface ProfileDatum {
  position: number;
  value: number;
}

/** Source can be an eager array (best for dense fixtures the host has
 *  already in hand) or a callable for sparse / on-demand signals.
 *  Callables return `null` when a position has no sample — those
 *  positions are skipped by aggregation. */
export type ProfileSource =
  | ReadonlyArray<ProfileDatum>
  | ((position: number) => number | null);

/** Maps a value into a CSS colour. `domain` is the [min, max] of the
 *  resolved yScale so hosts can build palette functions without
 *  threading the domain through separately. */
export type ColorRamp = (value: number, domain: readonly [number, number]) => string;

export type ProfileRender = 'histogram' | 'heatmap';

export type ProfileAggregate = 'max' | 'mean' | 'sum';

export type ProfileYScale =
  | 'linear'
  | 'log'
  | {
      domain: readonly [number, number];
      scale?: 'linear' | 'log';
    };

export interface ProfileTrackConfig {
  id?: string;
  /** Per-position samples in `coordSystem` units. */
  source: ProfileSource;
  /** `'cds'` (positions = CDS bp, 1-indexed) or `'protein'` (positions
   *  = aa, 1-indexed). The track maps positions to baseline-x via the
   *  active viewport mode, so a protein-coord source still renders
   *  correctly in CDS modes (mapped to codon-centre bp). */
  coordSystem: CoordSystem;
  /** Visual primitive. Histogram = area-fill on the position axis.
   *  Heatmap = full-height colour bands. */
  render: ProfileRender;
  /** Track band height in pixels. Default 24. */
  heightPx?: number;
  /** Vertical pixels reserved above the track during layout. Stacked
   *  profile tracks otherwise share an edge — a histogram whose
   *  tallest bars reach the band top visually merges into a heatmap
   *  directly above it. Default 0. */
  gapAbove?: number;
  /** Colour ramp. Required for `'heatmap'` (a viridis-shaped default
   *  ships if omitted). Ignored for `'histogram'` unless the host wants
   *  per-bar colour — pass a function that returns the bar fill. */
  colorRamp?: ColorRamp;
  /** Histogram bar-height mapping. Heatmap mode uses the resolved
   *  domain only for the colour ramp; bar geometry is full-height. */
  yScale?: ProfileYScale;
  /** Aggregation when several positions land in one display pixel.
   *  Defaults: `'max'` for heatmap (preserves peaks in the silhouette),
   *  `'sum'` for histogram (preserves total density). */
  aggregate?: ProfileAggregate;
  /** Position-axis length hint. For array sources this is inferred
   *  from the data's max position; for callable sources the host MUST
   *  provide it (otherwise we'd have to iterate every CDS bp to find
   *  the end). */
  length?: number;
  /** Histogram-only: stroke colour for the area outline. Default
   *  `null` (no stroke; just the fill). */
  histogramStroke?: string;
  /** Histogram-only: fill colour for the area. Defaults to a muted
   *  slate. Ignored when `colorRamp` is set (bars are then keyed by
   *  their aggregated value instead). */
  histogramFill?: string;
  /** Optional stroke colour for a thin frame rect drawn around the
   *  track band. Spans the full figure width (sits outside the per-
   *  exon transform groups so it doesn't slide with pan / zoom).
   *  Default `null` (no frame). */
  borderColor?: string;
}

export interface ProfileTrackData {
  /** Realised samples keyed by integer position. Empty for callable
   *  sources (the track looks them up at render time so the underlying
   *  callable can return live data). */
  byPosition: ReadonlyMap<number, number>;
  /** Maximum position seen — for array sources this is the data's max
   *  position; for callable sources this comes from `config.length`. */
  maxPosition: number;
  /** Auto-derived `[min, max]` over all observed values; used when the
   *  yScale config is `'linear'` or `'log'`. */
  autoDomain: readonly [number, number];
}

const DEFAULT_HEIGHT_PX = 24;

const VIRIDIS_STOPS = [
  '#440154',
  '#404387',
  '#29788e',
  '#22a784',
  '#79d151',
  '#fde724',
] as const;

/**
 * Slice 31 — per-position numeric signal as either a histogram (area-fill
 * keyed to a `yScale`) or a heatmap (colour bands keyed to a `colorRamp`).
 * Both visuals share one primitive: an aggregated bucket per visible
 * display pixel, so the silhouette of the underlying signal stays
 * faithful at every zoom level instead of aliasing into spikes.
 *
 * The aggregator picks an integer position step from the live
 * pixels-per-unit at render time — at deep zoom (≥ 1 px/unit) each
 * bucket is a single sample; at fit-gene zoom the bucket spans however
 * many positions land in one pixel column.
 */
export function profileTrack(
  config: ProfileTrackConfig,
): Track<ProfileTrackConfig, ProfileTrackData> {
  const id = config.id ?? `profile-${config.render}`;
  const heightPx = config.heightPx ?? DEFAULT_HEIGHT_PX;
  const aggregate = config.aggregate ?? (config.render === 'heatmap' ? 'max' : 'sum');
  const colorRamp = config.colorRamp ?? defaultViridis;
  const yScaleConfig: ProfileYScale = config.yScale ?? 'linear';
  const coordSystem = config.coordSystem;
  const renderKind = config.render;
  const histogramFill = config.histogramFill ?? '#64748b';
  const histogramStroke = config.histogramStroke;
  const borderColor = config.borderColor;

  return {
    id,
    coordSystem,
    heightPolicy: 'fixed',
    gapAbove: config.gapAbove,

    async load(_args: TrackLoadArgs): Promise<ProfileTrackData> {
      if (typeof config.source === 'function') {
        if (config.length === undefined) {
          throw new Error(
            'profileTrack: callable `source` requires `length` so the track ' +
              'knows where the position axis ends',
          );
        }
        // For callable sources we don't materialise — but we still
        // need an auto-domain for default yScale. Probe at every
        // position; the source can return `null` for absent samples.
        const fn = config.source;
        let lo = Infinity;
        let hi = -Infinity;
        for (let p = 1; p <= config.length; p++) {
          const v = fn(p);
          if (v === null || !Number.isFinite(v)) continue;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        if (!Number.isFinite(lo)) {
          lo = 0;
          hi = 0;
        }
        return {
          byPosition: new Map(),
          maxPosition: config.length,
          autoDomain: [lo, hi],
        };
      }
      const map = new Map<number, number>();
      let lo = Infinity;
      let hi = -Infinity;
      let maxPos = 0;
      for (const d of config.source) {
        if (!Number.isFinite(d.value)) continue;
        map.set(d.position, d.value);
        if (d.position > maxPos) maxPos = d.position;
        if (d.value < lo) lo = d.value;
        if (d.value > hi) hi = d.value;
      }
      if (!Number.isFinite(lo)) {
        lo = 0;
        hi = 0;
      }
      const explicitLen = config.length ?? maxPos;
      return {
        byPosition: map,
        maxPosition: Math.max(explicitLen, maxPos),
        autoDomain: [lo, hi],
      };
    },

    height(_args: TrackHeightArgs<ProfileTrackData>): TrackHeightResult {
      return { px: heightPx, didTruncate: false };
    },

    render(args: TrackRenderArgs<ProfileTrackData>): ReactNode {
      const { data, rect, viewport, mapper, painter } = args;
      const [posLo, posHi] = visibleTrackRange(viewport, coordSystem, data.maxPosition);

      const baseline = viewport.baselineGeometry();
      const exonByIdx = new Map<number, ExonBaseline>();
      for (const eb of baseline.exons) exonByIdx.set(eb.exonIdx, eb);

      const yTop = rect.yTop;
      const yBottom = rect.yBottom;
      const bandHeight = yBottom - yTop;

      // Axis line at the band's bottom edge, spanning the gene baseline
      // (first exon's left to last exon's right). Rendered via CSS
      // variables so it tracks pan / zoom alongside the exon ribbon, and
      // emitted unconditionally when `borderColor` is set — empty zoom
      // ranges with no buckets still show the axis so the histogram's
      // floor stays visible. Bars are shifted up by 1 px below so they
      // don't touch the line.
      const axisGap = borderColor ? 1 : 0;
      const histBaselineY = yBottom - axisGap;
      const axisLine =
        borderColor && baseline.exons.length > 0
          ? (() => {
              const first = baseline.exons[0]!;
              const last = baseline.exons[baseline.exons.length - 1]!;
              const lineStyle: CSSProperties = {
                x: `var(--vv-exon-x-${first.exonIdx}, 0px)`,
                width:
                  `calc(var(--vv-exon-x-${last.exonIdx}, 0px)` +
                  ` + ${last.width}px * var(--vv-exon-scale-x-${last.exonIdx}, 1)` +
                  ` - var(--vv-exon-x-${first.exonIdx}, 0px))`,
              } as unknown as CSSProperties;
              return (
                <rect
                  className="vv-profile-axis"
                  y={yBottom - 0.5}
                  height={1}
                  fill={borderColor}
                  style={lineStyle}
                  shapeRendering="crispEdges"
                  pointerEvents="none"
                />
              );
            })()
          : null;

      if (posHi < posLo) {
        return axisLine ? (
          <g
            className={`vv-profile-track vv-profile-${renderKind}`}
            data-vv-track-id={id}
            data-vv-profile-render={renderKind}
            key={id}
          >
            {axisLine}
          </g>
        ) : null;
      }

      const pxPerTrackUnit = livePxPerTrackUnit(viewport, coordSystem);
      const step = pickStep(pxPerTrackUnit);

      const sampleAt = sampleFn(config.source, data.byPosition);
      const buckets = bucketise({
        posLo,
        posHi,
        step,
        sampleAt,
        aggregate,
      });
      if (buckets.length === 0) {
        return axisLine ? (
          <g
            className={`vv-profile-track vv-profile-${renderKind}`}
            data-vv-track-id={id}
            data-vv-profile-render={renderKind}
            data-vv-profile-step={step}
            data-vv-profile-aggregate={aggregate}
            key={id}
          >
            {axisLine}
          </g>
        ) : null;
      }

      const { domain, scaleFn } = resolveYScale(yScaleConfig, data.autoDomain, buckets);

      // Group buckets by exon so per-exon CSS transforms can pan / zoom
      // the geometry without re-rendering individual <rect>/<path> nodes.
      const buckByExon = new Map<number, BucketWithGeom[]>();
      for (const b of buckets) {
        const exonIdx = findExonForTrackPos(b.center, coordSystem, viewport, mapper);
        if (exonIdx === null) continue;
        const eb = exonByIdx.get(exonIdx);
        if (!eb) continue;
        const x0Baseline = trackUnitToBaselineX(b.start - 0.5, coordSystem, viewport);
        const x1Baseline = trackUnitToBaselineX(b.end + 0.5, coordSystem, viewport);
        const xMin = Math.min(x0Baseline, x1Baseline);
        const xMax = Math.max(x0Baseline, x1Baseline);
        const arr = buckByExon.get(exonIdx) ?? [];
        arr.push({
          ...b,
          xLocal0: xMin - eb.xStart,
          xLocal1: xMax - eb.xStart,
        });
        buckByExon.set(exonIdx, arr);
      }

      const exonGroups: ReactNode[] = [];
      for (const [exonIdx, bucks] of buckByExon) {
        bucks.sort((a, b) => a.xLocal0 - b.xLocal0);
        const exonContent =
          renderKind === 'heatmap'
            ? renderHeatmapBuckets(bucks, yTop, bandHeight, colorRamp, domain, exonIdx)
            : renderHistogramBuckets(
                bucks,
                yTop,
                histBaselineY,
                scaleFn,
                domain,
                colorRamp,
                config.colorRamp !== undefined,
                histogramFill,
                histogramStroke,
                exonIdx,
              );
        exonGroups.push(
          painter.placeInExonGroup(
            exonIdx,
            <Fragment key={`profile-exon-${exonIdx}`}>{exonContent}</Fragment>,
          ),
        );
      }

      return (
        <g
          className={`vv-profile-track vv-profile-${renderKind}`}
          data-vv-track-id={id}
          data-vv-profile-render={renderKind}
          data-vv-profile-step={step}
          data-vv-profile-aggregate={aggregate}
          key={id}
        >
          {axisLine}
          {exonGroups}
        </g>
      );
    },

    toJSON() {
      return {
        id,
        source: config.source,
        coordSystem,
        render: renderKind,
        heightPx,
        gapAbove: config.gapAbove,
        colorRamp: config.colorRamp,
        yScale: yScaleConfig,
        aggregate,
        length: config.length,
        histogramStroke,
        histogramFill,
        borderColor,
      };
    },
  };
}

interface Bucket {
  start: number; // inclusive integer position
  end: number; // inclusive integer position
  center: number; // representative integer position (start)
  value: number;
}

interface BucketWithGeom extends Bucket {
  xLocal0: number;
  xLocal1: number;
}

interface BucketiseArgs {
  posLo: number;
  posHi: number;
  step: number;
  sampleAt: (pos: number) => number | null;
  aggregate: ProfileAggregate;
}

/** Walk integer positions in [posLo, posHi], grouping every `step`
 *  positions into one bucket. Buckets are emitted only when at least
 *  one position in their span has a sample. Exported for tests. */
export function bucketise({ posLo, posHi, step, sampleAt, aggregate }: BucketiseArgs): Bucket[] {
  if (step <= 0) return [];
  const out: Bucket[] = [];
  let cursor = posLo;
  while (cursor <= posHi) {
    const bStart = cursor;
    const bEnd = Math.min(posHi, cursor + step - 1);
    let acc: number | null = null;
    let count = 0;
    for (let p = bStart; p <= bEnd; p++) {
      const v = sampleAt(p);
      if (v === null || !Number.isFinite(v)) continue;
      count++;
      switch (aggregate) {
        case 'max':
          acc = acc === null ? v : Math.max(acc, v);
          break;
        case 'mean':
        case 'sum':
          acc = (acc ?? 0) + v;
          break;
      }
    }
    if (acc !== null) {
      const value = aggregate === 'mean' ? acc / Math.max(1, count) : acc;
      out.push({ start: bStart, end: bEnd, center: bStart, value });
    }
    cursor = bEnd + 1;
  }
  return out;
}

/** Pick the smallest integer step whose buckets average ≥ 1 display
 *  pixel of width. Below 1 px/unit (zoomed-out) we aggregate; at or
 *  above 1 px/unit each position renders as its own bucket. Exported
 *  for tests. */
export function pickStep(pxPerTrackUnit: number): number {
  if (pxPerTrackUnit >= 1) return 1;
  if (pxPerTrackUnit <= 0) return 1;
  return Math.max(1, Math.ceil(1 / pxPerTrackUnit));
}

function sampleFn(
  source: ProfileSource,
  byPos: ReadonlyMap<number, number>,
): (pos: number) => number | null {
  if (typeof source === 'function') return source;
  return (pos) => (byPos.has(pos) ? byPos.get(pos)! : null);
}

function visibleTrackRange(
  viewport: Viewport,
  coordSystem: CoordSystem,
  maxPosition: number,
): [number, number] {
  const [lo, hi] = viewport.range;
  if (viewport.mode === 'protein') {
    if (coordSystem === 'protein') {
      return [Math.max(1, Math.floor(lo)), Math.min(maxPosition, Math.ceil(hi))];
    }
    // Protein viewport but bp-coord track: convert aa→bp span.
    const bpLo = Math.max(1, Math.floor((lo - 1) * 3 + 1));
    const bpHi = Math.min(maxPosition, Math.ceil(hi * 3));
    return [bpLo, bpHi];
  }
  if (coordSystem === 'cds') {
    return [Math.max(1, Math.floor(lo)), Math.min(maxPosition, Math.ceil(hi))];
  }
  // CDS viewport but aa-coord track: bp span → aa span.
  const aaLo = Math.max(1, Math.ceil((lo - 2) / 3) + 1);
  const aaHi = Math.min(maxPosition, Math.floor((hi - 2) / 3) + 1);
  return [aaLo, aaHi];
}

/** Live pixels per *track* unit (CDS bp or aa, per the track's
 *  `coordSystem`). Layers on top of {@link livePxPerUnit} (which is
 *  viewport-mode-relative) to give a consistent per-track scale. */
function livePxPerTrackUnit(viewport: Viewport, coordSystem: CoordSystem): number {
  const px = livePxPerUnit(viewport);
  if (viewport.mode === 'protein') {
    // viewport reports px/aa; if the track is bp-coord, one bp = 1/3 aa.
    return coordSystem === 'cds' ? px / 3 : px;
  }
  // viewport reports px/bp; if the track is aa-coord, one aa = 3 bp.
  return coordSystem === 'protein' ? px * 3 : px;
}

function trackUnitToBaselineX(pos: number, coordSystem: CoordSystem, viewport: Viewport): number {
  if (viewport.mode === 'protein') {
    if (coordSystem === 'protein') return viewport.cdsToBaselineX(pos);
    // bp on aa axis: bp → aa (fractional)
    return viewport.cdsToBaselineX((pos - 1) / 3 + 1);
  }
  if (coordSystem === 'cds') return viewport.cdsToBaselineX(pos);
  // aa on bp axis: aa → bp centre
  return viewport.cdsToBaselineX((pos - 1) * 3 + 2);
}

function findExonForTrackPos(
  pos: number,
  coordSystem: CoordSystem,
  viewport: Viewport,
  mapper: CoordinateMapper,
): number | null {
  let cdsPos: number;
  if (coordSystem === 'protein') {
    cdsPos = mapper.proteinToCds(Math.round(pos));
  } else if (viewport.mode === 'protein') {
    // shouldn't really happen — coordSystem === 'cds' but visibleTrackRange
    // already mapped to bp; pass through.
    cdsPos = Math.round(pos);
  } else {
    cdsPos = Math.round(pos);
  }
  if (!Number.isFinite(cdsPos)) return null;
  const hit = mapper.findExonByCds(cdsPos);
  return hit?.exonIdx ?? null;
}

interface ResolvedScale {
  domain: readonly [number, number];
  scaleFn: (value: number, bandHeight: number) => number;
}

function resolveYScale(
  cfg: ProfileYScale,
  autoDomain: readonly [number, number],
  buckets: ReadonlyArray<Bucket>,
): ResolvedScale {
  let domain: [number, number];
  let scaleKind: 'linear' | 'log';
  if (cfg === 'linear' || cfg === 'log') {
    scaleKind = cfg;
    // Auto domain. For histogram we want the bucket-aggregated max
    // (sum / max etc), which can exceed the per-position max in the
    // raw autoDomain. Take the max of both so the bars fit the band.
    let lo = autoDomain[0];
    let hi = autoDomain[1];
    for (const b of buckets) {
      if (b.value < lo) lo = b.value;
      if (b.value > hi) hi = b.value;
    }
    // For 'linear' anchor the floor at 0 if the data is non-negative —
    // matches what readers expect of histograms; the spec calls for an
    // area-fill against a baseline at the row's midline so we need a
    // sensible non-negative domain.
    if (scaleKind === 'linear' && lo >= 0) lo = 0;
    domain = [lo, hi];
  } else {
    domain = [cfg.domain[0], cfg.domain[1]];
    scaleKind = cfg.scale ?? 'linear';
  }
  const [dLo, dHi] = domain;
  const safeLog = (v: number): number => Math.log(Math.max(1e-9, v));
  if (scaleKind === 'log') {
    const a = safeLog(Math.max(1e-9, dLo));
    const b = safeLog(Math.max(1e-9, dHi));
    return {
      domain,
      scaleFn: (value, bandHeight) => {
        if (b <= a) return 0;
        const t = (safeLog(Math.max(1e-9, value)) - a) / (b - a);
        return Math.max(0, Math.min(bandHeight, t * bandHeight));
      },
    };
  }
  return {
    domain,
    scaleFn: (value, bandHeight) => {
      if (dHi <= dLo) return 0;
      const t = (value - dLo) / (dHi - dLo);
      return Math.max(0, Math.min(bandHeight, t * bandHeight));
    },
  };
}

function renderHeatmapBuckets(
  buckets: BucketWithGeom[],
  yTop: number,
  bandHeight: number,
  colorRamp: ColorRamp,
  domain: readonly [number, number],
  exonIdx: number,
): ReactNode[] {
  return buckets.map((b) => (
    <rect
      key={`profile-heatmap-${exonIdx}-${b.start}`}
      x={b.xLocal0}
      y={yTop}
      width={Math.max(0, b.xLocal1 - b.xLocal0)}
      height={bandHeight}
      fill={colorRamp(b.value, domain)}
      className="vv-profile-cell"
      data-vv-profile-pos={b.start}
      data-vv-profile-value={b.value}
    />
  ));
}

function renderHistogramBuckets(
  buckets: BucketWithGeom[],
  yTop: number,
  yBottom: number,
  scaleFn: (value: number, bandHeight: number) => number,
  domain: readonly [number, number],
  colorRamp: ColorRamp,
  rampedBars: boolean,
  defaultFill: string,
  stroke: string | undefined,
  exonIdx: number,
): ReactNode[] {
  const bandHeight = yBottom - yTop;
  // When the host has supplied an explicit colorRamp, render each bar
  // individually so each can take its own fill. Otherwise emit a single
  // path per exon — fewer DOM nodes, the natural choice for an area
  // silhouette.
  if (rampedBars) {
    return buckets.map((b) => {
      const h = scaleFn(b.value, bandHeight);
      return (
        <rect
          key={`profile-bar-${exonIdx}-${b.start}`}
          x={b.xLocal0}
          y={yBottom - h}
          width={Math.max(0, b.xLocal1 - b.xLocal0)}
          height={h}
          fill={colorRamp(b.value, domain)}
          stroke={stroke}
          className="vv-profile-bar"
          data-vv-profile-pos={b.start}
          data-vv-profile-value={b.value}
        />
      );
    });
  }
  const d = buildAreaPath(buckets, yBottom, (v) => scaleFn(v, bandHeight));
  if (d === '') return [];
  return [
    <path
      key={`profile-area-${exonIdx}`}
      d={d}
      fill={defaultFill}
      stroke={stroke}
      className="vv-profile-area"
    />,
  ];
}

/** Build an area-fill SVG `d` attribute walking the bucket silhouette.
 *  Adjacent buckets share an edge so the polyline runs continuously;
 *  a gap (e.g. a missing-sample run inside an exon) closes the current
 *  sub-path and opens a new one. Exported for tests. */
export function buildAreaPath(
  buckets: ReadonlyArray<{ xLocal0: number; xLocal1: number; value: number }>,
  yBaseline: number,
  scaleY: (value: number) => number,
): string {
  if (buckets.length === 0) return '';
  let d = '';
  let openSub = false;
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i]!;
    const y = yBaseline - scaleY(b.value);
    if (!openSub) {
      d += `M ${b.xLocal0} ${yBaseline} `;
      openSub = true;
    }
    d += `L ${b.xLocal0} ${y} L ${b.xLocal1} ${y} `;
    const next = buckets[i + 1];
    if (!next || next.xLocal0 > b.xLocal1 + 1e-3) {
      d += `L ${b.xLocal1} ${yBaseline} Z `;
      openSub = false;
    }
  }
  return d.trim();
}

/** Reference six-stop viridis-ish ramp. Hosts who want a stricter ramp
 *  pass their own `colorRamp`. Exported for tests + so hosts can opt
 *  into the default explicitly. */
export function defaultViridis(value: number, domain: readonly [number, number]): string {
  const [lo, hi] = domain;
  let t = hi > lo ? (value - lo) / (hi - lo) : 0;
  if (!Number.isFinite(t)) t = 0;
  t = Math.max(0, Math.min(1, t));
  const segs = VIRIDIS_STOPS.length - 1;
  const s = t * segs;
  const i = Math.min(segs - 1, Math.floor(s));
  const f = s - i;
  return mixHex(VIRIDIS_STOPS[i]!, VIRIDIS_STOPS[i + 1]!, f);
}

function mixHex(a: string, b: string, t: number): string {
  const ra = parseInt(a.slice(1, 3), 16);
  const ga = parseInt(a.slice(3, 5), 16);
  const ba = parseInt(a.slice(5, 7), 16);
  const rb = parseInt(b.slice(1, 3), 16);
  const gb = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ra + (rb - ra) * t);
  const g = Math.round(ga + (gb - ga) * t);
  const bl = Math.round(ba + (bb - ba) * t);
  return `#${hex2(r)}${hex2(g)}${hex2(bl)}`;
}

function hex2(n: number): string {
  return n.toString(16).padStart(2, '0');
}
