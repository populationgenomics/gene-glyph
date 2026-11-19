import { Fragment, type CSSProperties, type ReactNode } from 'react';
import { fitText } from './pfam-track.js';
import type {
  ExonBaseline,
  RangeProjection,
  RangeSegment,
  ScreenPoint,
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
  /** Feature id reported to hover / click callbacks. Defaults to one
   *  built from the span and category. */
  id?: string;
  start: number;
  end: number;
  category: C;
  label?: string;
}

/** A band datum in genomic coordinates. `[start, end]` are 1-based
 *  inclusive positions on `chr`, in genomic order (`start <= end`) on
 *  either strand. `chr` must equal the transcript's `Exon.chr` string
 *  exactly; a span on any other chromosome (or under another name for
 *  the same one) draws nothing and is listed as unplaced. */
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
 *  drawn. */
export interface GenomicSegmentBandTrackConfig<
  C extends string = string,
> extends SegmentBandTrackOptions<C, GenomicSegmentBandDatum<C>> {
  coordSystem: 'genomic';
}

export type SegmentBandTrackConfig<C extends string = string> =
  CodingSegmentBandTrackConfig<C> | GenomicSegmentBandTrackConfig<C>;

/** Loaded band data, sorted by span start. Spans that draw nothing in
 *  the current view are listed below the figure as unplaced chips. */
export interface SegmentBandTrackData<
  C extends string = string,
  D extends SegmentBandDatum<C> = SegmentBandDatum<C>,
> {
  segments: ReadonlyArray<D>;
}

const DEFAULT_HEIGHT = 14;
const DEFAULT_MIN_LABEL_WIDTH = 28;
const DEFAULT_LABEL_FONT = 10;
const LABEL_PADDING_PX = 3;

/** The parts of a band track that depend on its datum type. */
interface BandBinding<C extends string, D extends SegmentBandDatum<C>> {
  source: SegmentBandSource<C, D>;
  onOverlapWarning: ((a: D, b: D) => void) | undefined;
  /** Spans in different groups never overlap (genomic: the chromosome). */
  overlapGroup(d: D): string;
  /** Id used when the datum carries none. */
  fallbackId(d: D): string;
  project(d: D, viewport: Viewport): RangeProjection;
  /** Span text for the default tooltip. */
  spanText(d: D): string;
}

/** Build a {@link Track} that renders a non-overlapping series of
 *  categorical intervals as full-height colour bands. */
export function segmentBandTrack<C extends string = string>(
  config: GenomicSegmentBandTrackConfig<C>,
): Track<SegmentBandTrackConfig<C>, SegmentBandTrackData<C, GenomicSegmentBandDatum<C>>>;
export function segmentBandTrack<C extends string = string>(
  config: SegmentBandTrackConfig<C>,
): Track<SegmentBandTrackConfig<C>, SegmentBandTrackData<C>>;
export function segmentBandTrack<C extends string = string>(
  config: SegmentBandTrackConfig<C>,
): Track<SegmentBandTrackConfig<C>, SegmentBandTrackData<C>> {
  if (config.coordSystem === 'genomic') {
    return buildSegmentBandTrack<C, GenomicSegmentBandDatum<C>>(config, {
      source: config.source,
      onOverlapWarning: config.onOverlapWarning,
      overlapGroup: (d) => d.chr,
      fallbackId: (d) => `${d.chr}:${d.start}-${d.end}-${d.category}`,
      project: (d, viewport) => viewport.projectGenomicRange(d.chr, d.start, d.end),
      spanText: (d) => `${d.chr}:${d.start}–${d.end}`,
    });
  }
  const isProtein = config.coordSystem === 'protein';
  return buildSegmentBandTrack<C, SegmentBandDatum<C>>(config, {
    source: config.source,
    onOverlapWarning: config.onOverlapWarning,
    overlapGroup: () => '',
    fallbackId: (d) => `${d.start}-${d.end}-${d.category}`,
    project: (d, viewport) =>
      isProtein
        ? viewport.projectProteinRange(d.start, d.end)
        : viewport.projectCdsRange(d.start, d.end),
    spanText: (d) => `${d.start}–${d.end}`,
  });
}

function buildSegmentBandTrack<C extends string, D extends SegmentBandDatum<C>>(
  config: SegmentBandTrackConfig<C>,
  binding: BandBinding<C, D>,
): Track<SegmentBandTrackConfig<C>, SegmentBandTrackData<C, D>> {
  const id = config.id ?? 'segment-band-track';
  const trackHeight = config.heightPx ?? DEFAULT_HEIGHT;
  const palette = config.palette;
  const showLabels = config.showLabels ?? false;
  const minLabelWidth = config.minLabelWidthPx ?? DEFAULT_MIN_LABEL_WIDTH;
  const labelFont = config.labelFontSize ?? DEFAULT_LABEL_FONT;
  const { onOverlapWarning } = binding;

  const featureIdOf = (d: D): string => d.id ?? binding.fallbackId(d);
  const findSegment = (data: SegmentBandTrackData<C, D>, featureId: string): D | null =>
    data.segments.find((s) => featureIdOf(s) === featureId) ?? null;
  const labelOf = (d: D): string => `${d.label ?? d.category} (${binding.spanText(d)})`;

  return {
    id,
    coordSystem: config.coordSystem,
    heightPolicy: 'fixed',
    gapAbove: config.gapAbove,

    async load({ signal }: TrackLoadArgs): Promise<SegmentBandTrackData<C, D>> {
      const { source } = binding;
      const raw = typeof source === 'function' ? await source({ signal }) : source;
      // Sort + overlap-check once at load time so render() can assume a
      // clean input. Overlaps are a host data error: report via the
      // callback and keep rendering — every segment still paints, the
      // viewer just no longer guarantees a one-row stack.
      const sorted = [...raw].sort((a, b) => orderedStart(a) - orderedStart(b));
      if (onOverlapWarning) {
        // Per group, the span reaching furthest so far: a short span
        // nested in a long one must not hide a later overlap with it.
        const furthestByGroup = new Map<string, D>();
        for (const curr of sorted) {
          const group = binding.overlapGroup(curr);
          const furthest = furthestByGroup.get(group);
          if (furthest && orderedStart(curr) <= orderedEnd(furthest)) {
            onOverlapWarning(furthest, curr);
          }
          if (!furthest || orderedEnd(curr) > orderedEnd(furthest)) {
            furthestByGroup.set(group, curr);
          }
        }
      }
      return { segments: sorted };
    },

    height(_args: TrackHeightArgs<SegmentBandTrackData<C, D>>): TrackHeightResult {
      return { px: trackHeight, didTruncate: false };
    },

    render(args: TrackRenderArgs<SegmentBandTrackData<C, D>>): ReactNode {
      const { data, rect, viewport, painter, onFeatureHover, onFeatureClick } = args;
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
        const projection = binding.project(seg, viewport);
        if (projection.segments.length === 0) continue;
        const featureId = featureIdOf(seg);
        const click = onFeatureClick ? () => onFeatureClick(featureId) : undefined;
        for (const piece of projection.segments) {
          const exon = exonByIdx.get(piece.exonIdx);
          if (!exon) continue;
          const localX = piece.xStart - exon.xStart;
          const width = Math.max(0.5, piece.xEnd - piece.xStart);
          pushTo(
            rectsByExon,
            piece.exonIdx,
            <g
              key={`band-${featureId}-${piece.exonIdx}`}
              className="vv-segment-band-feature"
              data-vv-feature-id={featureId}
              onMouseEnter={onFeatureHover ? () => onFeatureHover(featureId) : undefined}
              onMouseLeave={onFeatureHover ? () => onFeatureHover(null) : undefined}
              onClick={click}
              role={click ? 'button' : undefined}
              tabIndex={click ? 0 : undefined}
              aria-label={labelOf(seg)}
            >
              {painter.drawRect({
                x: localX,
                y: rect.yTop,
                width,
                height: rectH,
                fill,
                className: 'vv-segment-band-rect',
              })}
            </g>,
          );
        }
        if (showLabels && seg.label) {
          const labelPiece = widestPiece(projection.segments);
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

    renderBelow(args: TrackRenderArgs<SegmentBandTrackData<C, D>>): ReactNode | null {
      const { data, viewport, interaction, onFeatureHover, onFeatureClick } = args;
      const unplaced = data.segments.filter(
        (s) => palette[s.category] && binding.project(s, viewport).segments.length === 0,
      );
      if (unplaced.length === 0) return null;
      return (
        <div className="vv-unplaced-variants" data-vv-track-id={id} data-testid={`${id}-unplaced`}>
          <span className="vv-unplaced-label">Unplaced ({unplaced.length})</span>
          <ul className="vv-unplaced-list">
            {unplaced.map((s) => {
              const featureId = featureIdOf(s);
              const cls = [
                'vv-unplaced-chip',
                interaction.hoveredFeatureId === featureId && 'is-hovered',
                interaction.selectedFeatureIds.has(featureId) && 'is-selected',
              ]
                .filter(Boolean)
                .join(' ');
              const style = {
                ['--vv-variant-color' as keyof CSSProperties]: palette[s.category],
              } as CSSProperties;
              const label = labelOf(s);
              return (
                <li
                  key={featureId}
                  className={cls}
                  data-vv-feature-id={featureId}
                  style={style}
                  onMouseEnter={() => onFeatureHover?.(featureId)}
                  onMouseLeave={() => onFeatureHover?.(null)}
                  onClick={() => onFeatureClick?.(featureId)}
                  title={label}
                >
                  <span className="vv-unplaced-dot" aria-hidden />
                  <span className="vv-unplaced-text">{label}</span>
                </li>
              );
            })}
          </ul>
        </div>
      );
    },

    resolveAnchor(data, anchorId, viewport): ScreenPoint | null {
      const seg = findSegment(data, anchorId);
      if (!seg) return null;
      const piece = widestPiece(binding.project(seg, viewport).segments);
      if (!piece) return null;
      const ruler = viewport.baselineXToRuler((piece.xStart + piece.xEnd) / 2);
      const x = viewport.toScreen(
        viewport.mode === 'protein'
          ? { kind: 'protein', aa: ruler }
          : { kind: 'cds', cPos: ruler, offset: 0 },
      );
      return x === null ? null : { x, y: 0 };
    },

    resolveFeature(data, featureId) {
      return findSegment(data, featureId);
    },

    featureLabel(data, featureId) {
      const seg = findSegment(data, featureId);
      return seg ? labelOf(seg) : null;
    },

    toJSON(): SegmentBandTrackConfig<C> {
      const { onOverlapWarning: _callback, ...serialisable } = config;
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

/** Span bounds in ascending order; projection treats `start > end` as
 *  the same span reversed, so sorting and overlap checks do too. */
function orderedStart(d: SegmentBandDatum): number {
  return Math.min(d.start, d.end);
}

function orderedEnd(d: SegmentBandDatum): number {
  return Math.max(d.start, d.end);
}

function widestPiece(segments: readonly RangeSegment[]): RangeSegment | null {
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
