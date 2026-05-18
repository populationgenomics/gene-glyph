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
 * (CDS bp in `cds-with-introns` / `cds-spliced` modes, aa in
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
      const pxPerUnit = baselinePxPerUnit(viewport);
      const majorStep =
        majorStepConfig === 'auto'
          ? pickAutoStep(pxPerUnit, minLabelSpacingPx, rulerLength)
          : Math.max(1, majorStepConfig);
      const minorStep =
        minorSubdivisions > 0 ? majorStep / minorSubdivisions : 0;

      // Ruler geometry inside the track band. Ticks hang downward from
      // the band's bottom; labels sit above the major tick height.
      const baselineY = rect.yBottom;
      const majorTickLen = Math.max(4, Math.floor(trackHeight * 0.4));
      const minorTickLen = Math.max(2, Math.floor(trackHeight * 0.2));
      const labelY = baselineY - majorTickLen - 2;

      // Skip-on-crash: walk the candidate majors forward and drop any
      // whose label would visually run into the previously-emitted
      // label. The crash check works in baseline-x (matches screen-x at
      // fit-gene; per-exon transforms only spread labels further apart
      // at higher zoom, so this is also a conservative check there).
      // Label width estimate is character-count × `labelFontSize × 0.6`
      // — close enough for the digits / commas / `bp` / `aa` glyphs we
      // emit. Tick mark + label drop together: the user shouldn't see
      // a tick stuck next to a labelled one with no label of its own.
      const charPx = labelFontSize * 0.6;
      const halfWidthOf = (rulerPos: number, withSuffix: boolean): number => {
        if (labelRotation === 90) {
          // Rotated labels stand vertically — their on-screen horizontal
          // footprint is the font height (≈ labelFontSize), independent
          // of character count. The suffix only widens the rotated
          // label *vertically* (which the track height handles), not
          // horizontally, so `withSuffix` is irrelevant here.
          return labelFontSize / 2;
        }
        return (formatLabel(rulerPos, unit, withSuffix).length * charPx) / 2;
      };
      const allMajors = collectTicks(viewport, mapper, majorStep);

      // Pass 1: walk forward, skipping any candidate whose label would
      // crash with its predecessor's. The canonical-last candidate is
      // sized as if suffixed up front so the suffix-promotion case is
      // typically resolved here — the second pass below is reserved
      // for the rare edge case where the first pass drops the suffix-
      // wearing tick.
      const lastCandidatePos =
        allMajors.length > 0 ? allMajors[allMajors.length - 1]!.rulerPos : null;
      const majors: TickRow[] = [];
      let lastBaselineX = -Infinity;
      let lastHalfWidth = 0;
      for (const t of allMajors) {
        const wearsSuffix =
          unitSuffix === 'last' && t.rulerPos === lastCandidatePos;
        const half = halfWidthOf(t.rulerPos, wearsSuffix);
        if (t.baselineX - lastBaselineX < lastHalfWidth + half + labelPadPx) {
          continue;
        }
        majors.push(t);
        lastBaselineX = t.baselineX;
        lastHalfWidth = half;
      }

      // Pass 2: now the last emitted gets the suffix; if that widens it
      // past the previous label's clearance, drop it and promote the
      // suffix to its predecessor. Iterate until the last fits or
      // there's only one tick left (a single tick with a suffix always
      // fits — there's nothing to crash against).
      if (unitSuffix === 'last') {
        while (majors.length > 1) {
          const last = majors[majors.length - 1]!;
          const prev = majors[majors.length - 2]!;
          const lastHalfSuffix = halfWidthOf(last.rulerPos, true);
          const prevHalf = halfWidthOf(prev.rulerPos, false);
          if (last.baselineX - prev.baselineX >= prevHalf + lastHalfSuffix + labelPadPx) break;
          majors.pop();
        }
      }

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
                  t.rulerPos,
                  unit,
                  unitSuffix === 'last' && isLast,
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
}

function unitForMode(mode: ViewMode): 'bp' | 'aa' {
  return mode === 'protein' ? 'aa' : 'bp';
}

function rulerLengthForMode(viewport: Viewport): number {
  const [lo, hi] = viewport.naturalRange();
  return Math.max(0, hi - lo);
}

/** Baseline (fit-gene) pixels per ruler unit. Stable under pan/zoom
 *  because `baselineGeometry()` returns fit-gene coords. In protein
 *  mode `pxPerBp` already encodes px-per-aa (computed against aaLen,
 *  not cdsLength) so the same accessor works for both unit systems. */
function baselinePxPerUnit(viewport: Viewport): number {
  const geom = viewport.baselineGeometry();
  return geom.pxPerBp;
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

function formatLabel(pos: number, unit: 'bp' | 'aa', withSuffix: boolean): string {
  const formatted = Math.round(pos).toLocaleString('en-US');
  return withSuffix ? `${formatted} ${unit}` : formatted;
}
