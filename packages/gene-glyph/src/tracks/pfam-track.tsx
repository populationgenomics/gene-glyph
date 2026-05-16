import { Fragment, type ReactNode } from 'react';
import type {
  ExonBaseline,
  Painter,
  ProteinDomain,
  RangeSegment,
  Track,
  TrackHeightArgs,
  TrackHeightResult,
  TrackLoadArgs,
  TrackRect,
  TrackRenderArgs,
  Viewport,
} from '../types.js';

export interface PfamTrackConfig {
  id?: string;
  /** Total track height in pixels. */
  height?: number;
  /** Half-thickness of the rounded rect drawn for each domain segment. */
  rectHalfHeight?: number;
  /** Pixel gap between a label's bounding box and the neighbouring domain's
   *  midpoint; widens the no-overlap budget. */
  labelGutter?: number;
  /** Font size used both for the label and the half-distance label budget. */
  labelFontSize?: number;
  /** Vertical offset of the label above the rectangle's top edge. */
  labelOffset?: number;
  /** Override the default `source.toLowerCase() === 'pfam'` filter. Useful for
   *  tests, and for hosts whose ProteinAnnotations carries multiple sources
   *  through the same record. */
  domainFilter?: (domain: ProteinDomain) => boolean;
}

export interface PfamTrackData {
  domains: ProteinDomain[];
}

interface PlacedDomain {
  domain: ProteinDomain;
  /** Baseline-frame segments — one per exon the domain intersects. */
  segments: RangeSegment[];
  /** Leftmost baseline xStart across all segments. */
  xStart: number;
  /** Rightmost baseline xEnd across all segments. */
  xEnd: number;
  /** Baseline midpoint of [xStart, xEnd]. */
  xMid: number;
}

const DEFAULT_HEIGHT = 32;
const DEFAULT_HALF = 7;
const DEFAULT_LABEL_GUTTER = 4;
const DEFAULT_LABEL_FONT = 11;
const DEFAULT_LABEL_OFFSET = 3;
const DEFAULT_BOTTOM_PAD = 2;
const CHAR_W_PER_PT = 0.58;

function defaultPfamFilter(d: ProteinDomain): boolean {
  return d.source.toLowerCase() === 'pfam';
}

/** Stable HSL fill keyed off a domain identifier so a given Pfam family gets
 *  the same colour across the page (and across genes). Ported from
 *  lit-manager's `domainHue`. */
export function domainHue(key: string): string {
  if (!key) return 'hsl(220, 30%, 60%)';
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return `hsl(${hue}, 65%, 58%)`;
}

/** Truncate `text` to fit inside `maxW` at `fontSize`, appending an ellipsis
 *  if shortened. Returns an empty string when there's not room for even two
 *  characters — hosts use the tooltip for the full name in that case.
 *  Ported from lit-manager's `fitText` so cross-page label behaviour matches. */
export function fitText(text: string, maxW: number, fontSize: number): string {
  if (!text) return '';
  const charW = fontSize * CHAR_W_PER_PT;
  if (maxW < charW * 3) return '';
  const maxChars = Math.floor(maxW / charW);
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(1, maxChars - 1)) + '…';
}

export function pfamTrack(
  config: PfamTrackConfig = {},
): Track<PfamTrackConfig, PfamTrackData> {
  const id = config.id ?? 'pfam-track';
  const trackHeight = config.height ?? DEFAULT_HEIGHT;
  const rectHalf = config.rectHalfHeight ?? DEFAULT_HALF;
  const labelGutter = config.labelGutter ?? DEFAULT_LABEL_GUTTER;
  const labelFont = config.labelFontSize ?? DEFAULT_LABEL_FONT;
  const labelOffset = config.labelOffset ?? DEFAULT_LABEL_OFFSET;
  const filter = config.domainFilter ?? defaultPfamFilter;

  return {
    id,
    coordSystem: 'protein',
    heightPolicy: 'fixed',

    async load({ protein }: TrackLoadArgs): Promise<PfamTrackData> {
      const domains = (protein?.domains ?? []).filter(filter);
      return { domains };
    },

    height(_args: TrackHeightArgs<PfamTrackData>): TrackHeightResult {
      return { px: trackHeight, didTruncate: false };
    },

    render(args: TrackRenderArgs<PfamTrackData>): ReactNode {
      const { data, rect, viewport, painter } = args;
      if (data.domains.length === 0) return null;

      const baseline = viewport.baselineGeometry();
      const exonByIdx = new Map<number, ExonBaseline>();
      for (const eb of baseline.exons) exonByIdx.set(eb.exonIdx, eb);

      const placed = data.domains
        .map((d) => placeDomain(d, viewport))
        .filter((p): p is PlacedDomain => p !== null)
        .sort((a, b) => a.xMid - b.xMid);

      if (placed.length === 0) return null;

      // Each exon owns ONE `<g class="vv-exon-group">` per track — that's the
      // wrapper the painter publishes per-exon transforms onto. Multiple Pfam
      // domains that overlap the same exon share that wrapper rather than each
      // emitting their own; otherwise the painter auto-keys both with
      // `exon-group-{N}`, React warns about duplicate keys, and we'd waste DOM
      // re-applying the same transform. Same for inter-exon linkers sharing a
      // gap.
      const rectsByExon = new Map<number, ReactNode[]>();
      const labelsByExon = new Map<number, ReactNode[]>();
      const linkersByGap = new Map<
        string,
        { exonIdxA: number; exonIdxB: number; nodes: ReactNode[] }
      >();

      const trackLeft = 0;
      const trackRight = baseline.totalWidth;

      for (let i = 0; i < placed.length; i++) {
        const p = placed[i]!;
        // Symmetric label budget — reflect the lone-domain edge through the
        // domain's own midpoint so a single domain still gets to use the
        // whole track. With neighbours, the closer side caps both halves so
        // labels never overrun centred labels on either side.
        const prevMid = i > 0 ? placed[i - 1]!.xMid : trackLeft - (p.xMid - trackLeft);
        const nextMid =
          i + 1 < placed.length ? placed[i + 1]!.xMid : trackRight + (trackRight - p.xMid);
        const maxHalf = Math.max(0, Math.min(p.xMid - prevMid, nextMid - p.xMid) / 2 - labelGutter);
        const labelMaxW = 2 * maxHalf;

        emitDomain({
          placed: p,
          rect,
          rectHalf,
          labelMaxW,
          labelFont,
          labelOffset,
          exonByIdx,
          painter,
          rectsByExon,
          labelsByExon,
          linkersByGap,
        });
      }

      const linkerGroups: ReactNode[] = [];
      for (const { exonIdxA, exonIdxB, nodes } of linkersByGap.values()) {
        linkerGroups.push(
          painter.placeInInterExon(
            exonIdxA,
            exonIdxB,
            <Fragment key={`pfam-linkers-${exonIdxA}-${exonIdxB}`}>
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
        // Rects first so labels paint over them inside the per-exon wrapper.
        exonGroups.push(
          painter.placeInExonGroup(
            idx,
            <Fragment key={`pfam-exon-${idx}`}>
              {rects}
              {labels}
            </Fragment>,
          ),
        );
      }

      return (
        <g className="vv-pfam-track" data-vv-track-id={id} key={id}>
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
      return {
        id,
        height: trackHeight,
        rectHalfHeight: rectHalf,
        labelGutter,
        labelFontSize: labelFont,
        labelOffset,
      };
    },
  };
}

function idOfDomain(d: ProteinDomain): string {
  return d.sourceId || `${d.source}:${d.aaStart}-${d.aaEnd}`;
}

function placeDomain(domain: ProteinDomain, viewport: Viewport): PlacedDomain | null {
  // projectProteinRange returns segments in **baseline** screen-x — the
  // viewport-independent frame at fit-gene. xMid here is a baseline-x value;
  // the wrapping exon `<g>` applies the live translate + scale.
  const proj = viewport.projectProteinRange(domain.aaStart, domain.aaEnd);
  if (proj.segments.length === 0) return null;
  let xStart = Infinity;
  let xEnd = -Infinity;
  for (const seg of proj.segments) {
    if (seg.xStart < xStart) xStart = seg.xStart;
    if (seg.xEnd > xEnd) xEnd = seg.xEnd;
  }
  return {
    domain,
    segments: proj.segments,
    xStart,
    xEnd,
    xMid: (xStart + xEnd) / 2,
  };
}

interface EmitArgs {
  placed: PlacedDomain;
  rect: TrackRect;
  rectHalf: number;
  labelMaxW: number;
  labelFont: number;
  labelOffset: number;
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
    rect,
    rectHalf,
    labelMaxW,
    labelFont,
    labelOffset,
    exonByIdx,
    painter,
    rectsByExon,
    labelsByExon,
    linkersByGap,
  } = args;

  const domain = placed.domain;
  const featureId = idOfDomain(domain);
  const fill = domainHue(domain.sourceId || domain.shortName);
  const fullName = domain.description || domain.shortName;
  const tooltip = `${fullName} (aa ${domain.aaStart}–${domain.aaEnd})`;

  // Anchor the rect to the bottom of the track so the label above it can
  // sit fully inside this track's vertical slot, clear of the exon ribbon
  // overhead. Earlier midY-centred layout meant the label overhung the
  // track into the exon track above; bottom-anchored layout reserves a
  // dedicated headroom strip equal to the font size + offset.
  const rectH = rectHalf * 2;
  const rectY = rect.yBottom - DEFAULT_BOTTOM_PAD - rectH;
  const midY = rectY + rectHalf;

  // Pick the segment that contains the domain's midpoint (or the nearest
  // one if the midpoint falls in a collapsed-intron gap). That segment's
  // exon owns the label so it animates with the surrounding exon group;
  // the label applies a counter-scale to undo the parent exon's scaleX.
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
      <Fragment key={`pfam-${featureId}-seg-${seg.exonIdx}`}>
        {painter.drawRect({
          key: `pfam-${featureId}-rect-${seg.exonIdx}`,
          x: localX,
          y: rectY,
          width,
          height: rectH,
          rx: 2,
          ry: 2,
          fill,
          stroke: painter.color('vv-color-pfam-stroke', '#475569'),
          strokeWidth: 0.75,
          vectorEffect: 'non-scaling-stroke',
          className: 'vv-pfam-rect',
        })}
      </Fragment>,
    );
  }

  // Linker over each collapsed-intron gap between consecutive segments. Lives
  // inside the inter-exon decoration group so its opacity collapses with the
  // dashed gap when the viewer switches to a spliced mode (intronScale = 0).
  for (let i = 0; i < placed.segments.length - 1; i++) {
    const a = placed.segments[i]!;
    const b = placed.segments[i + 1]!;
    if (b.xStart <= a.xEnd) continue;
    const gapKey = `${a.exonIdx}:${b.exonIdx}`;
    let bucket = linkersByGap.get(gapKey);
    if (!bucket) {
      bucket = { exonIdxA: a.exonIdx, exonIdxB: b.exonIdx, nodes: [] };
      linkersByGap.set(gapKey, bucket);
    }
    bucket.nodes.push(
      <line
        key={`pfam-${featureId}-link-line-${a.exonIdx}-${b.exonIdx}`}
        x1={0}
        x2={b.xStart - a.xEnd}
        y1={midY}
        y2={midY}
        stroke={fill}
        strokeWidth={1.5}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        className="vv-pfam-linker"
      />,
    );
  }

  // Label inside the chosen exon group: positioned at baseline mid-x relative
  // to that exon's baseline xStart, then wrapped in a counter-scale so the
  // parent exon's scaleX(zoom) doesn't horizontally stretch the glyphs. With
  // uniform per-exon zoom (Slice 10 model) the label lands at the correct
  // current screen midpoint regardless of which exon group hosts it.
  const label = fitText(fullName, labelMaxW, labelFont);
  if (label && labelExon) {
    const localXMid = placed.xMid - labelExon.xStart;
    pushTo(
      labelsByExon,
      labelExon.exonIdx,
      <g
        key={`pfam-${featureId}-label-wrap`}
        className="vv-pfam-label-wrap"
        style={{
          transform:
            `translateX(${localXMid}px) ` +
            `scaleX(calc(1 / var(--vv-exon-scale-x-${labelExon.exonIdx}, 1)))`,
          transformOrigin: '0 0',
        }}
      >
        <text
          key={`pfam-${featureId}-label`}
          x={0}
          y={rectY - labelOffset}
          textAnchor="middle"
          dominantBaseline="auto"
          fontSize={labelFont}
          fill={painter.color('vv-color-pfam-label', '#475569')}
          className="vv-pfam-label"
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
