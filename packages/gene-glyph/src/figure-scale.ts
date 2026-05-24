/**
 * Piecewise figure ↔ display mapping.
 *
 * The figure is laid out along the x axis as an ordered sequence of
 * **pieces**, each owning an interval `[figureStart, figureEnd]` on a
 * continuous abstract figure-x line. Adjacent pieces may be contiguous
 * (`pieces[i].figureEnd === pieces[i+1].figureStart`) or leave a gap in
 * figure-x; gaps in figure space collapse to a single display-x at the
 * join, so the display line is *always* contiguous over the laid-out
 * figure.
 *
 * Each piece declares how it claims display space:
 *
 *  - `'flexible'` — claims `figureWidth × zoomScale` display pixels.
 *  - `'fixed'`    — claims `fixedDisplayWidth` display pixels regardless
 *    of zoom. May have zero figure width — that's a pure breakpoint,
 *    where figure-x is single-valued at the piece but display-x advances
 *    by `fixedDisplayWidth`.
 *
 * **Layout is a function of `(pieces, zoomScale)` ALONE.** The viewport
 * — what portion of the figure is shown in `[0, viewportWidth]` — is a
 * separate concern, handled by adding a display offset. Layout never
 * recomputes on pan; only on zoom.
 *
 * Invariants:
 *  - Pieces are in strict figure-x order: `figureEnd[i] <= figureStart[i+1]`.
 *  - `displayX → figureX` (via {@link displayToFigure}) is strictly
 *    increasing on `[displayBounds[0].start, displayBounds[n-1].end]`,
 *    with gradient `+∞` at zero-figure-width fixed pieces.
 *  - `figureX → displayX` is monotonically non-decreasing; flat over any
 *    figure-x gap (multiple figure values map to the same display-x).
 *  - A figure range maps to a *single* display interval even when it
 *    straddles a figure-x gap — the gap collapses in display.
 */

export type ScaleRule = 'flexible' | 'fixed';

export interface Piece {
  /** Figure-space interval. `figureEnd >= figureStart`. Zero-width is
   *  permitted only when `scaleRule === 'fixed'` (a pure breakpoint). */
  readonly figureStart: number;
  readonly figureEnd: number;
  /** How display width is claimed under {@link layoutFigure}. */
  readonly scaleRule: ScaleRule;
  /** Required when `scaleRule === 'fixed'`. */
  readonly fixedDisplayWidth?: number;
}

/**
 * Static, zoom-only layout of the figure. Holds an absolute display
 * extent for every piece, starting at display-x 0.
 *
 * The layout is invariant under pan: the only way these extents change
 * is by recomputing with a different `zoomScale`.
 */
export interface FigureLayout {
  readonly pieces: readonly Piece[];
  readonly displayBounds: readonly { readonly start: number; readonly end: number }[];
  /** Multiplier applied to flexible pieces' figure widths to get display
   *  widths. The user / caller picks this; it isn't derived from a
   *  visible-window solver. */
  readonly zoomScale: number;
  /** Sum of all piece display widths. The display-x of the last piece's
   *  right edge. */
  readonly totalDisplayWidth: number;
}

/**
 * Lay out `pieces` at the given `zoomScale`. Returns a static layout
 * where:
 *  - Piece 0 starts at display-x 0.
 *  - Each subsequent piece starts where the previous one ended.
 *  - A flexible piece's display width is `figureWidth × zoomScale`.
 *  - A fixed piece's display width is `fixedDisplayWidth`.
 *
 * The result is independent of any "visible window." To show a portion
 * of the figure inside a viewport `[0, viewportWidth]`, add a display
 * offset and pass `displayX + offset` to {@link displayToFigure} (and
 * the inverse for figure → display).
 */
export function layoutFigure(
  pieces: readonly Piece[],
  zoomScale: number,
): FigureLayout {
  const n = pieces.length;
  const bounds = new Array<{ start: number; end: number }>(n);
  let cursor = 0;
  for (let i = 0; i < n; i++) {
    const p = pieces[i]!;
    const dispWidth =
      p.scaleRule === 'fixed'
        ? (p.fixedDisplayWidth ?? 0)
        : (p.figureEnd - p.figureStart) * zoomScale;
    bounds[i] = { start: cursor, end: cursor + dispWidth };
    cursor += dispWidth;
  }
  return {
    pieces,
    displayBounds: bounds,
    zoomScale,
    totalDisplayWidth: cursor,
  };
}

/**
 * Forward: figure-x → display-x.
 *
 * Inside a piece's `[figureStart, figureEnd]`, computes the affine map.
 * For figure-x in a gap *between* pieces (`figureEnd[i] < figureX <
 * figureStart[i+1]`), returns the display-x of the join — both adjacent
 * pieces share that display-x. Outside the piece array, extrapolates
 * using `zoomScale` (so callers can ask about figure positions past
 * either end without a separate code path).
 *
 * Never returns null — the figure → display mapping is total.
 */
export function figureToDisplay(layout: FigureLayout, figureX: number): number {
  const { pieces, displayBounds, zoomScale } = layout;
  const n = pieces.length;
  if (n === 0) return 0;

  const first = pieces[0]!;
  if (figureX <= first.figureStart) {
    return displayBounds[0]!.start - (first.figureStart - figureX) * zoomScale;
  }
  for (let i = 0; i < n; i++) {
    const p = pieces[i]!;
    if (figureX <= p.figureEnd) {
      const figSpan = p.figureEnd - p.figureStart;
      const dispSpan = displayBounds[i]!.end - displayBounds[i]!.start;
      if (figSpan <= 0) return displayBounds[i]!.start;
      const t = (figureX - p.figureStart) / figSpan;
      return displayBounds[i]!.start + t * dispSpan;
    }
    if (i + 1 < n && figureX < pieces[i + 1]!.figureStart) {
      // figureX sits in a figure-x gap between pieces[i] and pieces[i+1].
      // Both pieces share this display-x at their join.
      return displayBounds[i]!.end;
    }
  }
  const last = pieces[n - 1]!;
  return displayBounds[n - 1]!.end + (figureX - last.figureEnd) * zoomScale;
}

/**
 * Inverse: display-x → figure-x.
 *
 * Strictly increasing on `[displayBounds[0].start, displayBounds[n-1].end]`
 * (figure-x jumps at zero-figure-width fixed pieces — "breakpoints" —
 * where multiple display values inside the piece's display extent map
 * back to the piece's single figure-x).
 *
 * Convention at piece joins: returns the left piece's `figureEnd`
 * (left-continuous on the display axis). Callers that need the right
 * piece's `figureStart` should add ε.
 */
export function displayToFigure(layout: FigureLayout, displayX: number): number {
  const { pieces, displayBounds, zoomScale } = layout;
  const n = pieces.length;
  if (n === 0) return 0;

  const first = pieces[0]!;
  if (displayX <= displayBounds[0]!.start) {
    if (zoomScale === 0) return first.figureStart;
    return first.figureStart - (displayBounds[0]!.start - displayX) / zoomScale;
  }
  for (let i = 0; i < n; i++) {
    const dEnd = displayBounds[i]!.end;
    if (displayX <= dEnd) {
      const p = pieces[i]!;
      const figSpan = p.figureEnd - p.figureStart;
      const dispSpan = dEnd - displayBounds[i]!.start;
      if (dispSpan <= 0) return p.figureStart;
      const t = (displayX - displayBounds[i]!.start) / dispSpan;
      return p.figureStart + t * figSpan;
    }
  }
  const last = pieces[n - 1]!;
  if (zoomScale === 0) return last.figureEnd;
  return last.figureEnd + (displayX - displayBounds[n - 1]!.end) / zoomScale;
}

/**
 * Map a figure range `[fLo, fHi]` to its display range.
 *
 * Always a *single* display interval, because any figure-x gap straddled
 * by the range collapses to a single display-x.
 */
export function figureRangeToDisplay(
  layout: FigureLayout,
  fLo: number,
  fHi: number,
): readonly [number, number] {
  const lo = Math.min(fLo, fHi);
  const hi = Math.max(fLo, fHi);
  return [figureToDisplay(layout, lo), figureToDisplay(layout, hi)];
}

/**
 * Pieces whose display extent overlaps `[displayLo, displayHi]`. Returned
 * in figure-x order.
 */
export function piecesOverlappingDisplay(
  layout: FigureLayout,
  displayLo: number,
  displayHi: number,
): readonly { readonly piece: Piece; readonly index: number; readonly bounds: { readonly start: number; readonly end: number } }[] {
  const lo = Math.min(displayLo, displayHi);
  const hi = Math.max(displayLo, displayHi);
  const out: { piece: Piece; index: number; bounds: { start: number; end: number } }[] = [];
  for (let i = 0; i < layout.pieces.length; i++) {
    const b = layout.displayBounds[i]!;
    if (b.end < lo) continue;
    if (b.start > hi) break;
    out.push({ piece: layout.pieces[i]!, index: i, bounds: b });
  }
  return out;
}

/**
 * Local display-per-figure derivative at a given display-x.
 *
 * Inside a flexible piece this equals `zoomScale`. Inside a fixed piece
 * with non-zero figure span it's `fixedDisplayWidth / figureSpan`. Past
 * the piece array it's `zoomScale`. At a zero-figure fixed piece it's
 * `+Infinity` (the breakpoint).
 */
export function localScaleAtDisplay(layout: FigureLayout, displayX: number): number {
  const { pieces, displayBounds, zoomScale } = layout;
  for (let i = 0; i < pieces.length; i++) {
    const b = displayBounds[i]!;
    if (displayX < b.start) break;
    if (displayX <= b.end) {
      const p = pieces[i]!;
      if (p.scaleRule === 'flexible') return zoomScale;
      const figSpan = p.figureEnd - p.figureStart;
      const dispSpan = b.end - b.start;
      if (figSpan <= 0) return Infinity;
      return dispSpan / figSpan;
    }
  }
  return zoomScale;
}

/**
 * Fit-zoom: the `zoomScale` that makes the figure's total display width
 * exactly equal `viewportWidth`. Solves
 *
 *   viewportWidth = Σ fixedDisplayWidth + zoomScale × Σ flexibleFigureWidth
 *
 * Returns 1 if there's no flexible content (degenerate case — caller
 * should treat as a constant layout).
 */
export function fitZoomScale(
  pieces: readonly Piece[],
  viewportWidth: number,
): number {
  let totalFlexFigure = 0;
  let totalFixedDisplay = 0;
  for (const p of pieces) {
    if (p.scaleRule === 'flexible') totalFlexFigure += p.figureEnd - p.figureStart;
    else totalFixedDisplay += p.fixedDisplayWidth ?? 0;
  }
  if (totalFlexFigure <= 0) return 1;
  return Math.max(0, (viewportWidth - totalFixedDisplay) / totalFlexFigure);
}
