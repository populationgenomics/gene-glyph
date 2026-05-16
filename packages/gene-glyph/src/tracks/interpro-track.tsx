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

export interface InterProTrackConfig {
  id?: string;
  label?: string;
  /** Entry types to surface, in display order. Each becomes a sub-track in
   *  the returned TrackGroup. Defaults to the four lit-manager surfaces. */
  groups?: ProteinDomainEntryType[];
  /** Vertical pixels reserved per packed lane in a sub-track. Sized so the
   *  rect + above-rect label fit in one row without crashing the lane above. */
  laneHeight?: number;
  /** Half-thickness of each rounded rect drawn for a domain segment. */
  rectHalfHeight?: number;
  /** Font size used for labels (and for the half-distance label budget). */
  labelFontSize?: number;
  /** Vertical offset of the label above the rect's top edge. */
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
  entryType: ProteinDomainEntryType;
  filter: (d: ProteinDomain) => boolean;
  laneHeight: number;
  rectHalf: number;
  labelFont: number;
  labelOffset: number;
  laneGapPx: number;
}

function makeSubTrack(opts: SubTrackOptions): Track<unknown, InterProSubTrackData> {
  const { id, entryType, filter, laneHeight, rectHalf, labelFont, labelOffset, laneGapPx } = opts;

  return {
    id,
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
          const prevMid = i > 0 ? items[i - 1]!.xMid : trackLeft - (p.xMid - trackLeft);
          const nextMid =
            i + 1 < items.length ? items[i + 1]!.xMid : trackRight + (trackRight - p.xMid);
          const maxHalf = Math.max(0, Math.min(p.xMid - prevMid, nextMid - p.xMid) / 2 - 4);
          emitDomain({
            placed: p,
            lane,
            rect,
            laneHeight,
            rectHalf,
            labelFont,
            labelOffset,
            labelMaxW: 2 * maxHalf,
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

  // Anchor the rect to the *bottom* of the lane row so the label above it
  // stays inside this lane's vertical slot and doesn't crash into the lane
  // above. Matches Pfam's "label sits above the rect" treatment.
  const laneTop = rect.yTop + lane * laneHeight;
  const laneBottom = laneTop + laneHeight;
  const rectH = rectHalf * 2;
  const rectY = laneBottom - rectH - 1;

  const labelSeg = pickLabelSegment(placed);
  const labelExon = labelSeg ? exonByIdx.get(labelSeg.exonIdx) : undefined;

  for (const seg of placed.segments) {
    const exon = exonByIdx.get(seg.exonIdx);
    if (!exon) continue;
    const localX = seg.xStart - exon.xStart;
    const width = Math.max(1, seg.xEnd - seg.xStart);
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
  }

  for (let i = 0; i < placed.segments.length - 1; i++) {
    const a = placed.segments[i]!;
    const b = placed.segments[i + 1]!;
    if (b.xStart <= a.xEnd) continue;
    const linkerY = rectY + rectH / 2;
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
        strokeWidth={1.25}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        className="vv-interpro-linker"
      />,
    );
  }

  const label = fitText(fullName, labelMaxW, labelFont);
  if (label && labelExon) {
    const localXMid = placed.xMid - labelExon.xStart;
    pushTo(
      labelsByExon,
      labelExon.exonIdx,
      <g
        key={`ipr-${featureId}-label-wrap`}
        className="vv-interpro-label-wrap"
        style={{
          transform:
            `translateX(${localXMid}px) ` +
            `scaleX(calc(1 / var(--vv-exon-scale-x-${labelExon.exonIdx}, 1)))`,
          transformOrigin: '0 0',
        }}
      >
        <text
          key={`ipr-${featureId}-label`}
          x={0}
          y={rectY - labelOffset}
          textAnchor="middle"
          dominantBaseline="auto"
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
  const laneHeight = config.laneHeight ?? DEFAULT_LANE_HEIGHT;
  const rectHalf = config.rectHalfHeight ?? DEFAULT_RECT_HALF;
  const labelFont = config.labelFontSize ?? DEFAULT_LABEL_FONT;
  const labelOffset = config.labelOffset ?? DEFAULT_LABEL_OFFSET;
  const laneGapPx = config.laneGapPx ?? DEFAULT_LANE_GAP;
  const filter = config.domainFilter ?? defaultInterProFilter;

  const tracks = groups.map((entryType) =>
    makeSubTrack({
      id: `${baseId}-${entryType}`,
      entryType,
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
