/* eslint-disable react-refresh/only-export-components -- the React components in
 * this file (ClinVarBody / ClusterDiamond / ClusterPopover) are private and
 * only used by `clinVarTrack` below; HMR doesn't apply to the track factory's
 * own exports so the rule's caution doesn't fit here. */
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { glyphPath, type SymbolEncoding } from '../symbol-encoding.js';
import { resolveSourceData } from '../data-source.js';
import { packLanes } from '../pack-lanes.js';
import {
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
  /** Total track height in pixels (cluster style only). Ignored when
   *  {@link stackedVariantStyle} is set — stacked render uses
   *  `heightPolicy: 'data-dependent'` and grows to fit packed lanes. */
  height?: number;
  /** Pixel threshold for density clustering. Records whose live screen-x
   *  positions are within this distance are merged into one cluster mark.
   *  Defaults to 14px — roughly the cluster glyph's own diameter, so adjacent
   *  records never visually overlap. */
  clusterPx?: number;
  /** Radius of the cluster mark. */
  markRadius?: number;
  /** Opt in to the stacked-symbol render (Slice 27). When supplied the track
   *  suppresses density-clustering — every record renders as its own
   *  pure-symbol glyph in a packed-lane column. */
  stackedVariantStyle?: SymbolEncoding<ClinVarRecord>;
  /** Per-row pitch for the stacked render. Defaults to `2 * markRadius + 2`. */
  stackLanePx?: number;
  /** Optional predicate applied to the loaded record set before clustering
   *  and packing. Returning `false` drops the record from every display
   *  surface (cluster marks, stacked glyphs, cluster popover, on-figure
   *  count). Pure display filter — hosts that want to permanently exclude
   *  records should narrow `source` instead. Applied at render time so the
   *  host can swap predicates without invalidating the cached load. */
  filter?: (record: ClinVarRecord) => boolean;
  /** Surfaced as {@link Track.configKey} so the viewer can detect filter /
   *  encoding changes that reshape the laid-out data and re-run `load()`.
   *  Hosts should derive this from anything that affects packing
   *  (typically a hash of `filter`'s exclusion sets). */
  configKey?: string;
}

export interface ClinVarTrackData {
  records: ClinVarRecord[];
  /** Pre-computed stacked layout — populated only when the track was
   *  constructed with a `stackedVariantStyle`. */
  stackLayout?: ClinVarStackLayout;
}

export interface PlacedClinVarStacked extends PlacedClinVar {
  row: number;
  laneKey: string;
}

export interface ClinVarStackLayout {
  rowCount: number;
  placements: PlacedClinVarStacked[];
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
  pathogenic: 'hsl(343, 85%, 42%)',
  likely_pathogenic: 'hsl(24, 95%, 62%)',
  uncertain_significance: 'hsl(38, 92%, 50%)',
  likely_benign: 'hsl(150, 60%, 55%)',
  benign: 'hsl(162, 75%, 28%)',
  conflicting: '#94a3b8',
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
    const baselineX = viewport.cdsToBaselineX(cds.cPos);
    // Records outside the current screen window (cdsToScreen returns
    // null) used to land in `unplaced`. That made the stacked layout
    // re-pack on every pan/zoom — the figure SVG already clips
    // off-figure renderings (per the variant-track pattern) so keeping
    // them in `placed` lets stacked stay stable. `screenX` is stamped
    // with `Infinity` for off-screen records so `clusterClinVar` (which
    // sorts by screen-pixel distance) naturally pushes them past every
    // on-screen cluster and out of the cluster gap window.
    const liveScreenX = viewport.cdsToScreen(cds.cPos, 0);
    const screenX = liveScreenX ?? Infinity;
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
  // Off-screen placements carry `screenX = Infinity` (so they don't
  // collide with on-screen cluster windows). Filter them out before
  // clustering — they'd otherwise emit singleton clusters off-figure
  // that bloat the DOM with no visual benefit. The figure SVG's
  // overflow: hidden was already clipping them.
  const onScreen = placed.filter((p) => Number.isFinite(p.screenX));
  const sorted = onScreen.slice().sort((a, b) => a.screenX - b.screenX);
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

/** Pack ClinVar placements into stacked rows. Mirrors `packStackedVariants`
 *  for the variant track: group by `encoding.lane()`, sort each group by
 *  current-zoom layout-x, assign each record to the lowest local row whose
 *  previous occupant's right edge has cleared. Strict lane separation —
 *  items with different lane keys never share a row.
 *
 *  Unlike `packStackedVariants`, this packs against `viewport.baselineToLayoutX`
 *  rather than the raw baseline-x. The row count therefore shrinks as the
 *  user zooms in (glyphs spread far enough that previously-overlapping
 *  neighbours collapse into the same row). Pan is irrelevant because
 *  `baselineToLayoutX` adds the same display offset to every position,
 *  preserving relative distances. */
export function packStackedClinVar(
  placed: PlacedClinVar[],
  encoding: SymbolEncoding<ClinVarRecord>,
  viewport: Viewport,
  markRadius: number,
): ClinVarStackLayout {
  const groups = new Map<string, PlacedClinVar[]>();
  for (const p of placed) {
    const key = encoding.lane?.(p.record) ?? '_';
    let arr = groups.get(key);
    if (!arr) {
      arr = [];
      groups.set(key, arr);
    }
    arr.push(p);
  }
  // Lane block order: declared `laneOrder` first (top → bottom by host
  // intent — e.g. pathogenic → VUS → benign for ClinVar), then any
  // remaining lanes appended alphabetically. Deterministic across
  // reloads, gene changes, and out-of-order input.
  const groupOrder = orderedLaneKeys(groups, encoding.laneOrder);

  const placements: PlacedClinVarStacked[] = [];
  let rowOffset = 0;
  for (const key of groupOrder) {
    const items = groups.get(key)!;
    const inputs = items.map((p) => {
      const layoutX = viewport.baselineToLayoutX(p.baselineX);
      const r = encoding.radius?.(p.record) ?? markRadius;
      return {
        item: p,
        xStart: layoutX - r,
        xEnd: layoutX + r,
      };
    });

    inputs.sort(
      (a, b) =>
        (a.xStart + a.xEnd) / 2 - (b.xStart + b.xEnd) / 2 ||
        compareStrings(a.item.record.id, b.item.record.id),
    );

    const packed = packLanes(inputs, 0);

    for (const p of packed.items) {
      placements.push({
        ...p.item,
        row: rowOffset + p.lane,
        laneKey: key,
      });
    }
    rowOffset += packed.laneCount;
  }
  return { rowCount: rowOffset, placements };
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function orderedLaneKeys<T>(
  groups: Map<string, T>,
  declared: readonly string[] | undefined,
): string[] {
  const allKeys = [...groups.keys()];
  if (!declared || declared.length === 0) return allKeys.slice().sort(compareStrings);
  const declaredSet = new Set(declared);
  const ordered = declared.filter((k) => groups.has(k));
  const leftovers = allKeys
    .filter((k) => !declaredSet.has(k))
    .sort(compareStrings);
  return [...ordered, ...leftovers];
}

export function clinVarTrack(
  config: ClinVarTrackConfig,
): Track<ClinVarTrackConfig, ClinVarTrackData> {
  const id = config.id ?? 'clinvar-track';
  const trackHeight = config.height ?? DEFAULT_HEIGHT;
  const clusterPx = config.clusterPx ?? DEFAULT_CLUSTER_PX;
  const markRadius = config.markRadius ?? DEFAULT_MARK_RADIUS;
  const source = config.source;
  const stackedEncoding = config.stackedVariantStyle;
  const stackLanePx = config.stackLanePx ?? 2 * markRadius + 2;
  const filter = config.filter;
  const stackTopPad = 2;
  const stackBottomPad = 2;

  return {
    id,
    configKey: config.configKey,
    coordSystem: 'genomic',
    heightPolicy: stackedEncoding ? 'data-dependent' : 'fixed',

    async load({ viewport, mapper, signal }: TrackLoadArgs): Promise<ClinVarTrackData> {
      const records = await resolveSourceData(
        source,
        { mode: viewport.mode, range: viewport.range },
        signal,
      );
      let stackLayout: ClinVarStackLayout | undefined;
      if (stackedEncoding) {
        // Pack the filtered survivors so `height()` reads a row count
        // matching what `render` will actually draw. Without this, per-
        // significance tracks reserve lanes for every other significance
        // and the figure grows by a multiple of the visible rows.
        const visible = filter ? records.filter(filter) : records;
        const { placed } = placeClinVarRecords(visible, viewport, mapper);
        stackLayout = packStackedClinVar(placed, stackedEncoding, viewport, markRadius);
      }
      return { records, stackLayout };
    },

    height({ data }: TrackHeightArgs<ClinVarTrackData>): TrackHeightResult {
      if (stackedEncoding) {
        const rows = data?.stackLayout?.rowCount ?? 0;
        const px = Math.max(
          trackHeight,
          stackTopPad + rows * stackLanePx + stackBottomPad,
        );
        return { px, didTruncate: false };
      }
      return { px: trackHeight, didTruncate: false };
    },

    render(args: TrackRenderArgs<ClinVarTrackData>): ReactNode {
      if (stackedEncoding) {
        return (
          <ClinVarStackedBody
            key={id}
            trackId={id}
            encoding={stackedEncoding}
            markRadius={markRadius}
            laneHeight={stackLanePx}
            topPad={stackTopPad}
            filter={filter}
            args={args}
          />
        );
      }
      return (
        <ClinVarBody
          key={id}
          trackId={id}
          clusterPx={clusterPx}
          markRadius={markRadius}
          filter={filter}
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
      return {
        id,
        source,
        height: trackHeight,
        clusterPx,
        markRadius,
        stackedVariantStyle: stackedEncoding,
        stackLanePx,
      };
    },
  };
}

interface ClinVarStackedBodyProps {
  trackId: string;
  encoding: SymbolEncoding<ClinVarRecord>;
  markRadius: number;
  laneHeight: number;
  topPad: number;
  filter?: (record: ClinVarRecord) => boolean;
  args: TrackRenderArgs<ClinVarTrackData>;
}

function ClinVarStackedBody({
  trackId,
  encoding,
  markRadius,
  laneHeight,
  topPad,
  filter,
  args,
}: ClinVarStackedBodyProps): ReactNode {
  const { data, rect, viewport, mapper, interaction, painter, onFeatureHover, onFeatureClick } =
    args;
  // When a host filter is in play, the pre-computed `data.stackLayout` (which
  // was packed against the full record set in `load`) no longer reflects the
  // visible set — re-pack the survivors live. Without a filter we keep the
  // cached layout to avoid the per-render pack cost.
  const records = useMemo(
    () => (filter ? data.records.filter(filter) : data.records),
    [data.records, filter],
  );
  const layout = useMemo(() => {
    if (!filter && data.stackLayout) return data.stackLayout;
    return packStackedClinVar(
      placeClinVarRecords(records, viewport, mapper).placed,
      encoding,
      viewport,
      markRadius,
    );
  }, [records, filter, data.stackLayout, viewport, mapper, encoding, markRadius]);

  const byExon = new Map<number, PlacedClinVarStacked[]>();
  for (const p of layout.placements) {
    let arr = byExon.get(p.exonIdx);
    if (!arr) {
      arr = [];
      byExon.set(p.exonIdx, arr);
    }
    arr.push(p);
  }

  const baseline = viewport.baselineGeometry();
  const exonByIdx = new Map<number, ExonBaseline>();
  for (const eb of baseline.exons) exonByIdx.set(eb.exonIdx, eb);

  const groups: ReactNode[] = [];
  for (const [exonIdx, placements] of byExon) {
    const exon = exonByIdx.get(exonIdx);
    if (!exon) continue;
    const counterScale = `scaleX(calc(1 / var(--vv-exon-scale-x-${exonIdx}, 1)))`;
    const inner = placements.map((p) => {
      const r = encoding.radius?.(p.record) ?? markRadius;
      const cy = rect.yTop + topPad + r + p.row * laneHeight;
      const shape = encoding.shape(p.record);
      const fill = encoding.fill(p.record);
      const stroke = encoding.color?.(p.record) ?? fill;
      const d = glyphPath(shape, r);
      const isHovered = interaction.hoveredFeatureId === p.record.id;
      const isSelected = interaction.selectedFeatureIds.has(p.record.id);
      const localX = p.baselineX - exon.xStart;
      const cls = [
        'vv-clinvar-mark',
        'vv-clinvar-mark-stacked',
        isHovered && 'is-hovered',
        isSelected && 'is-selected',
      ]
        .filter(Boolean)
        .join(' ');
      return (
        <g
          key={p.record.id}
          className={cls}
          data-vv-feature-id={p.record.id}
          data-vv-significance={p.record.significance}
          data-vv-stack-row={p.row}
          data-vv-stack-lane={p.laneKey}
          data-vv-shape={shape}
          transform={`translate(${localX} 0)`}
          onMouseEnter={onFeatureHover ? () => onFeatureHover(p.record.id) : undefined}
          onMouseLeave={onFeatureHover ? () => onFeatureHover(null) : undefined}
          onClick={onFeatureClick ? () => onFeatureClick(p.record.id) : undefined}
          style={{ cursor: 'pointer' }}
          tabIndex={0}
          role="button"
          aria-label={p.record.label}
        >
          <g
            className="vv-clinvar-shape"
            style={{ transform: counterScale, transformOrigin: '0 0' }}
          >
            <g transform={`translate(0 ${cy})`}>
              <circle
                className="vv-clinvar-ring"
                cx={0}
                cy={0}
                r={r + 3}
                fill="none"
                stroke={stroke}
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
              />
              <path
                className="vv-clinvar-glyph"
                d={d}
                fill={fill}
                stroke="var(--vv-clinvar-dot-stroke, #ffffff)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          </g>
        </g>
      );
    });
    groups.push(
      painter.placeInExonGroup(
        exonIdx,
        <Fragment key={`clinvar-stacked-exon-${exonIdx}`}>{inner}</Fragment>,
      ),
    );
  }

  return (
    <g
      className="vv-clinvar-track vv-clinvar-track-stacked"
      data-vv-track-id={trackId}
      data-vv-stack-rows={layout.rowCount}
      key={trackId}
    >
      {groups}
    </g>
  );
}

interface ClinVarBodyProps {
  trackId: string;
  clusterPx: number;
  markRadius: number;
  filter?: (record: ClinVarRecord) => boolean;
  args: TrackRenderArgs<ClinVarTrackData>;
}

function ClinVarBody({ trackId, clusterPx, markRadius, filter, args }: ClinVarBodyProps): ReactNode {
  const { data, rect, viewport, mapper, painter, onFeatureHover, onFeatureClick } = args;
  const [openClusterKey, setOpenClusterKey] = useState<string | null>(null);

  // Surviving records after the host filter. Memoise so identity is stable
  // across renders that don't change `data.records` or the filter — otherwise
  // the popover-reset effect below would fire on every re-render.
  const records = useMemo(
    () => (filter ? data.records.filter(filter) : data.records),
    [data.records, filter],
  );

  // Close the popover when the data changes underneath us — a re-query, mode
  // switch, or filter change may delete the cluster we were pointing at, and
  // stale state would render an orphan overlay.
  const recordsRef = useRef(records);
  useEffect(() => {
    if (recordsRef.current !== records) {
      recordsRef.current = records;
      setOpenClusterKey(null);
    }
  }, [records]);

  const { placed } = placeClinVarRecords(records, viewport, mapper);
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
