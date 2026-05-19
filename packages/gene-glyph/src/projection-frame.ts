import type { BaselineGeometry, ViewMode } from './types.js';

/** Per-exon CDS bp bounds used by the frame for ruler ↔ baseline mapping in
 *  CDS modes. Protein-mode projection is linear in aa and doesn't consult
 *  these. The controller passes a view over the mapper's transcript exons
 *  so the frame stays mapper-free. */
export interface FrameExon {
  readonly cdsStart: number;
  readonly cdsEnd: number;
}

/** Per-render layout derived from `(baseline, range, width, mode)`. Each
 *  exon gets a current-frame screen-x and a shared `exonScale` applied to
 *  baseline widths. In `cds-with-introns` mode the inter-exon gaps stay at
 *  their baseline pixel width regardless of zoom (`exonScale` only applies
 *  to exon content); in spliced / protein modes gaps either scale with the
 *  exons or are zero-width. */
export interface ExonLayout {
  readonly exonScale: number;
  readonly exonCurrentX: readonly number[];
}

export interface ProjectionFrameInit {
  baseline: BaselineGeometry;
  range: readonly [number, number];
  width: number;
  mode: ViewMode;
  /** CDS bp bounds for each baseline exon, indexed by `exonIdx`. */
  exons: readonly FrameExon[];
}

/**
 * Pure value object describing the projection from ruler-space (CDS bp in
 * CDS modes, aa in protein mode) through baseline-x (fit-gene screen pixels)
 * to current screen-x for one `(baseline, range, width, mode)` tuple.
 *
 * Holds no mapper and no mutable state beyond memoised intermediates. The
 * controller rebuilds a frame whenever any input changes and exposes the
 * same projection methods on the public `Viewport` interface by delegating
 * here.
 */
export class ProjectionFrame {
  readonly baseline: BaselineGeometry;
  readonly range: readonly [number, number];
  readonly width: number;
  readonly mode: ViewMode;
  private readonly _exons: readonly FrameExon[];
  private _layout: ExonLayout | null = null;
  private _S_lo: number | null = null;
  private _S_hi: number | null = null;

  constructor(init: ProjectionFrameInit) {
    this.baseline = init.baseline;
    this.range = init.range;
    this.width = init.width;
    this.mode = init.mode;
    this._exons = init.exons;
  }

  /** Ruler → baseline screen-x. CDS bp in CDS modes, aa in protein mode.
   *  Always returns a finite value: extrapolates linearly using the first /
   *  last exon's baseline `pxPerBp` past the gene's edges, and interpolates
   *  through inter-exon gaps so the mapping is continuous in `rulerPos`. */
  rulerToBaselineX(rulerPos: number): number {
    const baseline = this.baseline;
    const exons = this._exons;
    if (baseline.exons.length === 0) return 0;
    if (this.mode === 'protein') {
      // Linear in aa: aa=1 at x=0, aa=aaLen at x=width. Single closed-form
      // mapping; avoids the per-exon walk's floating-point drift.
      return (rulerPos - 1) * baseline.pxPerBp;
    }
    const first = exons[0]!;
    if (rulerPos < first.cdsStart) {
      return baseline.exons[0]!.xStart - (first.cdsStart - rulerPos) * baseline.pxPerBp;
    }
    for (let i = 0; i < exons.length; i++) {
      const e = exons[i]!;
      const eb = baseline.exons[i]!;
      if (rulerPos <= e.cdsEnd) {
        return eb.xStart + (rulerPos - e.cdsStart) * baseline.pxPerBp;
      }
      // Fractional cPos between this exon's end and the next exon's start
      // (e.g., cPos = 140.5 between TP53 exons 0 and 1). These don't
      // correspond to real bp positions, but they DO appear during pan /
      // animation interpolation — if the function jumped discretely from
      // `eb.xEnd` to the next exon's `xStart` (a gap-width leap), the
      // published CSS variables would jump too and the right edge would
      // pop during right-pan. Interpolate linearly through the gap so
      // baseline-x is continuous in `rulerPos`.
      if (i < exons.length - 1) {
        const nextE = exons[i + 1]!;
        const denom = nextE.cdsStart - e.cdsEnd;
        if (rulerPos < nextE.cdsStart && denom > 0) {
          const t = (rulerPos - e.cdsEnd) / denom;
          return eb.xEnd + t * baseline.gapPx;
        }
      }
    }
    const lastIdx = exons.length - 1;
    const last = exons[lastIdx]!;
    const lastBaseline = baseline.exons[lastIdx]!;
    return lastBaseline.xEnd + (rulerPos - last.cdsEnd) * baseline.pxPerBp;
  }

  /** Inverse of {@link rulerToBaselineX}. Maps baseline screen-x back to a
   *  ruler position by locating the containing exon (or extrapolating off
   *  the ends). Return is fractional; callers round if they want a discrete
   *  CDS bp / aa value. */
  baselineXToRuler(S: number): number {
    const baseline = this.baseline;
    const exons = this._exons;
    if (baseline.exons.length === 0 || baseline.pxPerBp === 0) return 0;
    if (this.mode === 'protein') {
      return S / baseline.pxPerBp + 1;
    }
    if (S < baseline.exons[0]!.xStart) {
      return exons[0]!.cdsStart - (baseline.exons[0]!.xStart - S) / baseline.pxPerBp;
    }
    for (let i = 0; i < exons.length; i++) {
      const eb = baseline.exons[i]!;
      const e = exons[i]!;
      if (S >= eb.xStart && S <= eb.xEnd) {
        return e.cdsStart + (S - eb.xStart) / baseline.pxPerBp;
      }
      if (i < exons.length - 1) {
        const gap = baseline.gaps[i]!;
        if (S > eb.xEnd && S < gap.xEnd) {
          // Smoothly interpolate ruler position through the gap so the
          // inverse of `rulerToBaselineX` is also continuous. cPos walks
          // linearly from `e.cdsEnd` to `exons[i+1].cdsStart` across the
          // gap.
          const nextStart = exons[i + 1]!.cdsStart;
          const denom = baseline.gapPx > 0 ? baseline.gapPx : 1;
          const t = (S - eb.xEnd) / denom;
          return e.cdsEnd + t * (nextStart - e.cdsEnd);
        }
      }
    }
    const lastIdx = exons.length - 1;
    const last = exons[lastIdx]!;
    const lastBaseline = baseline.exons[lastIdx]!;
    return last.cdsEnd + (S - lastBaseline.xEnd) / baseline.pxPerBp;
  }

  /** Baseline screen-x → live screen-x. Exon content scales with
   *  {@link ExonLayout.exonScale}; inter-exon gap content stays at its
   *  baseline pixel width in `cds-with-introns` mode and scales with exon
   *  content in spliced / protein modes. */
  baselineToCurrent(baselineX: number): number | null {
    const baseline = this.baseline;
    if (baseline.exons.length === 0) return null;
    const { S_lo, S_hi } = this.bounds();
    if (S_hi - S_lo <= 0) return null;
    const layout = this.exonLayout();
    const scale = layout.exonScale;
    for (let i = 0; i < baseline.exons.length; i++) {
      const eb = baseline.exons[i]!;
      if (baselineX <= eb.xEnd) {
        if (baselineX >= eb.xStart) {
          return layout.exonCurrentX[i]! + (baselineX - eb.xStart) * scale;
        }
        if (i === 0) {
          // Padding zone before exon 0 — exon scale extrapolates linearly.
          return layout.exonCurrentX[0]! + (baselineX - eb.xStart) * scale;
        }
        const prevExon = baseline.exons[i - 1]!;
        const prevEnd = layout.exonCurrentX[i - 1]! + prevExon.width * scale;
        return prevEnd + (baselineX - prevExon.xEnd);
      }
    }
    const lastIdx = baseline.exons.length - 1;
    const lastEb = baseline.exons[lastIdx]!;
    const lastEnd = layout.exonCurrentX[lastIdx]! + lastEb.width * scale;
    return lastEnd + (baselineX - lastEb.xEnd) * scale;
  }

  /** Inverse of {@link baselineToCurrent}: live screen-x → baseline-x. */
  currentToBaseline(currentX: number): number | null {
    const baseline = this.baseline;
    if (baseline.exons.length === 0) return null;
    const { S_lo, S_hi } = this.bounds();
    if (S_hi - S_lo <= 0) return null;
    const layout = this.exonLayout();
    const scale = layout.exonScale;
    if (scale <= 0) return null;
    for (let i = 0; i < baseline.exons.length; i++) {
      const eb = baseline.exons[i]!;
      const cur = layout.exonCurrentX[i]!;
      const curEnd = cur + eb.width * scale;
      if (currentX <= curEnd) {
        if (currentX >= cur) {
          return eb.xStart + (currentX - cur) / scale;
        }
        if (i === 0) {
          return eb.xStart + (currentX - cur) / scale;
        }
        const prevExon = baseline.exons[i - 1]!;
        const prevEnd = layout.exonCurrentX[i - 1]! + prevExon.width * scale;
        return prevExon.xEnd + (currentX - prevEnd);
      }
    }
    const lastIdx = baseline.exons.length - 1;
    const lastEb = baseline.exons[lastIdx]!;
    const lastEnd = layout.exonCurrentX[lastIdx]! + lastEb.width * scale;
    return lastEb.xEnd + (currentX - lastEnd) / scale;
  }

  /** Live screen-space zoom factor: `width / visibleBaselineSpan`. Distinct
   *  from the controller's ruler-space `zoom()` (= `naturalLen / currentLen`),
   *  which is what gets published as `--vv-zoom`. The two differ in
   *  `cds-with-introns` mode whenever the visible range crosses an inter-exon
   *  gap — gap baseline pixels don't scale, so the screen-space factor is
   *  smaller than the ruler-space one. Degenerate ranges report 1. */
  zoomFactor(): number {
    const { S_lo, S_hi } = this.bounds();
    const span = S_hi - S_lo;
    if (span <= 0) return 1;
    return this.width / span;
  }

  /** Per-render exon layout: shared `exonScale` plus per-exon current-frame
   *  screen-x. Memoised on first call. */
  exonLayout(): ExonLayout {
    if (this._layout) return this._layout;
    const { S_lo, S_hi } = this.bounds();
    this._layout = computeExonLayout(this.baseline, S_lo, S_hi, this.width);
    return this._layout;
  }

  private bounds(): { S_lo: number; S_hi: number } {
    if (this._S_lo !== null && this._S_hi !== null) {
      return { S_lo: this._S_lo, S_hi: this._S_hi };
    }
    this._S_lo = this.rulerToBaselineX(this.range[0]);
    this._S_hi = this.rulerToBaselineX(this.range[1]);
    return { S_lo: this._S_lo, S_hi: this._S_hi };
  }
}

/** Map a visible baseline range `[S_lo, S_hi]` to per-exon screen-x positions
 *  such that:
 *
 *    1. S_lo lands at screen-x = 0
 *    2. S_hi lands at screen-x = width
 *    3. in cds-with-introns mode, every visible inter-exon gap occupies
 *       exactly `geom.gapPx` of screen (the gap *content* — dashed-intron
 *       polyline + a small breathing room — is the same screen-width
 *       regardless of zoom, so Pfam segments in adjacent exons stay
 *       visually close at deep zoom).
 *
 *  In spliced / protein modes the gap is conceptually a single "missing"
 *  bp slot (or zero in protein) and scales with the surrounding exon
 *  content — so adjacent bp letters across the intron stay one bp-width
 *  apart at deep zoom rather than collapsing into a single pixel. The
 *  `geom.gapPx === 0` sentinel distinguishes the two regimes; the
 *  baseline already records gap widths (`gap.width`) consistently.
 *
 *  Naive `zoom = width / (S_hi − S_lo)` violates (3) — gaps don't scale
 *  in with-introns mode — so we partition the visible baseline into
 *  "exon baseline" (always scales) + "fixed gap baseline" (only in
 *  with-introns mode), reserve gap pixels in screen-space, and solve
 *  for the exon scale that makes the exon content fill the remainder.
 *  Walks left + right from the pivot exon so the positions are stable
 *  as the user pans across an intron. */
function computeExonLayout(
  geom: BaselineGeometry,
  S_lo: number,
  S_hi: number,
  width: number,
): ExonLayout {
  const exons = geom.exons;
  const out = new Array<number>(exons.length).fill(0);
  if (exons.length === 0) return { exonScale: 1, exonCurrentX: out };

  // Fixed-width gaps only matter when `geom.gapPx > 0` (cds-with-introns).
  // In spliced / protein, gaps either don't exist (protein) or live in the
  // same linear bp ruler as the surrounding exons (spliced) — they scale
  // with `exonScale` and don't carve out fixed screen pixels.
  const gapsScale = geom.gapPx === 0;
  let visibleFixedGapBaseline = 0;
  if (!gapsScale) {
    for (const gap of geom.gaps) {
      const lo = Math.max(gap.xStart, S_lo);
      const hi = Math.min(gap.xEnd, S_hi);
      if (hi > lo) visibleFixedGapBaseline += hi - lo;
    }
  }
  const visibleScalingBaseline = Math.max(
    1e-9,
    S_hi - S_lo - visibleFixedGapBaseline,
  );
  const exonScale = Math.max(
    1e-9,
    (width - visibleFixedGapBaseline) / visibleScalingBaseline,
  );

  // Pivot exon + its anchoring currentX. If S_lo is inside an exon, anchor
  // S_lo at screen-x = 0; if S_lo is inside a gap, the gap content fills
  // the left of the screen and the next exon starts at the gap's remaining
  // visible width.
  const pivotIdx = pivotExonIdx(geom, S_lo);
  const pivotEb = exons[pivotIdx]!;
  let pivotCurrentX: number;
  if (S_lo >= pivotEb.xStart) {
    pivotCurrentX = -(S_lo - pivotEb.xStart) * exonScale;
  } else {
    // S_lo is upstream of the pivot exon — in the gap directly before it
    // or in the padding zone before exon 0. The pivot exon's left edge
    // sits at the remaining gap-or-padding width on screen.
    const baselineUpstream = pivotEb.xStart - S_lo;
    pivotCurrentX = gapsScale ? baselineUpstream * exonScale : baselineUpstream;
  }
  out[pivotIdx] = pivotCurrentX;

  // Walk right + left from the pivot. Per-gap step matches the mode:
  // unscaled `gap.width` in with-introns (fixed inter-exon breathing room
  // regardless of zoom), `gap.width * exonScale` in spliced (gap is one
  // bp slot in the linear ruler and scales with the exons).
  const gapStep = (gapIdx: number): number => {
    const g = geom.gaps[gapIdx];
    if (!g) return 0;
    return gapsScale ? g.width * exonScale : g.width;
  };
  let cursor = pivotCurrentX + pivotEb.width * exonScale;
  for (let i = pivotIdx + 1; i < exons.length; i++) {
    cursor += gapStep(i - 1);
    out[i] = cursor;
    cursor += exons[i]!.width * exonScale;
  }
  cursor = pivotCurrentX;
  for (let i = pivotIdx - 1; i >= 0; i--) {
    cursor -= gapStep(i);
    cursor -= exons[i]!.width * exonScale;
    out[i] = cursor;
  }
  return { exonScale, exonCurrentX: out };
}

/** Find the exon containing `baselineX`. When `baselineX` falls in a gap
 *  or in the padding zone before the first / after the last exon, returns
 *  the upstream-most exon whose right edge is at or past `baselineX` (or
 *  the last exon if `baselineX` lies past the gene's 3′ end). */
function pivotExonIdx(geom: BaselineGeometry, baselineX: number): number {
  if (geom.exons.length === 0) return 0;
  for (const eb of geom.exons) {
    if (baselineX <= eb.xEnd) return eb.exonIdx;
  }
  return geom.exons[geom.exons.length - 1]!.exonIdx;
}
