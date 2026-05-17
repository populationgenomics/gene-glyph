import { Fragment, type ReactNode } from 'react';
import { packLanes, type LaneInput, type PackedItem } from '../pack-lanes.js';
import type {
  ExonBaseline,
  Painter,
  ProteinAnnotations,
  ProteinDomain,
  ProteinDomainEntryType,
  RangeSegment,
  Track,
  TrackGroup,
  TrackHeightArgs,
  TrackHeightResult,
  TrackLoadArgs,
  TrackRect,
  TrackRenderArgs,
  Viewport,
} from '../types.js';
import { domainHue, fitText } from './pfam-track.js';

export type InterProRenderStyle = 'minimal' | 'rect';

export interface InterProTrackConfig {
  id?: string;
  label?: string;
  /** Entry types to surface, in display order. Each becomes a sub-track in
   *  the returned TrackGroup. Defaults to the four lit-manager surfaces. */
  groups?: ProteinDomainEntryType[];
  /** Display style for each domain. `'minimal'` (default) draws a thin
   *  horizontal line with end-cap ticks and a label left-aligned to the
   *  domain's start — the visual treatment lit-manager used for secondary
   *  annotations so the Pfam track stays prominent. `'rect'` keeps the
   *  rounded-rectangle treatment from earlier iterations. */
  style?: InterProRenderStyle;
  /** Vertical pixels reserved per packed lane in a sub-track. Sized so the
   *  rect + above-rect label fit in one row without crashing the lane above. */
  laneHeight?: number;
  /** Half-thickness of each rounded rect drawn for a domain segment.
   *  Only consulted by `style: 'rect'`. */
  rectHalfHeight?: number;
  /** Font size used for labels (and for the half-distance label budget). */
  labelFontSize?: number;
  /** Vertical offset of the label above the rect's top edge / above the
   *  minimal line. */
  labelOffset?: number;
  /** Pixel gap enforced between domains placed on the same lane so labels
   *  don't crash into each other. */
  laneGapPx?: number;
  /** Override the default `source.toLowerCase() === 'interpro'` filter. */
  domainFilter?: (domain: ProteinDomain) => boolean;
}

export interface InterProSubTrackData {
  entryType: ProteinDomainEntryType;
  domains: ProteinDomain[];
  placements: PlacedDomain[];
  laneCount: number;
}

interface PlacedDomain {
  domain: ProteinDomain;
  segments: RangeSegment[];
  xStart: number;
  xEnd: number;
  xMid: number;
  lane: number;
}

const DEFAULT_GROUPS: ProteinDomainEntryType[] = [
  'family',
  'domain',
  'repeat',
  'homologous_superfamily',
];

const DEFAULT_LANE_HEIGHT = 22;
const DEFAULT_RECT_HALF = 5;
const DEFAULT_LABEL_FONT = 10;
const DEFAULT_LABEL_OFFSET = 2;
const DEFAULT_LANE_GAP = 20;

const ENTRY_TYPE_LABEL: Record<ProteinDomainEntryType, string> = {
  family: 'Family',
  domain: 'Domain',
  repeat: 'Repeat',
  homologous_superfamily: 'Homologous SF',
  conserved_site: 'Conserved site',
  active_site: 'Active site',
  binding_site: 'Binding site',
  ptm: 'PTM',
  unspecified: 'Other',
};

function defaultInterProFilter(d: ProteinDomain): boolean {
  return d.source.toLowerCase() === 'interpro';
}

function idOfDomain(d: ProteinDomain): string {
  return d.sourceId || `${d.source}:${d.aaStart}-${d.aaEnd}`;
}

function placeAndPack(
  domains: ProteinDomain[],
  viewport: Viewport,
  laneGapPx: number,
): { placements: PlacedDomain[]; laneCount: number } {
  const inputs: LaneInput<{ domain: ProteinDomain; segments: RangeSegment[]; xStart: number; xEnd: number }>[] = [];
  for (const d of domains) {
    const proj = viewport.projectProteinRange(d.aaStart, d.aaEnd);
    if (proj.segments.length === 0) continue;
    let xStart = Infinity;
    let xEnd = -Infinity;
    for (const seg of proj.segments) {
      if (seg.xStart < xStart) xStart = seg.xStart;
      if (seg.xEnd > xEnd) xEnd = seg.xEnd;
    }
    inputs.push({
      item: { domain: d, segments: proj.segments, xStart, xEnd },
      xStart,
      xEnd,
    });
  }
  const packed = packLanes(inputs, laneGapPx);
  const placements: PlacedDomain[] = packed.items.map((p: PackedItem<{ domain: ProteinDomain; segments: RangeSegment[]; xStart: number; xEnd: number }>) => ({
    domain: p.item.domain,
    segments: p.item.segments,
    xStart: p.item.xStart,
    xEnd: p.item.xEnd,
    xMid: (p.item.xStart + p.item.xEnd) / 2,
    lane: p.lane,
  }));
  return { placements, laneCount: packed.laneCount };
}

interface SubTrackOptions {
  id: string;
  label: string;
  entryType: ProteinDomainEntryType;
  style: InterProRenderStyle;
  filter: (d: ProteinDomain) => boolean;
  laneHeight: number;
  rectHalf: number;
  labelFont: number;
  labelOffset: number;
  laneGapPx: number;
}

function makeSubTrack(opts: SubTrackOptions): Track<unknown, InterProSubTrackData> {
  const { id, label, entryType, style, filter, laneHeight, rectHalf, labelFont, labelOffset, laneGapPx } = opts;

  return {
    id,
    label,
    coordSystem: 'protein',
    heightPolicy: 'data-dependent',

    async load({ protein, viewport }: TrackLoadArgs): Promise<InterProSubTrackData> {
      const domains = filterDomains(protein, filter, entryType);
      const { placements, laneCount } = placeAndPack(domains, viewport, laneGapPx);
      return { entryType, domains, placements, laneCount };
    },

    height({ data }: TrackHeightArgs<InterProSubTrackData>): TrackHeightResult {
      const lanes = data?.laneCount ?? 0;
      if (lanes === 0) return { px: 0, didTruncate: false };
      return { px: lanes * laneHeight, didTruncate: false };
    },

    render(args: TrackRenderArgs<InterProSubTrackData>): ReactNode {
      const { data, rect, viewport, painter } = args;
      if (data.placements.length === 0) return null;

      const baseline = viewport.baselineGeometry();
      const exonByIdx = new Map<number, ExonBaseline>();
      for (const eb of baseline.exons) exonByIdx.set(eb.exonIdx, eb);

      const sorted = data.placements
        .slice()
        .sort((a, b) => a.lane - b.lane || a.xMid - b.xMid);

      // One per-exon wrapper per track shared across overlapping domains
      // (multiple IPR entries commonly land in the same exon). See pfam-track
      // for the same pattern and rationale.
      const rectsByExon = new Map<number, ReactNode[]>();
      const labelsByExon = new Map<number, ReactNode[]>();
      const linkersByGap = new Map<
        string,
        { exonIdxA: number; exonIdxB: number; nodes: ReactNode[] }
      >();

      const trackLeft = 0;
      const trackRight = baseline.totalWidth;

      // Lane-aware label budget: cap each label to the half-distance against
      // the nearest neighbour *on the same lane*. Domains on a different lane
      // are visually separated by row so they don't compete for label width.
      const byLane = new Map<number, PlacedDomain[]>();
      for (const p of sorted) {
        let arr = byLane.get(p.lane);
        if (!arr) {
          arr = [];
          byLane.set(p.lane, arr);
        }
        arr.push(p);
      }

      for (const [lane, items] of byLane) {
        for (let i = 0; i < items.length; i++) {
          const p = items[i]!;
          // Label-width budget. The two styles measure differently:
          //   'rect'    — label is centred above the rect, so the budget is
          //               the smaller of the half-distances to the previous
          //               and next domain on this lane.
          //   'minimal' — label is left-aligned to the domain's start, so the
          //               budget is the distance from this domain's start to
          //               the next domain's start on this lane (or the track
          //               right edge for the last domain).
          let labelMaxW: number;
          if (style === 'minimal') {
            const nextStart =
              i + 1 < items.length ? items[i + 1]!.xStart : trackRight;
            labelMaxW = Math.max(0, nextStart - p.xStart - 4);
          } else {
            const prevMid = i > 0 ? items[i - 1]!.xMid : trackLeft - (p.xMid - trackLeft);
            const nextMid =
              i + 1 < items.length ? items[i + 1]!.xMid : trackRight + (trackRight - p.xMid);
            const maxHalf = Math.max(0, Math.min(p.xMid - prevMid, nextMid - p.xMid) / 2 - 4);
            labelMaxW = 2 * maxHalf;
          }
          emitDomain({
            placed: p,
            lane,
            rect,
            style,
            laneHeight,
            rectHalf,
            labelFont,
            labelOffset,
            labelMaxW,
            exonByIdx,
            painter,
            rectsByExon,
            labelsByExon,
            linkersByGap,
          });
        }
      }

      const linkerGroups: ReactNode[] = [];
      for (const { exonIdxA, exonIdxB, nodes } of linkersByGap.values()) {
        linkerGroups.push(
          painter.placeInInterExon(
            exonIdxA,
            exonIdxB,
            <Fragment key={`ipr-linkers-${exonIdxA}-${exonIdxB}`}>
              {nodes}
            </Fragment>,
          ),
        );
      }

      const exonGroups: ReactNode[] = [];
      const exonIdxs = new Set<number>([
        ...rectsByExon.keys(),
        ...labelsByExon.keys(),
      ]);
      for (const idx of exonIdxs) {
        const rects = rectsByExon.get(idx) ?? [];
        const labels = labelsByExon.get(idx) ?? [];
        exonGroups.push(
          painter.placeInExonGroup(
            idx,
            <Fragment key={`ipr-exon-${idx}`}>
              {rects}
              {labels}
            </Fragment>,
          ),
        );
      }

      return (
        <g className={`vv-interpro-track vv-interpro-${entryType}`} data-vv-track-id={id} key={id}>
          {linkerGroups}
          {exonGroups}
        </g>
      );
    },

    resolveAnchor(data, anchorId, viewport) {
      const d = data.domains.find((x) => idOfDomain(x) === anchorId);
      if (!d) return null;
      const mid = Math.round((d.aaStart + d.aaEnd) / 2);
      return viewport.resolveAnchor({ kind: 'protein-aa', aa: mid });
    },

    resolveFeature(data, featureId) {
      return data.domains.find((x) => idOfDomain(x) === featureId) ?? null;
    },

    featureLabel(data, featureId) {
      const d = data.domains.find((x) => idOfDomain(x) === featureId);
      if (!d) return null;
      return `${d.shortName} (${d.aaStart}–${d.aaEnd})`;
    },

    toJSON() {
      return { id, entryType, laneHeight, rectHalf, labelFont, labelOffset, laneGapPx };
    },
  };
}

function filterDomains(
  protein: ProteinAnnotations | null,
  filter: (d: ProteinDomain) => boolean,
  entryType: ProteinDomainEntryType,
): ProteinDomain[] {
  if (!protein) return [];
  return protein.domains.filter((d) => filter(d) && d.entryType === entryType);
}

interface EmitArgs {
  placed: PlacedDomain;
  lane: number;
  rect: TrackRect;
  style: InterProRenderStyle;
  laneHeight: number;
  rectHalf: number;
  labelFont: number;
  labelOffset: number;
  labelMaxW: number;
  exonByIdx: Map<number, ExonBaseline>;
  painter: Painter;
  rectsByExon: Map<number, ReactNode[]>;
  labelsByExon: Map<number, ReactNode[]>;
  linkersByGap: Map<
    string,
    { exonIdxA: number; exonIdxB: number; nodes: ReactNode[] }
  >;
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  let arr = map.get(key);
  if (!arr) {
    arr = [];
    map.set(key, arr);
  }
  arr.push(value);
}

function emitDomain(args: EmitArgs): void {
  const {
    placed,
    lane,
    rect,
    style,
    laneHeight,
    rectHalf,
    labelFont,
    labelOffset,
    labelMaxW,
    exonByIdx,
    painter,
    rectsByExon,
    labelsByExon,
    linkersByGap,
  } = args;

  const domain = placed.domain;
  const featureId = idOfDomain(domain);
  const fill = domainHue(domain.sourceId || domain.shortName);
  const fullName = domain.shortName || domain.description;
  const tooltip = `${domain.shortName}${domain.description ? ` — ${domain.description}` : ''} (aa ${domain.aaStart}–${domain.aaEnd})`;

  // The lane row is the vertical slot allocated by lane-packing.
  //   'rect'    — anchors to the *bottom* of the row (rect at the bottom,
  //               label above), so the label sits inside the row above
  //               the rect.
  //   'minimal' — anchors to the *top* of the row (line + end-caps at the
  //               top, label hanging below), so the label sits inside the
  //               row below the line.
  // Either way, no piece of the domain spills into a neighbouring lane.
  const laneTop = rect.yTop + lane * laneHeight;
  const laneBottom = laneTop + laneHeight;
  const rectH = rectHalf * 2;
  const rectY = laneBottom - rectH - 1;
  const capHalf = Math.max(2, rectHalf - 1);
  const lineY = laneTop + capHalf + 1;

  // Label segment + anchor: 'rect' uses the segment nearest the domain's
  // midpoint (label centred above); 'minimal' always anchors to the *first*
  // segment so the label aligns to the domain's left edge.
  const labelSeg = style === 'minimal'
    ? placed.segments[0] ?? null
    : pickLabelSegment(placed);
  const labelExon = labelSeg ? exonByIdx.get(labelSeg.exonIdx) : undefined;

  for (const seg of placed.segments) {
    const exon = exonByIdx.get(seg.exonIdx);
    if (!exon) continue;
    const localX = seg.xStart - exon.xStart;
    const width = Math.max(1, seg.xEnd - seg.xStart);
    if (style === 'rect') {
      pushTo(
        rectsByExon,
        seg.exonIdx,
        <Fragment key={`ipr-${featureId}-seg-${seg.exonIdx}`}>
          {painter.drawRect({
            key: `ipr-${featureId}-rect-${seg.exonIdx}`,
            x: localX,
            y: rectY,
            width,
            height: rectH,
            rx: 2,
            ry: 2,
            fill,
            stroke: painter.color('vv-color-pfam-stroke', '#475569'),
            strokeWidth: 0.5,
            vectorEffect: 'non-scaling-stroke',
            className: 'vv-interpro-rect',
          })}
        </Fragment>,
      );
    } else {
      // 'minimal' style — line spanning the segment with vector-effect
      // non-scaling-stroke so it stays 1.25px wide regardless of zoom.
      // End-caps land at the *true* domain ends only (first segment's
      // xStart, last segment's xEnd), not at each fragment boundary —
      // intra-domain linkers carry the visual continuity across gaps.
      const isFirstSeg = seg === placed.segments[0];
      const isLastSeg = seg === placed.segments[placed.segments.length - 1];
      pushTo(
        rectsByExon,
        seg.exonIdx,
        <Fragment key={`ipr-${featureId}-seg-${seg.exonIdx}`}>
          <line
            key={`ipr-${featureId}-line-${seg.exonIdx}`}
            x1={localX}
            x2={localX + width}
            y1={lineY}
            y2={lineY}
            stroke={fill}
            strokeWidth={1.5}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            className="vv-interpro-line"
          />
          {isFirstSeg && (
            <g
              key={`ipr-${featureId}-cap-l-wrap-${seg.exonIdx}`}
              className="vv-interpro-cap-wrap"
              style={{
                transform:
                  `translateX(${localX}px) ` +
                  `scaleX(calc(1 / var(--vv-exon-scale-x-${seg.exonIdx}, 1)))`,
                transformOrigin: '0 0',
              }}
            >
              <line
                key={`ipr-${featureId}-cap-l`}
                x1={0}
                x2={0}
                y1={lineY - capHalf}
                y2={lineY + capHalf}
                stroke={fill}
                strokeWidth={1.5}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                className="vv-interpro-cap"
              />
            </g>
          )}
          {isLastSeg && (
            <g
              key={`ipr-${featureId}-cap-r-wrap-${seg.exonIdx}`}
              className="vv-interpro-cap-wrap"
              style={{
                transform:
                  `translateX(${localX + width}px) ` +
                  `scaleX(calc(1 / var(--vv-exon-scale-x-${seg.exonIdx}, 1)))`,
                transformOrigin: '0 0',
              }}
            >
              <line
                key={`ipr-${featureId}-cap-r`}
                x1={0}
                x2={0}
                y1={lineY - capHalf}
                y2={lineY + capHalf}
                stroke={fill}
                strokeWidth={1.5}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                className="vv-interpro-cap"
              />
            </g>
          )}
        </Fragment>,
      );
    }
  }

  for (let i = 0; i < placed.segments.length - 1; i++) {
    const a = placed.segments[i]!;
    const b = placed.segments[i + 1]!;
    if (b.xStart <= a.xEnd) continue;
    const linkerY = style === 'minimal' ? lineY : rectY + rectH / 2;
    const gapKey = `${a.exonIdx}:${b.exonIdx}`;
    let bucket = linkersByGap.get(gapKey);
    if (!bucket) {
      bucket = { exonIdxA: a.exonIdx, exonIdxB: b.exonIdx, nodes: [] };
      linkersByGap.set(gapKey, bucket);
    }
    bucket.nodes.push(
      <line
        key={`ipr-${featureId}-link-line-${a.exonIdx}-${b.exonIdx}`}
        x1={0}
        x2={b.xStart - a.xEnd}
        y1={linkerY}
        y2={linkerY}
        stroke={fill}
        strokeWidth={style === 'minimal' ? 1 : 1.25}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        className="vv-interpro-linker"
      />,
    );
  }

  const label = fitText(fullName, labelMaxW, labelFont);
  if (label && labelExon) {
    // Anchor differs between styles:
    //   'rect'    — centred above the rect (anchor at xMid, text-anchor: middle).
    //   'minimal' — left-aligned to the domain's leftmost segment
    //               (anchor at first-segment.xStart, text-anchor: start).
    const anchorX = style === 'minimal'
      ? (placed.segments[0]?.xStart ?? placed.xMid) - labelExon.xStart
      : placed.xMid - labelExon.xStart;
    const textAnchor: 'start' | 'middle' = style === 'minimal' ? 'start' : 'middle';
    // 'minimal' labels hang *below* the line so the line itself is the
    // primary visual anchor; 'rect' labels sit above the rect to keep the
    // existing Pfam-style cadence. dominantBaseline='hanging' anchors the
    // text top at labelY, so the text reads top-down from there.
    const labelY = style === 'minimal' ? lineY + capHalf + 1 : rectY - labelOffset;
    const dominantBaseline: 'auto' | 'hanging' = style === 'minimal' ? 'hanging' : 'auto';
    pushTo(
      labelsByExon,
      labelExon.exonIdx,
      <g
        key={`ipr-${featureId}-label-wrap`}
        className="vv-interpro-label-wrap"
        style={{
          transform:
            `translateX(${anchorX}px) ` +
            `scaleX(calc(1 / var(--vv-exon-scale-x-${labelExon.exonIdx}, 1)))`,
          transformOrigin: '0 0',
        }}
      >
        <text
          key={`ipr-${featureId}-label`}
          x={0}
          y={labelY}
          textAnchor={textAnchor}
          dominantBaseline={dominantBaseline}
          fontSize={labelFont}
          fill={painter.color('vv-color-pfam-label', '#475569')}
          className="vv-interpro-label"
        >
          <title>{tooltip}</title>
          {label}
        </text>
      </g>,
    );
  }
}

function pickLabelSegment(placed: PlacedDomain): RangeSegment | null {
  if (placed.segments.length === 0) return null;
  const xMid = placed.xMid;
  let best: { seg: RangeSegment; dist: number } | null = null;
  for (const seg of placed.segments) {
    if (xMid >= seg.xStart && xMid <= seg.xEnd) return seg;
    const dist = xMid < seg.xStart ? seg.xStart - xMid : xMid - seg.xEnd;
    if (!best || dist < best.dist) best = { seg, dist };
  }
  return best?.seg ?? null;
}

/**
 * Build an InterPro `TrackGroup` containing one sub-track per requested
 * entry-type (family / domain / repeat / homologous_superfamily by default).
 *
 * Each sub-track filters the host-supplied `ProteinAnnotations.domains` down
 * to its entry-type, lane-packs the visible projections so overlapping
 * domains stack into rows, and emits joined rectangles + linkers + labels in
 * the same vocabulary as the Pfam track. Lane count is data-dependent, so a
 * sub-track with no visible domains collapses to zero height (no empty row).
 */
export function interProTrack(config: InterProTrackConfig = {}): TrackGroup {
  const baseId = config.id ?? 'interpro';
  const groups = config.groups ?? DEFAULT_GROUPS;
  const style: InterProRenderStyle = config.style ?? 'minimal';
  const laneHeight = config.laneHeight ?? DEFAULT_LANE_HEIGHT;
  const rectHalf = config.rectHalfHeight ?? DEFAULT_RECT_HALF;
  const labelFont = config.labelFontSize ?? DEFAULT_LABEL_FONT;
  const labelOffset = config.labelOffset ?? DEFAULT_LABEL_OFFSET;
  const laneGapPx = config.laneGapPx ?? DEFAULT_LANE_GAP;
  const filter = config.domainFilter ?? defaultInterProFilter;

  const tracks = groups.map((entryType) =>
    makeSubTrack({
      id: `${baseId}-${entryType}`,
      label: ENTRY_TYPE_LABEL[entryType],
      entryType,
      style,
      filter,
      laneHeight,
      rectHalf,
      labelFont,
      labelOffset,
      laneGapPx,
    }),
  );

  return {
    kind: 'group',
    id: baseId,
    label: config.label ?? 'InterPro',
    gapAbove: 6,
    tracks,
  };
}

export { ENTRY_TYPE_LABEL as interProEntryTypeLabel };
