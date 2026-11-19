import { Fragment, type ReactNode } from 'react';
import { fitText } from './pfam-track.js';
import type {
  CoordSystem,
  ExonBaseline,
  RangeProjection,
  RangeSegment,
  Track,
  TrackHeightArgs,
  TrackHeightResult,
  TrackLoadArgs,
  TrackRenderArgs,
  Viewport,
} from '../types.js';

/**
 * Slice 30 — categorical / boolean colour-band track.
 *
 * Renders a non-overlapping series of `{start, end, category}` intervals
 * as a single row of coloured rectangles keyed by a host-supplied
 * palette. Used for KIF21A-style annotations (NMD escape, Regional
 * Missense Constraint, secondary structure) where each position carries
 * one categorical attribute and the visual is a continuous strip rather
 * than a glyph per item.
 */
export interface SegmentBandDatum<C extends string = string> {
  id?: string;
  start: number;
  end: number;
  category: C;
  label?: string;
}

/** A band datum in genomic coordinates. `[start, end]` are 1-based
 *  inclusive positions on `chr`, in genomic order (`start <= end`) on
 *  either strand. `chr` names the chromosome the way the transcript's
 *  `Exon.chr` does; a span on any other chromosome draws nothing. */
export interface GenomicSegmentBandDatum<C extends string = string> extends SegmentBandDatum<C> {
  chr: string;
}

export type SegmentBandSource<
  C extends string = string,
  D extends SegmentBandDatum<C> = SegmentBandDatum<C>,
> = ReadonlyArray<D> | ((args: { signal: AbortSignal }) => Promise<ReadonlyArray<D>>);

/** Options shared by every {@link SegmentBandTrackConfig} variant. */
export interface SegmentBandTrackOptions<
  C extends string = string,
  D extends SegmentBandDatum<C> = SegmentBandDatum<C>,
> {
  id?: string;
  /** Eager array or async loader. Each datum's `[start, end]` is in the
   *  track's declared `coordSystem` units (1-indexed, inclusive). */
  source: SegmentBandSource<C, D>;
  /** Category → CSS colour. Compile-time exhaustiveness comes from the
   *  source datum's literal-union `category` field — passing a record
   *  keyed on the same literal union makes an unknown category a
   *  compile error rather than a render fallback. */
  palette: Record<C, string>;
  /** Band height in pixels. Default 14. */
  heightPx?: number;
  /** Show inline labels centred inside each segment when the segment is
   *  wider than {@link minLabelWidthPx}. Default `false`. */
  showLabels?: boolean;
  /** Threshold (display pixels) below which inline labels are
   *  suppressed. Default 28 — roughly three characters of the default
   *  11px font. */
  minLabelWidthPx?: number;
  /** Label font size. Default 10. */
  labelFontSize?: number;
  /** Vertical pixels reserved above this track during layout. */
  gapAbove?: number;
  /** Fires when the input contains overlapping segments. Overlaps are
   *  treated as a host data error — the track keeps rendering (every
   *  segment still paints) but surfaces the offending pair so the host
   *  can log / repair upstream. */
  onOverlapWarning?: (a: D, b: D) => void;
}

/** Band track over CDS bp (`'cds'`) or amino acids (`'protein'`). The
 *  track maps endpoints to baseline-x via the active viewport so it
 *  stays correctly aligned in every mode. */
export interface CodingSegmentBandTrackConfig<
  C extends string = string,
> extends SegmentBandTrackOptions<C, SegmentBandDatum<C>> {
  coordSystem: 'cds' | 'protein';
}

/** Band track over genomic positions ({@link GenomicSegmentBandDatum}).
 *  A span draws over the coding exon bases it covers, one piece per
 *  exon, in every view mode. Its intronic parts, and any part outside
 *  the transcript's coding exons (UTR, flanking sequence), are not
 *  drawn; a span with no coding exon base draws nothing. */
export interface GenomicSegmentBandTrackConfig<
  C extends string = string,
> extends SegmentBandTrackOptions<C, GenomicSegmentBandDatum<C>> {
  coordSystem: 'genomic';
}

export type SegmentBandTrackConfig<C extends string = string> =
  CodingSegmentBandTrackConfig<C> | GenomicSegmentBandTrackConfig<C>;

export interface SegmentBandTrackData<C extends string = string> {
  segments: ReadonlyArray<SegmentBandDatum<C>>;
}

const DEFAULT_HEIGHT = 14;
const DEFAULT_MIN_LABEL_WIDTH = 28;
const DEFAULT_LABEL_FONT = 10;
const LABEL_PADDING_PX = 3;

/** How one datum type sits on the track's coordinate axis. */
interface BandAxis<D> {
  /** Data with different keys never overlap (genomic: the chromosome). */
  key(d: D): string;
  project(d: D, viewport: Viewport): RangeProjection;
  /** Span text for the default tooltip. */
  span(d: D): string;
}

interface LoadedBands<D> {
  segments: ReadonlyArray<D>;
}

/** Build a {@link Track} that renders a non-overlapping series of
 *  categorical intervals as full-height colour bands. */
export function segmentBandTrack<C extends string = string>(
  config: SegmentBandTrackConfig<C>,
): Track<SegmentBandTrackConfig<C>, SegmentBandTrackData<C>> {
  if (config.coordSystem === 'genomic') {
    return buildSegmentBandTrack(config, config, {
      key: (d) => d.chr,
      project: (d, viewport) => viewport.projectGenomicRange(d.chr, d.start, d.end),
      span: (d) => `${d.chr}:${d.start}–${d.end}`,
    });
  }
  const project =
    config.coordSystem === 'protein'
      ? (d: SegmentBandDatum<C>, viewport: Viewport) => viewport.projectProteinRange(d.start, d.end)
      : (d: SegmentBandDatum<C>, viewport: Viewport) => viewport.projectCdsRange(d.start, d.end);
  return buildSegmentBandTrack(config, config, {
    key: () => '',
    project,
    span: (d) => `${d.start}–${d.end}`,
  });
}

function buildSegmentBandTrack<C extends string, D extends SegmentBandDatum<C>>(
  config: SegmentBandTrackOptions<C, D> & { coordSystem: CoordSystem },
  original: SegmentBandTrackConfig<C>,
  axis: BandAxis<D>,
): Track<SegmentBandTrackConfig<C>, LoadedBands<D>> {
  const id = config.id ?? 'segment-band-track';
  const trackHeight = config.heightPx ?? DEFAULT_HEIGHT;
  const palette = config.palette;
  const coordSystem = config.coordSystem;
  const showLabels = config.showLabels ?? false;
  const minLabelWidth = config.minLabelWidthPx ?? DEFAULT_MIN_LABEL_WIDTH;
  const labelFont = config.labelFontSize ?? DEFAULT_LABEL_FONT;
  const onOverlapWarning = config.onOverlapWarning;

  return {
    id,
    coordSystem,
    heightPolicy: 'fixed',
    gapAbove: config.gapAbove,

    async load({ signal }: TrackLoadArgs): Promise<LoadedBands<D>> {
      const raw =
        typeof config.source === 'function' ? await config.source({ signal }) : config.source;
      // Sort + overlap-check once at load time so render() can assume a
      // clean input. Overlaps are a host data error: report via the
      // callback and keep rendering — every segment still paints, the
      // viewer just no longer guarantees a one-row stack.
      const sorted = [...raw].sort((a, b) => a.start - b.start);
      if (onOverlapWarning) {
        const prevByKey = new Map<string, D>();
        for (const curr of sorted) {
          const key = axis.key(curr);
          const prev = prevByKey.get(key);
          if (prev && curr.start <= prev.end) {
            onOverlapWarning(prev, curr);
          }
          prevByKey.set(key, curr);
        }
      }
      return { segments: sorted };
    },

    height(_args: TrackHeightArgs<LoadedBands<D>>): TrackHeightResult {
      return { px: trackHeight, didTruncate: false };
    },

    render(args: TrackRenderArgs<LoadedBands<D>>): ReactNode {
      const { data, rect, viewport, painter } = args;
      if (data.segments.length === 0) return null;

      const baseline = viewport.baselineGeometry();
      const exonByIdx = new Map<number, ExonBaseline>();
      for (const eb of baseline.exons) exonByIdx.set(eb.exonIdx, eb);

      const rectsByExon = new Map<number, ReactNode[]>();
      const labelsByExon = new Map<number, ReactNode[]>();

      const rectH = rect.yBottom - rect.yTop;

      for (const seg of data.segments) {
        const fill = palette[seg.category];
        if (!fill) continue;
        const projection = axis.project(seg, viewport);
        if (projection.segments.length === 0) continue;
        const featureId = seg.id ?? `${seg.start}-${seg.end}-${seg.category}`;
        for (const piece of projection.segments) {
          const exon = exonByIdx.get(piece.exonIdx);
          if (!exon) continue;
          const localX = piece.xStart - exon.xStart;
          const width = Math.max(0.5, piece.xEnd - piece.xStart);
          pushTo(
            rectsByExon,
            piece.exonIdx,
            painter.drawRect({
              key: `band-${featureId}-${piece.exonIdx}`,
              x: localX,
              y: rect.yTop,
              width,
              height: rectH,
              fill,
              className: 'vv-segment-band-rect',
            }),
          );
        }
        if (showLabels && seg.label) {
          const labelPiece = pickLabelPiece(projection.segments);
          if (labelPiece) {
            const labelExon = exonByIdx.get(labelPiece.exonIdx);
            if (labelExon) {
              const pieceWidth = Math.max(0, labelPiece.xEnd - labelPiece.xStart);
              if (pieceWidth >= minLabelWidth) {
                const fitted = fitText(
                  seg.label,
                  Math.max(0, pieceWidth - LABEL_PADDING_PX * 2),
                  labelFont,
                );
                if (fitted) {
                  const midX = (labelPiece.xStart + labelPiece.xEnd) / 2;
                  const localMid = midX - labelExon.xStart;
                  const midY = rect.yTop + rectH / 2;
                  pushTo(
                    labelsByExon,
                    labelPiece.exonIdx,
                    <g
                      key={`band-${featureId}-label`}
                      className="vv-segment-band-label-wrap"
                      style={{
                        transform:
                          `translateX(${localMid}px) ` +
                          `scaleX(calc(1 / var(--vv-exon-scale-x-${labelPiece.exonIdx}, 1)))`,
                        transformOrigin: '0 0',
                      }}
                    >
                      <text
                        x={0}
                        y={midY}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={labelFont}
                        className="vv-segment-band-label"
                      >
                        {fitted}
                      </text>
                    </g>,
                  );
                }
              }
            }
          }
        }
      }

      const exonIdxs = new Set<number>([...rectsByExon.keys(), ...labelsByExon.keys()]);
      const groups: ReactNode[] = [];
      for (const exonIdx of exonIdxs) {
        const rects = rectsByExon.get(exonIdx) ?? [];
        const labels = labelsByExon.get(exonIdx) ?? [];
        groups.push(
          painter.placeInExonGroup(
            exonIdx,
            <Fragment key={`segment-band-exon-${exonIdx}`}>
              {rects}
              {labels}
            </Fragment>,
          ),
        );
      }

      return (
        <g className="vv-segment-band-track" data-vv-track-id={id} key={id}>
          {groups}
        </g>
      );
    },

    resolveFeature(data, featureId) {
      return (
        data.segments.find((s) => (s.id ?? `${s.start}-${s.end}-${s.category}`) === featureId) ??
        null
      );
    },

    featureLabel(data, featureId) {
      const seg = data.segments.find(
        (s) => (s.id ?? `${s.start}-${s.end}-${s.category}`) === featureId,
      );
      if (!seg) return null;
      const span = axis.span(seg);
      return seg.label ? `${seg.label} (${span})` : `${seg.category} (${span})`;
    },

    toJSON(): SegmentBandTrackConfig<C> {
      const { onOverlapWarning: _callback, ...serialisable } = original;
      return {
        ...serialisable,
        id,
        heightPx: trackHeight,
        showLabels,
        minLabelWidthPx: minLabelWidth,
        labelFontSize: labelFont,
      };
    },
  };
}

function pickLabelPiece(segments: RangeSegment[]): RangeSegment | null {
  let best: RangeSegment | null = null;
  let bestWidth = -1;
  for (const piece of segments) {
    const w = piece.xEnd - piece.xStart;
    if (w > bestWidth) {
      best = piece;
      bestWidth = w;
    }
  }
  return best;
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  let arr = map.get(key);
  if (!arr) {
    arr = [];
    map.set(key, arr);
  }
  arr.push(value);
}
