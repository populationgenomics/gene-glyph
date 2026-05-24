import {
  displayToFigure,
  figureToDisplay,
  fitZoomScale,
  layoutFigure,
  localScaleAtDisplay,
  type FigureLayout,
  type Piece,
} from './figure-scale.js';
import {
  buildSegments,
  segmentToPiece,
  type Segment,
} from './segments.js';
import type { BaselineGeometry, ViewMode } from './types.js';

/** Per-exon CDS bp bounds used by the frame for ruler ↔ baseline mapping in
 *  CDS modes. Protein-mode projection is linear in aa and doesn't consult
 *  these. */
export interface FrameExon {
  readonly cdsStart: number;
  readonly cdsEnd: number;
}

/** Per-render layout derived from `(baseline, zoomScale, displayOffset,
 *  width, mode)`. Each exon gets a current-frame screen-x and a shared
 *  `exonScale` applied to baseline widths. */
export interface ExonLayout {
  readonly exonScale: number;
  readonly exonCurrentX: readonly number[];
}

export interface ProjectionFrameInit {
  baseline: BaselineGeometry;
  /** Multiplier on flexible piece widths. Constant under pan, varies
   *  only with zoom. */
  zoomScale: number;
  /** Display-x of the first piece's left edge inside the viewport. The
   *  viewport `[0, width]` shows the slice `[displayOffset, displayOffset
   *  + width]` of the static layout. Pan adjusts this directly. */
  displayOffset: number;
  width: number;
  mode: ViewMode;
  /** CDS bp bounds for each baseline exon, indexed by `exonIdx`. */
  exons: readonly FrameExon[];
}

/**
 * Pure value object describing the projection from baseline-x onto live
 * screen-x for one `(baseline, zoom, offset, width, mode)` tuple.
 *
 * The static layout is shared across pan: changing only `displayOffset`
 * doesn't trigger any layout work. Ruler ↔ baseline-x is a per-segment
 * walk; baseline-x ↔ screen-x is `figure-scale` + an offset.
 */
export class ProjectionFrame {
  readonly baseline: BaselineGeometry;
  readonly zoomScale: number;
  readonly displayOffset: number;
  readonly width: number;
  readonly mode: ViewMode;
  private readonly _segments: readonly Segment[];
  private readonly _pieces: readonly Piece[];
  private _layout: FigureLayout | null = null;
  private _exonLayout: ExonLayout | null = null;

  constructor(init: ProjectionFrameInit) {
    this.baseline = init.baseline;
    this.zoomScale = init.zoomScale;
    this.displayOffset = init.displayOffset;
    this.width = init.width;
    this.mode = init.mode;
    this._segments = buildSegments(init.baseline, init.exons, init.mode);
    this._pieces = this._segments.map(segmentToPiece);
  }

  /** Ruler → baseline screen-x. CDS bp in CDS modes, aa in protein mode.
   *  Per-segment linear interpolation between `(rulerStart, rulerEnd)`
   *  and `(xStart, xEnd)`. Extrapolates past the gene edges using
   *  `baseline.pxPerBp`. */
  rulerToBaselineX(rulerPos: number): number {
    const segments = this._segments;
    if (segments.length === 0) return 0;
    const first = segments[0]!;
    if (rulerPos < first.rulerStart) {
      return first.xStart - (first.rulerStart - rulerPos) * this.baseline.pxPerBp;
    }
    for (const seg of segments) {
      if (rulerPos <= seg.rulerEnd) {
        const rulerSpan = seg.rulerEnd - seg.rulerStart;
        if (rulerSpan <= 0) return seg.xStart;
        const t = (rulerPos - seg.rulerStart) / rulerSpan;
        return seg.xStart + t * seg.width;
      }
    }
    const last = segments[segments.length - 1]!;
    return last.xEnd + (rulerPos - last.rulerEnd) * this.baseline.pxPerBp;
  }

  /** Inverse of {@link rulerToBaselineX}. */
  baselineXToRuler(S: number): number {
    const segments = this._segments;
    if (segments.length === 0 || this.baseline.pxPerBp === 0) return 0;
    const first = segments[0]!;
    if (S < first.xStart) {
      return first.rulerStart - (first.xStart - S) / this.baseline.pxPerBp;
    }
    for (const seg of segments) {
      if (S <= seg.xEnd) {
        if (seg.width <= 0) return seg.rulerStart;
        const t = (S - seg.xStart) / seg.width;
        return seg.rulerStart + t * (seg.rulerEnd - seg.rulerStart);
      }
    }
    const last = segments[segments.length - 1]!;
    return last.rulerEnd + (S - last.xEnd) / this.baseline.pxPerBp;
  }

  /** Baseline screen-x → live screen-x. Pure: layout(zoom) lookup plus
   *  an offset subtraction. */
  baselineToCurrent(baselineX: number): number | null {
    if (this._segments.length === 0) return null;
    return figureToDisplay(this.figureLayout(), baselineX) - this.displayOffset;
  }

  /** Inverse: live screen-x → baseline-x. */
  currentToBaseline(currentX: number): number | null {
    if (this._segments.length === 0) return null;
    return displayToFigure(this.figureLayout(), currentX + this.displayOffset);
  }

  /** Local display-per-baseline-px derivative at the given current
   *  screen-x. Inside an exon (or flank) this equals `zoomScale`; inside
   *  a fixed-budget bulk it equals the bulk's reserved-display / baseline
   *  ratio (= 1 by construction for the default budget). At a zero-
   *  baseline-width breakpoint it's +Infinity. */
  localScreenScaleAt(currentX: number): number {
    if (this._segments.length === 0) return this.zoomScale;
    return localScaleAtDisplay(this.figureLayout(), currentX + this.displayOffset);
  }

  /** Live screen-space zoom factor: `width / visibleBaselineSpan`.
   *  Derived from the layout; in genome mode with fixed-budget gaps in
   *  view it differs from `zoomScale` because part of the viewport is
   *  consumed by fixed pixels. */
  zoomFactor(): number {
    const layout = this.figureLayout();
    const bLo = displayToFigure(layout, this.displayOffset);
    const bHi = displayToFigure(layout, this.displayOffset + this.width);
    const span = bHi - bLo;
    if (span <= 0) return 1;
    return this.width / span;
  }

  /** Per-render exon layout — `{exonScale, exonCurrentX[exonIdx]}`. */
  exonLayout(): ExonLayout {
    if (this._exonLayout) return this._exonLayout;
    const layout = this.figureLayout();
    const exonCount = this.baseline.exons.length;
    const exonCurrentX = new Array<number>(exonCount).fill(0);
    for (let i = 0; i < this._segments.length; i++) {
      const seg = this._segments[i]!;
      if (seg.kind === 'exon' && seg.exonIdx !== undefined) {
        exonCurrentX[seg.exonIdx] = layout.displayBounds[i]!.start - this.displayOffset;
      }
    }
    this._exonLayout = { exonScale: this.zoomScale, exonCurrentX };
    return this._exonLayout;
  }

  /** Live display-x of the start of the segment with the given index. */
  segmentCurrentX(segmentIndex: number): number {
    return this.figureLayout().displayBounds[segmentIndex]!.start - this.displayOffset;
  }

  /** Live display width of the segment with the given index. */
  segmentCurrentWidth(segmentIndex: number): number {
    const b = this.figureLayout().displayBounds[segmentIndex]!;
    return b.end - b.start;
  }

  /** Segment array — accessible for callers that want to walk piece-by-
   *  piece (publish, intron decoration positioning). */
  segments(): readonly Segment[] {
    return this._segments;
  }

  /** Total display width of the figure at the current zoom — i.e., the
   *  width of the laid-out figure independent of the viewport. Useful for
   *  pan clamping (the figure can pan from `displayOffset = 0` down to
   *  `displayOffset = totalDisplayWidth - viewportWidth`). */
  totalDisplayWidth(): number {
    return this.figureLayout().totalDisplayWidth;
  }

  /** Fit-zoom scale: the `zoomScale` that would make the whole figure
   *  fit exactly in `width` display pixels. Cached per layout. */
  fitZoomScale(): number {
    return fitZoomScale(this._pieces, this.width);
  }

  private figureLayout(): FigureLayout {
    if (this._layout) return this._layout;
    this._layout = layoutFigure(this._pieces, this.zoomScale);
    return this._layout;
  }
}
