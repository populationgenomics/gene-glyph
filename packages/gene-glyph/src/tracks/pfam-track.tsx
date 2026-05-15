import { Fragment, type ReactNode } from 'react';
import type {
  CoordinateMapper,
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
  segments: RangeSegment[];
  /** Leftmost xStart across all segments. */
  xStart: number;
  /** Rightmost xEnd across all segments. */
  xEnd: number;
  /** Midpoint of [xStart, xEnd] in screen-x. */
  xMid: number;
}

const DEFAULT_HEIGHT = 28;
const DEFAULT_HALF = 8;
const DEFAULT_LABEL_GUTTER = 4;
const DEFAULT_LABEL_FONT = 11;
const DEFAULT_LABEL_OFFSET = 4;
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
      const { data, rect, viewport, mapper, painter } = args;
      if (data.domains.length === 0) return null;

      const placed = data.domains
        .map((d) => placeDomain(d, viewport))
        .filter((p): p is PlacedDomain => p !== null)
        .sort((a, b) => a.xMid - b.xMid);

      if (placed.length === 0) return null;

      const segmentNodes: ReactNode[] = [];
      const linkerNodes: ReactNode[] = [];
      const labelNodes: ReactNode[] = [];

      const trackLeft = 0;
      const trackRight = viewport.width;

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
          mapper,
          viewport,
          painter,
          segmentNodes,
          linkerNodes,
          labelNodes,
        });
      }

      return (
        <g className="vv-pfam-track" data-vv-track-id={id} key={id}>
          {linkerNodes}
          {segmentNodes}
          {labelNodes}
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
  mapper: CoordinateMapper;
  viewport: Viewport;
  painter: Painter;
  segmentNodes: ReactNode[];
  linkerNodes: ReactNode[];
  labelNodes: ReactNode[];
}

function emitDomain(args: EmitArgs): void {
  const {
    placed,
    rect,
    rectHalf,
    labelMaxW,
    labelFont,
    labelOffset,
    mapper,
    viewport,
    painter,
    segmentNodes,
    linkerNodes,
    labelNodes,
  } = args;

  const domain = placed.domain;
  const featureId = idOfDomain(domain);
  const fill = domainHue(domain.sourceId || domain.shortName);
  const fullName = domain.description || domain.shortName;
  const tooltip = `${fullName} (aa ${domain.aaStart}–${domain.aaEnd})`;

  const midY = (rect.yTop + rect.yBottom) / 2;
  const rectY = midY - rectHalf;
  const rectH = rectHalf * 2;
  const exons = mapper.transcript.exons;

  for (const seg of placed.segments) {
    const exon = exons[seg.exonIdx];
    if (!exon) continue;
    const exonScreenStart = viewport.cdsToScreen(exon.cdsStart, 0);
    if (exonScreenStart === null) continue;
    const localX = seg.xStart - exonScreenStart;
    const width = Math.max(1, seg.xEnd - seg.xStart);
    segmentNodes.push(
      painter.placeInExonGroup(
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
            className: 'vv-pfam-rect',
          })}
        </Fragment>,
      ),
    );
  }

  // Linker over each collapsed-intron gap between consecutive segments. Lives
  // inside the inter-exon decoration group so its opacity collapses with the
  // dashed gap when the viewer switches to a spliced mode (intronScale = 0).
  for (let i = 0; i < placed.segments.length - 1; i++) {
    const a = placed.segments[i]!;
    const b = placed.segments[i + 1]!;
    if (b.xStart <= a.xEnd) continue;
    linkerNodes.push(
      painter.placeInInterExon(
        a.exonIdx,
        b.exonIdx,
        <Fragment key={`pfam-${featureId}-link-${a.exonIdx}-${b.exonIdx}`}>
          <line
            key={`pfam-${featureId}-link-line-${a.exonIdx}-${b.exonIdx}`}
            x1={a.xEnd}
            x2={b.xStart}
            y1={midY}
            y2={midY}
            stroke={fill}
            strokeWidth={1.5}
            strokeLinecap="round"
            className="vv-pfam-linker"
          />
        </Fragment>,
      ),
    );
  }

  // Label: centred on the domain's visual midpoint, drawn in absolute screen
  // space. Width is bounded by half-distance to either neighbour's midpoint
  // (or a symmetric reflection of the lone-domain edge), then truncated with
  // fitText so wide labels never bleed into adjacent domains' labels.
  const label = fitText(fullName, labelMaxW, labelFont);
  if (label) {
    labelNodes.push(
      <text
        key={`pfam-${featureId}-label`}
        x={placed.xMid}
        y={rectY - labelOffset}
        textAnchor="middle"
        dominantBaseline="auto"
        fontSize={labelFont}
        fill={painter.color('vv-color-pfam-label', '#475569')}
        className="vv-pfam-label"
      >
        <title>{tooltip}</title>
        {label}
      </text>,
    );
  }
}
