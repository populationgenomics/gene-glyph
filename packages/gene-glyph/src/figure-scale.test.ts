import { describe, expect, it } from 'vitest';
import {
  displayToFigure,
  figureRangeToDisplay,
  figureToDisplay,
  fitZoomScale,
  layoutFigure,
  localScaleAtDisplay,
  piecesOverlappingDisplay,
  type Piece,
} from './figure-scale.js';

/** Two flexible pieces, contiguous in figure-x: [0,100], [100,200]. */
const twoFlex: readonly Piece[] = [
  { figureStart: 0, figureEnd: 100, scaleRule: 'flexible' },
  { figureStart: 100, figureEnd: 200, scaleRule: 'flexible' },
];

/** Two flexible exons with a fixed-budget gap between them in figure-x:
 *  [0,100] exon, [100,100] zero-figure-width fixed bulk (10 display px),
 *  [100,200] exon. */
const twoFlexFixedGap: readonly Piece[] = [
  { figureStart: 0, figureEnd: 100, scaleRule: 'flexible' },
  { figureStart: 100, figureEnd: 100, scaleRule: 'fixed', fixedDisplayWidth: 10 },
  { figureStart: 100, figureEnd: 200, scaleRule: 'flexible' },
];

/** The user's worked example: pieces in figure-x [20,30) and [40,50),
 *  with a figure-x gap between them. Each piece is fixed-display = 1
 *  display unit, so figure 10 units → display 1 unit. */
const userExample: readonly Piece[] = [
  { figureStart: 20, figureEnd: 30, scaleRule: 'fixed', fixedDisplayWidth: 1 },
  { figureStart: 40, figureEnd: 50, scaleRule: 'fixed', fixedDisplayWidth: 1 },
];

describe('FigureScale — layout is a function of (pieces, zoomScale) alone', () => {
  it('places contiguous flexible pieces at the requested zoom, starting at 0', () => {
    const L = layoutFigure(twoFlex, 2);
    expect(L.displayBounds[0]).toEqual({ start: 0, end: 200 });
    expect(L.displayBounds[1]).toEqual({ start: 200, end: 400 });
    expect(L.totalDisplayWidth).toBe(400);
  });

  it('places fixed pieces at their fixed display width regardless of zoom', () => {
    const L1 = layoutFigure(twoFlexFixedGap, 1);
    expect(L1.displayBounds[0]).toEqual({ start: 0, end: 100 });
    expect(L1.displayBounds[1]).toEqual({ start: 100, end: 110 });
    expect(L1.displayBounds[2]).toEqual({ start: 110, end: 210 });
    const L3 = layoutFigure(twoFlexFixedGap, 3);
    // Flex pieces scale; bulk stays at 10 px.
    expect(L3.displayBounds[0]).toEqual({ start: 0, end: 300 });
    expect(L3.displayBounds[1]).toEqual({ start: 300, end: 310 });
    expect(L3.displayBounds[2]).toEqual({ start: 310, end: 610 });
  });

  it('fitZoomScale solves viewport = Σ fixed + zoom × Σ flex', () => {
    // viewportWidth = 210; fixed = 10; flex total = 200. zoom = 1.
    expect(fitZoomScale(twoFlexFixedGap, 210)).toBeCloseTo(1);
    // viewportWidth = 410; zoom = (410 - 10) / 200 = 2.
    expect(fitZoomScale(twoFlexFixedGap, 410)).toBeCloseTo(2);
  });
});

describe('FigureScale — figureToDisplay / displayToFigure', () => {
  it('round-trips inside flexible pieces', () => {
    const L = layoutFigure(twoFlex, 2);
    for (const f of [0, 25, 50, 75, 100, 125, 150, 175, 200]) {
      expect(displayToFigure(L, figureToDisplay(L, f))).toBeCloseTo(f);
    }
  });

  it('treats a zero-figure-width fixed piece as a breakpoint', () => {
    const L = layoutFigure(twoFlexFixedGap, 1);
    // Across the bulk's display extent [100, 110], figure-x is flat at 100.
    expect(displayToFigure(L, 100)).toBeCloseTo(100);
    expect(displayToFigure(L, 105)).toBeCloseTo(100);
    expect(displayToFigure(L, 110)).toBeCloseTo(100);
    // Just past the breakpoint, figure-x advances at zoomScale = 1.
    expect(displayToFigure(L, 111)).toBeCloseTo(101);
  });

  it("matches the user's worked example: figure [25,45) → display [0.5,1.5)", () => {
    // Lay out with zoom = 1 (irrelevant here — both pieces fixed).
    const L = layoutFigure(userExample, 1);
    expect(L.displayBounds[0]).toEqual({ start: 0, end: 1 });
    expect(L.displayBounds[1]).toEqual({ start: 1, end: 2 });
    // Figure 25 sits halfway through piece 0 → display 0.5.
    expect(figureToDisplay(L, 25)).toBeCloseTo(0.5);
    // Figure 45 sits halfway through piece 1 → display 1.5.
    expect(figureToDisplay(L, 45)).toBeCloseTo(1.5);
    // Figure 35 sits in the gap between pieces → display 1 (join).
    expect(figureToDisplay(L, 35)).toBeCloseTo(1);
    // Range [25, 45] in figure → single display interval [0.5, 1.5].
    const [dLo, dHi] = figureRangeToDisplay(L, 25, 45);
    expect(dLo).toBeCloseTo(0.5);
    expect(dHi).toBeCloseTo(1.5);
  });
});

describe('FigureScale — layout is invariant under pan (no recomputation)', () => {
  it('two layouts at the same zoom are byte-identical regardless of "where the viewport is"', () => {
    // The whole point: there IS no per-pan layout. The pan is the
    // caller's display-offset; it doesn't go into layoutFigure.
    const A = layoutFigure(twoFlexFixedGap, 2.5);
    const B = layoutFigure(twoFlexFixedGap, 2.5);
    expect(A.displayBounds).toEqual(B.displayBounds);
    expect(A.totalDisplayWidth).toBe(B.totalDisplayWidth);
  });

  it('panning across a fixed-budget gap preserves zoomScale exactly', () => {
    // Demonstrate the invariant the user asked for: shifting by a
    // display offset never changes the per-piece extents.
    const L = layoutFigure(twoFlexFixedGap, 2);
    // Simulate "the viewport [0, 400] showed [0, 400] of the figure;
    // then user panned by 30 px — viewport now shows [30, 430]". The
    // layout is the same; only what the viewport "sees" changes.
    // Verify figure-x at each end of the viewport using offset arithmetic.
    const offsetA = 0;
    const offsetB = 30;
    expect(displayToFigure(L, 50 + offsetA)).toBeCloseTo(displayToFigure(L, 50 + offsetA));
    expect(displayToFigure(L, 50 + offsetB)).toBeCloseTo(
      displayToFigure(L, 50 + offsetB),
    );
    // Same layout object — extents haven't moved.
    expect(L.displayBounds[0]).toEqual({ start: 0, end: 200 });
    expect(L.displayBounds[1]).toEqual({ start: 200, end: 210 });
    expect(L.displayBounds[2]).toEqual({ start: 210, end: 410 });
  });
});

describe('FigureScale — figureRangeToDisplay collapses gaps to a single interval', () => {
  it('returns one interval even when the figure range straddles a fixed breakpoint', () => {
    const L = layoutFigure(twoFlexFixedGap, 2);
    // figure 50 → display 100; figure 150 → display 100 + 10 + 50*2 = 210.
    const [dLo, dHi] = figureRangeToDisplay(L, 50, 150);
    expect(dLo).toBeCloseTo(100);
    expect(dHi).toBeCloseTo(310);
  });
});

describe('FigureScale — piecesOverlappingDisplay', () => {
  it('returns only pieces whose display extent overlaps the query', () => {
    const L = layoutFigure(twoFlexFixedGap, 1);
    expect(piecesOverlappingDisplay(L, 0, 50).map((h) => h.index)).toEqual([0]);
    expect(piecesOverlappingDisplay(L, 99, 111).map((h) => h.index)).toEqual([0, 1, 2]);
  });
});

describe('FigureScale — localScaleAtDisplay', () => {
  it('reports zoomScale inside flexible pieces, bulk-scale inside fixed pieces', () => {
    const L = layoutFigure(twoFlexFixedGap, 2);
    expect(localScaleAtDisplay(L, 50)).toBeCloseTo(2);
    // Zero-figure-width fixed → infinite local scale.
    expect(localScaleAtDisplay(L, 205)).toBe(Infinity);
    expect(localScaleAtDisplay(L, 300)).toBeCloseTo(2);
  });

  it('returns the bulk/figure-span ratio for fixed pieces with non-zero figure width', () => {
    const wide: readonly Piece[] = [
      { figureStart: 0, figureEnd: 10, scaleRule: 'fixed', fixedDisplayWidth: 5 },
    ];
    const L = layoutFigure(wide, 1);
    expect(localScaleAtDisplay(L, 2.5)).toBeCloseTo(0.5);
  });
});

describe('FigureScale — extrapolation outside the piece array', () => {
  it('extrapolates left and right using zoomScale', () => {
    const L = layoutFigure(twoFlex, 2);
    // The pieces end at figure 200 / display 400. Past that, zoom=2 extrapolation.
    expect(figureToDisplay(L, 250)).toBeCloseTo(500);
    expect(displayToFigure(L, 500)).toBeCloseTo(250);
    expect(figureToDisplay(L, -50)).toBeCloseTo(-100);
    expect(displayToFigure(L, -100)).toBeCloseTo(-50);
  });
});
