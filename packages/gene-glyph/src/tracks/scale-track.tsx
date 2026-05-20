import { Fragment, type ReactNode } from 'react';
import type {
  CoordinateMapper,
  ExonBaseline,
  Track,
  TrackHeightArgs,
  TrackHeightResult,
  TrackLoadArgs,
  TrackRenderArgs,
  ViewMode,
  Viewport,
} from '../types.js';

export interface ScaleTrackConfig {
  id?: string;
  /** Total track height in pixels. Ticks hang from the band's baseline;
   *  labels sit above the major-tick height. Default 18. */
  height?: number;
  /** Tick step selection. `'auto'` runs a nice-number ladder against
   *  the baseline px-per-unit (deliberately not the live zoom) so the
   *  step stays stable as the user pans + zooms. Passing a number
   *  forces every major tick to that step. Default `'auto'`. */
  majorStep?: number | 'auto';
  /** Minor ticks per major step. `0` disables minor ticks. Default 5
   *  (so a step of 100 emits minor ticks every 20 units). */
  minorSubdivisions?: number;
  /** Minimum on-screen gap between consecutive major labels before the
   *  auto-step picker promotes to the next ladder rung. Default 32 px. */
  minLabelSpacingPx?: number;
  /** Major-tick label font size. Default 10. */
  labelFontSize?: number;
  /** `'last'` (default) appends the active unit (`bp` / `aa`) to the
   *  highest visible label so the ruler reads as `… 1,000 bp` /
   *  `… 393 aa`. `'never'` omits the suffix. */
  unitSuffix?: 'never' | 'last';
  /** Extra padding between adjacent label edges in baseline-x pixels.
   *  Bumping this makes the first-pass skip more conservative — labels
   *  get clear breathing room and the suffix-promotion re-check rarely
   *  has to drop a tick. Default 16. */
  labelPadPx?: number;
  /** Rotate major-tick labels in degrees. `0` (default) keeps text
   *  horizontal above the tick; `90` rotates the text counter-clockwise
   *  so labels read bottom-to-top stacked above their tick mark. Useful
   *  for dense scales where horizontal text would crash even after
   *  skipping: rotated labels' horizontal footprint shrinks to the
   *  font's height (~10 px) instead of the text's natural width
   *  (~30–50 px), so far more labels fit per inch of ruler.
   *
   *  When rotated, the track defaults to a taller `height` to fit the
   *  rotated text vertically. The host can override `height` directly. */
  labelRotation?: 0 | 90;
  /** Coordinate label format. `'c-notation'` (default) renders
   *  positions in HGVS c. coords (`c.100`, `c.1,000 bp`). `'genomic'`
   *  resolves each label through `mapper.cdsToGenomic` and renders
   *  the chromosomal position (`chr1:1,234,567`). The option applies
   *  in `genome` and `transcript` modes; `protein` mode is unaffected
   *  (always shows aa). Phase 4. */
  labelFormat?: 'c-notation' | 'genomic';
}

interface ScaleTrackData {
  ready: true;
}

const DEFAULT_HEIGHT = 18;
const DEFAULT_ROTATED_HEIGHT = 60;
const DEFAULT_MINOR_SUBDIVISIONS = 5;
const DEFAULT_MIN_LABEL_SPACING_PX = 32;
const DEFAULT_LABEL_FONT = 10;
const DEFAULT_LABEL_PAD_PX = 12;

const STEP_LADDER: readonly number[] = [
  1, 2, 5,
  10, 20, 50,
  100, 200, 500,
  1000, 2000, 5000,
  10000, 20000, 50000,
  100000, 200000, 500000,
  1000000,
];

/**
 * Slice 28 — coordinate ruler above the gene body. Renders major +
 * minor tick marks labelled in the viewer's active coord system
 * (CDS bp in `genome` / `transcript` modes, aa in
 * `protein`). The ruler rides per-exon CSS transforms exactly like
 * the exon track underneath, so it pans, zooms, and mode-transitions
 * in lock-step with the figure without any React re-render flicker.
 *
 * Tick step is picked against the *baseline* px-per-unit (fit-gene
 * geometry) rather than the live zoom; the step stays the same as
 * the user zooms in/out, so labels don't repop in / out of view at
 * every wheel tick.
 */
export function scaleTrack(config: ScaleTrackConfig = {}): Track<ScaleTrackConfig, ScaleTrackData> {
  const id = config.id ?? 'scale-track';
  const labelRotation = config.labelRotation ?? 0;
  const trackHeight =
    config.height ?? (labelRotation === 90 ? DEFAULT_ROTATED_HEIGHT : DEFAULT_HEIGHT);
  const majorStepConfig = config.majorStep ?? 'auto';
  const minorSubdivisions = config.minorSubdivisions ?? DEFAULT_MINOR_SUBDIVISIONS;
  const minLabelSpacingPx = config.minLabelSpacingPx ?? DEFAULT_MIN_LABEL_SPACING_PX;
  const labelFontSize = config.labelFontSize ?? DEFAULT_LABEL_FONT;
  const unitSuffix = config.unitSuffix ?? 'last';
  const labelPadPx = config.labelPadPx ?? DEFAULT_LABEL_PAD_PX;
  const labelFormat = config.labelFormat ?? 'c-notation';

  return {
    id,
    coordSystem: 'cds',
    heightPolicy: 'fixed',

    async load(_args: TrackLoadArgs): Promise<ScaleTrackData> {
      return { ready: true };
    },

    height(_args: TrackHeightArgs<ScaleTrackData>): TrackHeightResult {
      return { px: trackHeight, didTruncate: false };
    },

    render(args: TrackRenderArgs<ScaleTrackData>): ReactNode {
      const { rect, viewport, mapper, painter } = args;
      const unit = unitForMode(viewport.mode);
      const rulerLength = rulerLengthForMode(viewport);
      // Zoom-sensitive tick density: pick the step against the *live*
      // px-per-ruler-unit so the average on-screen spacing between major
      // ticks stays near `minLabelSpacingPx` regardless of zoom. As the
      // user zooms in, livePxPerUnit grows and the auto-step picker
      // drops to a finer ladder rung — so ticks stay roughly the same
      // density on screen instead of spreading further apart.
      //
      // The legacy behaviour (step picked against the fit-gene baseline
      // and kept stable across zoom) is still available by passing an
      // explicit `majorStep` number rather than 'auto'.
      const visibleRulerSpan = Math.max(
        1,
        viewport.range[1] - viewport.range[0],
      );
      const livePxPerUnit = viewport.width / visibleRulerSpan;
      const majorStep =
        majorStepConfig === 'auto'
          ? pickAutoStep(livePxPerUnit, minLabelSpacingPx, rulerLength)
          : Math.max(1, majorStepConfig);
      // Minor ticks subdivide the major step. Floor at 1 ruler unit
      // (a bp in CDS modes, an aa in protein) so deep zoom doesn't draw
      // sub-nucleotide ticks — there's no addressable position there
      // and the visual clutter buries the actual bp letters / aa
      // glyphs. When the major step is already 1, suppress minor
      // ticks entirely (every position is already a major).
      const minorStep =
        minorSubdivisions > 0 && majorStep > 1
          ? Math.max(1, majorStep / minorSubdivisions)
          : 0;

      // Ruler geometry inside the track band. Ticks hang downward from
      // the band's bottom; labels sit above the major tick height.
      const baselineY = rect.yBottom;
      const majorTickLen = Math.max(4, Math.floor(trackHeight * 0.4));
      const minorTickLen = Math.max(2, Math.floor(trackHeight * 0.2));
      const labelY = baselineY - majorTickLen - 2;

      // Skip-on-crash: walk the candidate majors forward and drop any
      // whose label would visually run into the previously-emitted
      // label. The crash check works in baseline-x; label widths
      // (computed in screen px from character count × font size) are
      // converted back to baseline-px equivalents by dividing by the
      // live "screen per baseline" scale factor. That makes the check
      // accurate at any zoom — at fit-gene `liveScale === 1` and the
      // conversion is a no-op; at deep zoom the baseline-spacing
      // between consecutive ticks (which doesn't change with zoom)
      // is correctly compared against label widths in the same units.
      // `liveScale` is the screen-px-per-baseline-px factor inside
      // exonic regions at the current zoom. At fit-gene it's 1; at
      // deep zoom it grows so 1 bp of exonic baseline maps to many
      // screen pixels. Used to convert label widths and padding
      // (originally in screen px) to baseline-equivalents for the
      // crash check, which operates on baseline-x distances between
      // ticks. Approximated by the ruler-length ratio (naturalLen /
      // currentLen) — exact in transcript / protein modes; slightly
      // overestimates exonic-only scale in genome mode with bulks
      // (close enough; the alternative would be exposing the
      // internal `exonScale` on the public Viewport interface).
      const naturalRangeForScale = viewport.naturalRange();
      const naturalLen = naturalRangeForScale[1] - naturalRangeForScale[0];
      const liveScale = visibleRulerSpan > 0 ? naturalLen / visibleRulerSpan : 1;
      // labelPadPx is a screen-px constant ("12 px of breathing room
      // between adjacent labels"); convert to baseline-equivalent to
      // compare against tick baseline-x distances at any zoom.
      const labelPadBaseline = labelPadPx / liveScale;
      const charPx = labelFontSize * 0.6;
      const halfWidthOf = (tick: TickRow, withSuffix: boolean): number => {
        if (labelRotation === 90) {
          // Rotated labels stand vertically — their on-screen horizontal
          // footprint is the font height (≈ labelFontSize), independent
          // of character count. The suffix only widens the rotated
          // label *vertically* (which the track height handles), not
          // horizontally, so `withSuffix` is irrelevant here.
          return labelFontSize / 2 / liveScale;
        }
        return (
          (formatLabel(tick, unit, withSuffix, labelFormat, mapper).length *
            charPx) /
          2 /
          liveScale
        );
      };
      // Merge step-divisible candidates with exon-edge anchor ticks
      // and intronic-flank ticks (sorted by baseline-x, de-duplicated
      // by ruler position). Anchors are pinned to each exon's 5'/3'
      // boundaries so a deep zoom that misses every step tick still
      // surfaces the boundary explicitly; intronic ticks fill in the
      // donor / acceptor flank zones so the c. ruler stays evenly
      // spaced across exon boundaries.
      const stepMajors = collectTicks(viewport, mapper, majorStep);
      const anchorMajors = collectAnchorTicks(viewport, mapper);
      const intronicMajors = collectIntronicTicks(viewport, mapper);
      const anchorPositions = new Set(anchorMajors.map((t) => t.rulerPos));
      const allMajors: TickRow[] = [
        ...anchorMajors,
        ...stepMajors.filter((t) => !anchorPositions.has(t.rulerPos)),
        ...intronicMajors,
      ].sort((a, b) => a.baselineX - b.baselineX);

      // Walk forward, skipping any candidate whose label would crash
      // with its predecessor's. Widths are sized as if *no* suffix is
      // attached — every tick has the same label-width budget, the
      // walk doesn't cascade-drop ticks just to make room for the
      // suffix at the right end. Anchor ticks (exon edges) win over
      // step ticks in a collision: a step predecessor is popped to
      // make room for a colliding anchor; an anchor predecessor stays
      // and the colliding step is dropped.
      const majors: TickRow[] = [];
      let lastBaselineX = -Infinity;
      let lastHalfWidth = 0;
      for (const t of allMajors) {
        const half = halfWidthOf(t, false);
        if (t.baselineX - lastBaselineX < lastHalfWidth + half + labelPadBaseline) {
          // Collision. Anchor wins over step.
          const prev = majors[majors.length - 1];
          if (t.anchor && prev && !prev.anchor) {
            majors.pop();
            const beforePrev = majors[majors.length - 1];
            lastBaselineX = beforePrev?.baselineX ?? -Infinity;
            lastHalfWidth = beforePrev
              ? halfWidthOf(beforePrev, false)
              : 0;
            // Fall through to the emit logic below.
          } else {
            continue;
          }
        }
        majors.push(t);
        lastBaselineX = t.baselineX;
        lastHalfWidth = half;
      }

      // The last emitted major carries the unit suffix when
      // `unitSuffix === 'last'`. The suffix is a short hint
      // (` bp` / ` aa`); always emit it — adding anchor ticks at exon
      // edges occasionally puts the last tick close to its
      // predecessor, and the old crash check would silently drop the
      // unit-hint in those cases. The full unit also reads off the
      // `data-vv-scale-unit` attribute on the track group, so a small
      // visual encroachment on the predecessor's padding is preferable
      // to losing the suffix entirely.
      const showSuffix = unitSuffix === 'last' && majors.length > 0;

      const majorPositions = new Set(majors.map((t) => t.rulerPos));
      const minors =
        minorStep > 0
          ? collectTicks(viewport, mapper, minorStep).filter(
              (t) => !majorPositions.has(t.rulerPos),
            )
          : [];

      const baseline = viewport.baselineGeometry();
      const exonByIdx = new Map<number, ExonBaseline>();
      for (const eb of baseline.exons) exonByIdx.set(eb.exonIdx, eb);

      const stroke = painter.color('vv-color-text-tertiary', '#94a3b8');
      const labelFill = painter.color('vv-color-text-secondary', '#475569');

      const lastMajorPos =
        majors.length > 0 ? majors[majors.length - 1]!.rulerPos : null;

      const exonGroups: ReactNode[] = [];
      for (const [exonIdx, exon] of exonByIdx) {
        const exonMajors = majors.filter((t) => t.exonIdx === exonIdx);
        const exonMinors = minors.filter((t) => t.exonIdx === exonIdx);
        if (exonMajors.length === 0 && exonMinors.length === 0) continue;
        exonGroups.push(
          painter.placeInExonGroup(
            exonIdx,
            <Fragment key={`scale-exon-${exonIdx}`}>
              {exonMinors.map((t) => (
                <line
                  key={`scale-minor-${t.rulerPos}`}
                  x1={t.baselineX - exon.xStart}
                  x2={t.baselineX - exon.xStart}
                  y1={baselineY - minorTickLen}
                  y2={baselineY}
                  stroke={stroke}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                  className="vv-scale-tick vv-scale-tick-minor"
                />
              ))}
              {exonMajors.map((t) => (
                <line
                  key={`scale-major-${t.rulerPos}`}
                  x1={t.baselineX - exon.xStart}
                  x2={t.baselineX - exon.xStart}
                  y1={baselineY - majorTickLen}
                  y2={baselineY}
                  stroke={stroke}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                  className="vv-scale-tick vv-scale-tick-major"
                />
              ))}
              {exonMajors.map((t) => {
                const localX = t.baselineX - exon.xStart;
                const isLast = lastMajorPos === t.rulerPos;
                const label = formatLabel(
                  t,
                  unit,
                  showSuffix && isLast,
                  labelFormat,
                  mapper,
                );
                // The counter-scale wrap neutralises the exon group's
                // scaleX so the text inside renders at natural size.
                // For rotated labels the SVG `transform` attribute on
                // the text element rotates inside the counter-scaled
                // frame — the rotation composes with the cancel-out
                // scaling so the text stays at natural font height +
                // width regardless of zoom.
                const rotated = labelRotation === 90;
                return (
                  <g
                    key={`scale-label-wrap-${t.rulerPos}`}
                    className="vv-scale-label-wrap"
                    style={{
                      transform:
                        `translateX(${localX}px) ` +
                        `scaleX(calc(1 / var(--vv-exon-scale-x-${exonIdx}, 1)))`,
                      transformOrigin: '0 0',
                    }}
                  >
                    <text
                      x={0}
                      y={labelY}
                      textAnchor={rotated ? 'start' : 'middle'}
                      dominantBaseline={rotated ? 'middle' : 'auto'}
                      transform={rotated ? `rotate(-90 0 ${labelY})` : undefined}
                      fontSize={labelFontSize}
                      fill={labelFill}
                      className="vv-scale-label"
                    >
                      {label}
                    </text>
                  </g>
                );
              })}
            </Fragment>,
          ),
        );
      }

      return (
        <g
          className="vv-scale-track"
          data-vv-track-id={id}
          data-vv-scale-unit={unit}
          data-vv-scale-major-step={majorStep}
          key={id}
        >
          {exonGroups}
        </g>
      );
    },

    toJSON() {
      return {
        id,
        height: trackHeight,
        majorStep: majorStepConfig,
        minorSubdivisions,
        minLabelSpacingPx,
        labelFontSize,
        unitSuffix,
      };
    },
  };
}

interface TickRow {
  rulerPos: number;
  exonIdx: number;
  baselineX: number;
  /** Anchor ticks (exon edges) win over step-divisible ticks in the
   *  crash walk — a step tick gets popped to make room for a colliding
   *  anchor. Two anchors that collide with each other fall through to
   *  the default "keep the leftmost" rule. */
  anchor?: boolean;
  /** Intronic ticks live inside donor / acceptor flank zones at HGVS c.
   *  offsets. Their `rulerPos` is synthetic (cPos + offset on the same
   *  ruler axis, used only for crash-walk ordering); the label uses
   *  this struct to render as `c.N+M` or `c.N-K`. */
  intronic?: { cPos: number; offset: number };
}

function unitForMode(mode: ViewMode): 'bp' | 'aa' {
  return mode === 'protein' ? 'aa' : 'bp';
}

function rulerLengthForMode(viewport: Viewport): number {
  const [lo, hi] = viewport.naturalRange();
  return Math.max(0, hi - lo);
}

/** Pick the smallest ladder step whose label spacing meets the
 *  minimum pixel gap. Pathological short genes demote one rung at a
 *  time so the ruler still shows ≥ 1 tick. */
export function pickAutoStep(
  pxPerUnit: number,
  minSpacingPx: number,
  rulerLength: number,
): number {
  const minStepUnits = pxPerUnit > 0 ? minSpacingPx / pxPerUnit : minSpacingPx;
  let step =
    STEP_LADDER.find((s) => s >= minStepUnits) ??
    STEP_LADDER[STEP_LADDER.length - 1]!;
  while (step > 1 && rulerLength > 0 && rulerLength < step) {
    const idx = STEP_LADDER.indexOf(step);
    if (idx <= 0) break;
    step = STEP_LADDER[idx - 1]!;
  }
  return step;
}

function collectTicks(
  viewport: Viewport,
  mapper: CoordinateMapper,
  step: number,
): TickRow[] {
  if (step <= 0) return [];
  const [lo, hi] = viewport.naturalRange();
  if (hi <= lo) return [];
  const rows: TickRow[] = [];
  const first = Math.ceil(lo / step) * step;
  for (let pos = first; pos <= hi + 1e-9; pos = roundedAdd(pos, step)) {
    const exonIdx = exonForRulerPos(pos, viewport, mapper);
    if (exonIdx === null) continue;
    const baselineX = viewport.cdsToBaselineX(pos);
    rows.push({ rulerPos: pos, baselineX, exonIdx });
  }
  return rows;
}

/** Intronic ticks pinned to every bp inside each soft-collapse spec's
 *  donor / acceptor flank zones. At deep zoom the per-bp screen width
 *  is large enough that intronic positions become individually visible;
 *  emitting ticks here means the c. ruler stays evenly spaced across
 *  exon boundaries (c.140 — c.140+1 — c.140+2 — ... — c.141-1 — c.141)
 *  rather than jumping straight from one exon's cdsEnd to the next
 *  exon's cdsStart with a wide intronic gap in between. Genome mode
 *  only; transcript and protein hard-collapse introns so the spec is
 *  subsumed. The crash walk drops these at lower zoom levels naturally. */
function collectIntronicTicks(
  viewport: Viewport,
  mapper: CoordinateMapper,
): TickRow[] {
  if (viewport.mode !== 'genome') return [];
  const baseline = viewport.baselineGeometry();
  const flanks = baseline.flanks ?? [];
  if (flanks.length === 0) return [];
  const pxPerBp = baseline.pxPerBp;
  const exons = mapper.transcript.exons;
  const rows: TickRow[] = [];
  for (const flank of flanks) {
    if (flank.side === 'donor') {
      const upstream = exons[flank.intronIdx];
      if (!upstream) continue;
      // Donor flank covers HGVS c.{upstream.cdsEnd}+1 .. +flank.bp.
      for (let offset = 1; offset <= flank.bp; offset++) {
        const baselineX = flank.xStart + (offset - 1) * pxPerBp;
        rows.push({
          rulerPos: upstream.cdsEnd + offset / (flank.bp + 1),
          exonIdx: flank.intronIdx,
          baselineX,
          intronic: { cPos: upstream.cdsEnd, offset },
        });
      }
    } else {
      const downstream = exons[flank.intronIdx + 1];
      if (!downstream) continue;
      // Acceptor flank covers HGVS c.{downstream.cdsStart}-flank.bp .. -1.
      for (let k = flank.bp; k >= 1; k--) {
        const baselineX = flank.xStart + (flank.bp - k) * pxPerBp;
        rows.push({
          rulerPos: downstream.cdsStart - k / (flank.bp + 1),
          exonIdx: flank.intronIdx + 1,
          baselineX,
          intronic: { cPos: downstream.cdsStart, offset: -k },
        });
      }
    }
  }
  return rows.sort((a, b) => a.baselineX - b.baselineX);
}

/** Anchor ticks pinned to every exon's 5' and 3' boundaries (in ruler
 *  units — aa in protein mode, CDS bp otherwise). At deep zoom the
 *  step-divisible ticks can skip past an exon edge entirely; anchors
 *  guarantee the user always sees the boundary. The crash walk treats
 *  these as preferred — a step tick gets popped to make room for a
 *  colliding anchor. */
function collectAnchorTicks(
  viewport: Viewport,
  mapper: CoordinateMapper,
): TickRow[] {
  const rows: TickRow[] = [];
  const seen = new Set<number>();
  const push = (rulerPos: number, exonIdx: number): void => {
    if (seen.has(rulerPos)) return;
    seen.add(rulerPos);
    rows.push({
      rulerPos,
      exonIdx,
      baselineX: viewport.cdsToBaselineX(rulerPos),
      anchor: true,
    });
  };
  const exons = mapper.transcript.exons;
  for (let i = 0; i < exons.length; i++) {
    const e = exons[i]!;
    if (viewport.mode === 'protein') {
      const aaStart = mapper.cdsToProtein(e.cdsStart);
      const aaEnd = mapper.cdsToProtein(e.cdsEnd);
      if (aaStart !== null) push(aaStart, i);
      if (aaEnd !== null) push(aaEnd, i);
    } else {
      push(e.cdsStart, i);
      push(e.cdsEnd, i);
    }
  }
  return rows.sort((a, b) => a.baselineX - b.baselineX);
}

function roundedAdd(value: number, step: number): number {
  // Steps from the ladder are integers; floating-point drift can still
  // creep in across hundreds of additions, so re-round to the step's
  // precision after each tick.
  return Math.round((value + step) / step) * step;
}

function exonForRulerPos(
  pos: number,
  viewport: Viewport,
  mapper: CoordinateMapper,
): number | null {
  if (viewport.mode === 'protein') {
    const cPos = mapper.proteinToCds(pos);
    const hit = mapper.findExonByCds(cPos);
    return hit?.exonIdx ?? null;
  }
  const hit = mapper.findExonByCds(pos);
  return hit?.exonIdx ?? null;
}

function formatLabel(
  tick: TickRow,
  unit: 'bp' | 'aa',
  withSuffix: boolean,
  labelFormat: 'c-notation' | 'genomic',
  mapper: CoordinateMapper,
): string {
  // Intronic ticks always render in HGVS c. with explicit offset
  // (regardless of the host's labelFormat — there's no clean genomic
  // analogue for `c.N+M` other than the underlying chromosomal bp,
  // which is what `labelFormat: 'genomic'` already produces for
  // exonic ticks).
  if (tick.intronic) {
    const { cPos, offset } = tick.intronic;
    const sign = offset > 0 ? '+' : '';
    return `c.${cPos.toLocaleString('en-US')}${sign}${offset}`;
  }
  const formatted = Math.round(tick.rulerPos).toLocaleString('en-US');
  if (unit === 'aa') {
    return withSuffix ? `${formatted} aa` : formatted;
  }
  if (labelFormat === 'genomic') {
    // Resolve the CDS bp position to its genomic counterpart. The label
    // omits a unit suffix — the `chrN:` prefix already signals "this is
    // a chromosomal address". Fallback to HGVS c. when the position
    // can't be resolved (e.g., positions in padding past the gene's
    // 3' end have no genomic equivalent).
    const g = mapper.cdsToGenomic(Math.round(tick.rulerPos), 0);
    if (g) {
      return `${g.chr}:${g.pos.toLocaleString('en-US')}`;
    }
  }
  // Genome and transcript modes default to HGVS c. coords. The ruler
  // is CDS bp under the hood; the `c.` prefix signals which addressing
  // system the number refers to. The bp suffix on the rightmost label
  // is kept for its visual "unit hint" role but reads "bp" rather than
  // "c. bp".
  return withSuffix ? `c.${formatted} bp` : `c.${formatted}`;
}
