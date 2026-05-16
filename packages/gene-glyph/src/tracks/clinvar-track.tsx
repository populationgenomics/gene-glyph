/* eslint-disable react-refresh/only-export-components -- the React components in
 * this file (ClinVarBody / ClusterDiamond / ClusterPopover) are private and
 * only used by `clinVarTrack` below; HMR doesn't apply to the track factory's
 * own exports so the rule's caution doesn't fit here. */
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  isDataSource,
  type CoordinateMapper,
  type DataSource,
  type ExonBaseline,
  type Track,
  type TrackHeightArgs,
  type TrackHeightResult,
  type TrackLoadArgs,
  type TrackRenderArgs,
  type Viewport,
  type ViewportQuery,
} from '../types.js';

/** Clinical significance bucket used to colour ClinVar marks. The viewer
 *  doesn't try to encode the full ClinVar review-status matrix — instead the
 *  adapter normalises the upstream string into one of these buckets so the
 *  visual surface is consistent across data sources (NCBI eutils, downloaded
 *  VCF, or a host's own pipeline). */
export type ClinVarSignificance =
  | 'pathogenic'
  | 'likely_pathogenic'
  | 'uncertain_significance'
  | 'likely_benign'
  | 'benign'
  | 'conflicting'
  | 'other';

/** One ClinVar record. Coordinates are genomic — the track maps them through
 *  the host's {@link CoordinateMapper} per render. `condition` and
 *  `reviewStatus` are surfaced verbatim in the cluster popover. */
export interface ClinVarRecord {
  /** Stable identifier (typically the ClinVar VCV accession). */
  id: string;
  /** Short label, usually HGVS (e.g., "c.524G>A"). */
  label: string;
  chr: string;
  pos: number;
  significance: ClinVarSignificance;
  reviewStatus?: string;
  condition?: string;
  /** Free-form metadata; the playground / host can surface this in tooltips. */
  meta?: Record<string, unknown>;
}

export type ClinVarSource =
  | ClinVarRecord[]
  | DataSource<ViewportQuery, ClinVarRecord[]>;

export interface ClinVarTrackConfig {
  id?: string;
  source: ClinVarSource;
  /** Total track height in pixels. */
  height?: number;
  /** Pixel threshold for density clustering. Records whose live screen-x
   *  positions are within this distance are merged into one cluster mark.
   *  Defaults to 14px — roughly the cluster glyph's own diameter, so adjacent
   *  records never visually overlap. */
  clusterPx?: number;
  /** Radius of the cluster mark. */
  markRadius?: number;
}

export interface ClinVarTrackData {
  records: ClinVarRecord[];
}

export interface PlacedClinVar {
  record: ClinVarRecord;
  exonIdx: number;
  cPos: number;
  /** Baseline (fit-gene) screen-x within the figure. */
  baselineX: number;
  /** Live screen-x after pan/zoom; used for clustering. */
  screenX: number;
}

export interface ClinVarCluster {
  id: string;
  members: PlacedClinVar[];
  /** Representative — the most clinically significant member; used to colour
   *  the cluster mark. */
  representative: PlacedClinVar;
  /** Median baseline-x across the cluster's members. */
  baselineX: number;
  /** Median live screen-x across the cluster's members. */
  screenX: number;
  /** Exon hosting the cluster — owns the per-exon `<g>` the mark renders into.
   *  Picked from the representative member so the mark animates with that
   *  exon during pan/zoom. */
  exonIdx: number;
  /** Highest-severity significance among members; drives the cluster fill. */
  topSignificance: ClinVarSignificance;
}

const DEFAULT_HEIGHT = 28;
const DEFAULT_CLUSTER_PX = 14;
const DEFAULT_MARK_RADIUS = 5;

const SIGNIFICANCE_VAR: Record<ClinVarSignificance, string> = {
  pathogenic: 'vv-clinvar-color-pathogenic',
  likely_pathogenic: 'vv-clinvar-color-likely-pathogenic',
  uncertain_significance: 'vv-clinvar-color-uncertain',
  likely_benign: 'vv-clinvar-color-likely-benign',
  benign: 'vv-clinvar-color-benign',
  conflicting: 'vv-clinvar-color-conflicting',
  other: 'vv-clinvar-color-other',
};

const SIGNIFICANCE_FALLBACK: Record<ClinVarSignificance, string> = {
  pathogenic: '#b91c1c',
  likely_pathogenic: '#dc2626',
  uncertain_significance: '#a16207',
  likely_benign: '#65a30d',
  benign: '#16a34a',
  conflicting: '#7c3aed',
  other: '#64748b',
};

/** Stack rank used to pick a cluster's colour and the popover sort. The first
 *  item that appears in the cluster wins — pathogenic dominates over any
 *  weaker call, conflicting trails the path/benign axis so a cluster of
 *  conflicting calls still reads as conflicting, and `other` is the floor. */
const SIGNIFICANCE_RANK: Record<ClinVarSignificance, number> = {
  pathogenic: 0,
  likely_pathogenic: 1,
  conflicting: 2,
  uncertain_significance: 3,
  likely_benign: 4,
  benign: 5,
  other: 6,
};

export function clinVarSignificanceColor(s: ClinVarSignificance): string {
  return `var(--${SIGNIFICANCE_VAR[s]}, ${SIGNIFICANCE_FALLBACK[s]})`;
}

/** Project each record into the current viewport. Records whose genomic
 *  coordinate doesn't map to a CDS position (UTR / intergenic) or which fall
 *  on a collapsed intron are dropped — the cluster path is for *visible*
 *  features only, mirroring variant-track's `placed`/`unplaced` partition. */
export function placeClinVarRecords(
  records: ClinVarRecord[],
  viewport: Viewport,
  mapper: CoordinateMapper,
): { placed: PlacedClinVar[]; unplaced: ClinVarRecord[] } {
  const placed: PlacedClinVar[] = [];
  const unplaced: ClinVarRecord[] = [];
  for (const r of records) {
    const cds = mapper.genomicToCds(r.chr, r.pos);
    if (!cds || cds.offset !== 0) {
      unplaced.push(r);
      continue;
    }
    const exonHit = mapper.findExonByCds(cds.cPos);
    if (!exonHit) {
      unplaced.push(r);
      continue;
    }
    const screenX = viewport.cdsToScreen(cds.cPos, 0);
    if (screenX === null) {
      unplaced.push(r);
      continue;
    }
    const baselineX = viewport.cdsToBaselineX(cds.cPos);
    placed.push({
      record: r,
      exonIdx: exonHit.exonIdx,
      cPos: cds.cPos,
      baselineX,
      screenX,
    });
  }
  return { placed, unplaced };
}

/** Greedy density clustering: sort placements by live screen-x and merge any
 *  whose neighbour-distance is below the threshold. The threshold is in
 *  *screen* pixels so the user-visible density changes with zoom — fit-gene
 *  produces broad clusters, deep zoom breaks them apart. */
export function clusterClinVar(
  placed: PlacedClinVar[],
  clusterPx: number,
): ClinVarCluster[] {
  const sorted = placed.slice().sort((a, b) => a.screenX - b.screenX);
  const out: ClinVarCluster[] = [];
  let current: PlacedClinVar[] = [];
  let last: number | null = null;
  const flush = () => {
    if (current.length === 0) return;
    const members = current;
    const sortedByScreen = members.slice().sort((a, b) => a.screenX - b.screenX);
    const median = sortedByScreen[Math.floor(sortedByScreen.length / 2)]!;
    let rep = members[0]!;
    for (const m of members) {
      if (SIGNIFICANCE_RANK[m.record.significance] < SIGNIFICANCE_RANK[rep.record.significance]) {
        rep = m;
      }
    }
    const id = members.length === 1
      ? `member:${members[0]!.record.id}`
      : `cluster:${members[0]!.record.id}+${members.length - 1}`;
    out.push({
      id,
      members,
      representative: rep,
      baselineX: median.baselineX,
      screenX: median.screenX,
      exonIdx: median.exonIdx,
      topSignificance: rep.record.significance,
    });
    current = [];
  };
  for (const p of sorted) {
    if (last !== null && p.screenX - last < clusterPx) {
      current.push(p);
      last = p.screenX;
      continue;
    }
    flush();
    current.push(p);
    last = p.screenX;
  }
  flush();
  return out;
}

export function clinVarTrack(
  config: ClinVarTrackConfig,
): Track<ClinVarTrackConfig, ClinVarTrackData> {
  const id = config.id ?? 'clinvar-track';
  const trackHeight = config.height ?? DEFAULT_HEIGHT;
  const clusterPx = config.clusterPx ?? DEFAULT_CLUSTER_PX;
  const markRadius = config.markRadius ?? DEFAULT_MARK_RADIUS;
  const source = config.source;

  return {
    id,
    coordSystem: 'genomic',
    heightPolicy: 'fixed',

    async load({ viewport, signal }: TrackLoadArgs): Promise<ClinVarTrackData> {
      const records = isDataSource<ViewportQuery, ClinVarRecord[]>(source)
        ? await source.query({ mode: viewport.mode, range: viewport.range }, signal)
        : source.slice();
      return { records };
    },

    height(_args: TrackHeightArgs<ClinVarTrackData>): TrackHeightResult {
      return { px: trackHeight, didTruncate: false };
    },

    render(args: TrackRenderArgs<ClinVarTrackData>): ReactNode {
      return (
        <ClinVarBody
          key={id}
          trackId={id}
          clusterPx={clusterPx}
          markRadius={markRadius}
          args={args}
        />
      );
    },

    resolveAnchor(data, anchorId, viewport) {
      const r = data.records.find((x) => x.id === anchorId);
      if (!r) return null;
      return viewport.resolveAnchor({ kind: 'genomic-pos', chr: r.chr, pos: r.pos });
    },

    resolveFeature(data, featureId) {
      return data.records.find((x) => x.id === featureId) ?? null;
    },

    featureLabel(data, featureId) {
      const r = data.records.find((x) => x.id === featureId);
      if (!r) return null;
      const cond = r.condition ? ` — ${r.condition}` : '';
      return `${r.label} (${humanSignificance(r.significance)})${cond}`;
    },

    toJSON() {
      return { id, source, height: trackHeight, clusterPx, markRadius };
    },
  };
}

interface ClinVarBodyProps {
  trackId: string;
  clusterPx: number;
  markRadius: number;
  args: TrackRenderArgs<ClinVarTrackData>;
}

function ClinVarBody({ trackId, clusterPx, markRadius, args }: ClinVarBodyProps): ReactNode {
  const { data, rect, viewport, mapper, painter, onFeatureHover, onFeatureClick } = args;
  const [openClusterKey, setOpenClusterKey] = useState<string | null>(null);

  // Close the popover when the data changes underneath us — a re-query or
  // mode switch may delete the cluster we were pointing at, and stale-state
  // would render an orphan overlay.
  const dataRef = useRef(data.records);
  useEffect(() => {
    if (dataRef.current !== data.records) {
      dataRef.current = data.records;
      setOpenClusterKey(null);
    }
  }, [data.records]);

  const { placed } = placeClinVarRecords(data.records, viewport, mapper);
  const clusters = clusterClinVar(placed, clusterPx);

  const baseline = viewport.baselineGeometry();
  const exonByIdx = new Map<number, ExonBaseline>();
  for (const eb of baseline.exons) exonByIdx.set(eb.exonIdx, eb);

  const midY = (rect.yTop + rect.yBottom) / 2;
  const tickHalf = Math.min(markRadius + 2, (rect.yBottom - rect.yTop) / 2 - 1);

  const groups: ReactNode[] = [];
  for (const cluster of clusters) {
    const exon = exonByIdx.get(cluster.exonIdx);
    if (!exon) continue;
    const localX = cluster.baselineX - exon.xStart;
    const isMulti = cluster.members.length > 1;
    const fill = clinVarSignificanceColor(cluster.topSignificance);
    const isOpen = openClusterKey === cluster.id;
    const isSingle = cluster.members.length === 1;
    const memberId = isSingle ? cluster.members[0]!.record.id : null;
    const featureId = memberId ?? cluster.id;

    const handleEnter = () => {
      if (memberId) onFeatureHover?.(memberId);
    };
    const handleLeave = () => {
      if (memberId) onFeatureHover?.(null);
    };
    const handleClick = (e: React.MouseEvent<SVGGElement>) => {
      e.stopPropagation();
      if (isMulti) {
        setOpenClusterKey((prev) => (prev === cluster.id ? null : cluster.id));
        return;
      }
      if (memberId) onFeatureClick?.(memberId);
    };

    const counterScale = `scaleX(calc(1 / var(--vv-exon-scale-x-${cluster.exonIdx}, 1)))`;

    groups.push(
      painter.placeInExonGroup(
        cluster.exonIdx,
        <g
          key={`clinvar-cluster-${cluster.id}`}
          className={[
            'vv-clinvar-mark',
            isMulti && 'is-cluster',
            isOpen && 'is-open',
          ]
            .filter(Boolean)
            .join(' ')}
          data-vv-feature-id={featureId}
          data-vv-cluster-id={isMulti ? cluster.id : undefined}
          data-vv-cluster-size={cluster.members.length}
          data-vv-significance={cluster.topSignificance}
          transform={`translate(${localX} 0)`}
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
          onClick={handleClick}
          style={{ cursor: 'pointer' }}
          tabIndex={0}
          role="button"
          aria-label={
            isMulti
              ? `ClinVar cluster of ${cluster.members.length} variants`
              : cluster.members[0]!.record.label
          }
        >
          <line
            className="vv-clinvar-tick"
            x1={0}
            x2={0}
            y1={midY - tickHalf}
            y2={midY + tickHalf}
            stroke={fill}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
          <g
            className="vv-clinvar-shape"
            style={{ transform: counterScale, transformOrigin: '0 0' }}
          >
            {isMulti ? (
              <ClusterDiamond
                cx={0}
                cy={rect.yTop + markRadius + 2}
                r={markRadius}
                fill={fill}
                count={cluster.members.length}
              />
            ) : (
              <circle
                className="vv-clinvar-dot"
                cx={0}
                cy={rect.yTop + markRadius + 2}
                r={markRadius}
                fill={fill}
                stroke="var(--vv-clinvar-dot-stroke, #ffffff)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            )}
          </g>
        </g>,
      ),
    );
  }

  // The popover lives outside any exon group so its layout doesn't pick up
  // the per-exon scaleX — list rows and the backdrop stay rectangular at all
  // zoom levels. Position is the cluster's *live* screen-x (already accounts
  // for the current pan/zoom); during a CSS-animated zoom the popover snaps
  // to the new position rather than tweening, which is fine because the user
  // would dismiss it before re-aiming the view anyway.
  let popoverNode: ReactNode = null;
  const openCluster = openClusterKey
    ? clusters.find((c) => c.id === openClusterKey)
    : null;
  if (openCluster) {
    popoverNode = (
      <ClusterPopover
        cluster={openCluster}
        rect={rect}
        viewport={viewport}
        figureWidth={baseline.totalWidth}
        onClose={() => setOpenClusterKey(null)}
        onMemberClick={(featureId) => {
          onFeatureClick?.(featureId);
          setOpenClusterKey(null);
        }}
        onMemberHover={(featureId) => onFeatureHover?.(featureId)}
      />
    );
  }

  return (
    <g className="vv-clinvar-track" data-vv-track-id={trackId} key={trackId}>
      {groups}
      {popoverNode}
    </g>
  );
}

interface ClusterDiamondProps {
  cx: number;
  cy: number;
  r: number;
  fill: string;
  count: number;
}

function ClusterDiamond({ cx, cy, r, fill, count }: ClusterDiamondProps): ReactNode {
  const d = `M ${cx} ${cy - r} L ${cx + r} ${cy} L ${cx} ${cy + r} L ${cx - r} ${cy} Z`;
  return (
    <Fragment>
      <path
        className="vv-clinvar-diamond"
        d={d}
        fill={fill}
        stroke="var(--vv-clinvar-dot-stroke, #ffffff)"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      <text
        className="vv-clinvar-count"
        x={cx}
        y={cy}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={Math.max(8, r * 1.4)}
        fontWeight={600}
        fill="var(--vv-clinvar-count-fill, #ffffff)"
      >
        {count}
      </text>
    </Fragment>
  );
}

interface ClusterPopoverProps {
  cluster: ClinVarCluster;
  rect: { yTop: number; yBottom: number };
  viewport: Viewport;
  figureWidth: number;
  onClose: () => void;
  onMemberClick: (featureId: string) => void;
  onMemberHover: (featureId: string | null) => void;
}

const POPOVER_ROW_H = 16;
const POPOVER_PAD = 8;
const POPOVER_FONT = 11;
const POPOVER_WIDTH = 220;

function ClusterPopover({
  cluster,
  rect,
  viewport,
  figureWidth,
  onClose,
  onMemberClick,
  onMemberHover,
}: ClusterPopoverProps): ReactNode {
  const liveX = viewport.cdsToScreen(cluster.representative.cPos, 0);
  if (liveX === null) return null;
  const sortedMembers = cluster.members.slice().sort((a, b) => {
    const ra = SIGNIFICANCE_RANK[a.record.significance];
    const rb = SIGNIFICANCE_RANK[b.record.significance];
    if (ra !== rb) return ra - rb;
    return a.record.pos - b.record.pos;
  });
  const rowCount = sortedMembers.length;
  const titleH = POPOVER_ROW_H + 4;
  const innerH = titleH + rowCount * POPOVER_ROW_H + POPOVER_PAD * 2;
  const innerW = POPOVER_WIDTH;
  // Always anchor the popover above the cluster mark. When the cluster lives
  // in the topmost track we clamp `popY ≥ 0` and let the popover ride the
  // figure top edge; visual overlap with upper tracks is acceptable for a
  // click-pinned overlay and keeps the popover inside the figure SVG so it
  // stays hit-testable (the figure clips overflow, which would otherwise
  // mask a popover painted below the last track).
  const popY = Math.max(0, rect.yTop - innerH - 6);
  let popX = liveX - innerW / 2;
  if (popX < 4) popX = 4;
  if (popX + innerW > figureWidth - 4) popX = figureWidth - innerW - 4;

  // The backdrop captures click-outside dismissal. Sizing it to the figure's
  // width and a tall (clipped) height keeps every click inside the figure
  // hit-testable; clicks beyond the figure SVG fall through to whatever
  // host chrome is below.
  return (
    <g
      className="vv-clinvar-popover-layer"
      data-testid="clinvar-popover"
      data-vv-cluster-id={cluster.id}
    >
      <rect
        className="vv-clinvar-popover-backdrop"
        data-testid="clinvar-popover-backdrop"
        x={0}
        y={0}
        width={figureWidth}
        height={10000}
        fill="transparent"
        onClick={onClose}
        style={{ cursor: 'default' }}
      />
      <g transform={`translate(${popX} ${popY})`} className="vv-clinvar-popover">
        <rect
          x={0}
          y={0}
          width={innerW}
          height={innerH}
          rx={4}
          ry={4}
          fill="var(--vv-clinvar-popover-bg, #ffffff)"
          stroke="var(--vv-clinvar-popover-stroke, #cbd5e1)"
          strokeWidth={1}
        />
        <text
          x={POPOVER_PAD}
          y={POPOVER_PAD + POPOVER_FONT}
          fontSize={POPOVER_FONT}
          fontWeight={600}
          fill="var(--vv-color-text-primary, #0f172a)"
        >
          {`${cluster.members.length} ClinVar variants`}
        </text>
        {sortedMembers.map((m, i) => {
          const r = m.record;
          const rowY = POPOVER_PAD + titleH + i * POPOVER_ROW_H;
          const fill = clinVarSignificanceColor(r.significance);
          return (
            <g
              key={r.id}
              className="vv-clinvar-popover-row"
              data-vv-feature-id={r.id}
              data-vv-significance={r.significance}
              transform={`translate(0 ${rowY})`}
              onMouseEnter={() => onMemberHover(r.id)}
              onMouseLeave={() => onMemberHover(null)}
              onClick={(e) => {
                e.stopPropagation();
                onMemberClick(r.id);
              }}
              style={{ cursor: 'pointer' }}
            >
              <rect
                x={0}
                y={0}
                width={innerW}
                height={POPOVER_ROW_H}
                fill="transparent"
              />
              <circle cx={POPOVER_PAD + 4} cy={POPOVER_ROW_H / 2} r={4} fill={fill} />
              <text
                x={POPOVER_PAD + 14}
                y={POPOVER_ROW_H / 2}
                fontSize={POPOVER_FONT}
                dominantBaseline="central"
                fill="var(--vv-color-text-primary, #0f172a)"
              >
                {truncate(r.label, 26)}
              </text>
              <text
                x={innerW - POPOVER_PAD}
                y={POPOVER_ROW_H / 2}
                fontSize={POPOVER_FONT - 1}
                textAnchor="end"
                dominantBaseline="central"
                fill="var(--vv-color-text-secondary, #475569)"
              >
                {humanSignificance(r.significance)}
              </text>
            </g>
          );
        })}
      </g>
    </g>
  );
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(1, max - 1)) + '…';
}

const SIGNIFICANCE_LABEL: Record<ClinVarSignificance, string> = {
  pathogenic: 'Pathogenic',
  likely_pathogenic: 'Likely pathogenic',
  uncertain_significance: 'VUS',
  likely_benign: 'Likely benign',
  benign: 'Benign',
  conflicting: 'Conflicting',
  other: 'Other',
};

export function humanSignificance(s: ClinVarSignificance): string {
  return SIGNIFICANCE_LABEL[s];
}

/** Normalise the various spellings ClinVar uses for clinical significance
 *  into the bucket used by the track. The matcher is permissive — multi-call
 *  records like "Pathogenic/Likely pathogenic" pick the dominant call;
 *  "Conflicting interpretations of pathogenicity" maps to `conflicting`. */
export function parseClinVarSignificance(raw: string): ClinVarSignificance {
  const s = raw.trim().toLowerCase();
  if (!s) return 'other';
  if (s.includes('conflict')) return 'conflicting';
  if (s.includes('pathogenic') && !s.includes('likely') && !s.includes('non-')) {
    return 'pathogenic';
  }
  if (s.includes('likely pathogenic') || s.startsWith('lp')) return 'likely_pathogenic';
  if (s.includes('likely benign')) return 'likely_benign';
  if (s.includes('benign') && !s.includes('non-')) return 'benign';
  if (s.includes('uncertain') || s.startsWith('vus')) return 'uncertain_significance';
  return 'other';
}
