import { describe, expect, it } from 'vitest';
import { ProjectionFrame } from './projection-frame.js';
import type { BaselineGeometry } from './types.js';

/** Two exons of 100 bp (cells) each separated by a 10-px gap, `pxPerBp = 1`.
 *  Cell-width invariant: bp N has a cell of `pxPerBp` width centred at
 *  `(N - cdsStart + 0.5) * pxPerBp + exon.xStart`. Exon 0 covers bp 1..100,
 *  so cells tile [0, 100]; exon 1 covers bp 101..200 over [110, 210].
 *  Total fit-gene width = 100 + 10 + 100 = 210. Mimics `genome`
 *  mode where the gap takes a fixed pixel budget. */
function withIntronsBaseline(): { baseline: BaselineGeometry; exons: readonly { cdsStart: number; cdsEnd: number }[] } {
  return {
    baseline: {
      exons: [
        { exonIdx: 0, xStart: 0, xEnd: 100, width: 100 },
        { exonIdx: 1, xStart: 110, xEnd: 210, width: 100 },
      ],
      gaps: [{ exonIdxA: 0, exonIdxB: 1, xStart: 100, xEnd: 110, width: 10 }],
      pxPerBp: 1,
      gapPx: 10,
      totalWidth: 210,
    },
    exons: [
      { cdsStart: 1, cdsEnd: 100 },
      { cdsStart: 101, cdsEnd: 200 },
    ],
  };
}

/** Protein-mode fixture: single linear ruler, no gap pixels. 100 aa over
 *  width 100 → `pxPerBp = 1` (frame treats `pxPerBp` as px-per-ruler-unit
 *  in protein mode). Cells tile cleanly: aa 1..50 on exon 0 [0, 50], aa
 *  51..100 on exon 1 [50, 100]. */
function proteinBaseline(): { baseline: BaselineGeometry; exons: readonly { cdsStart: number; cdsEnd: number }[] } {
  return {
    baseline: {
      exons: [
        { exonIdx: 0, xStart: 0, xEnd: 50, width: 50 },
        { exonIdx: 1, xStart: 50, xEnd: 100, width: 50 },
      ],
      gaps: [{ exonIdxA: 0, exonIdxB: 1, xStart: 50, xEnd: 50, width: 0 }],
      pxPerBp: 1,
      gapPx: 0,
      totalWidth: 100,
    },
    // CDS bounds drive the per-exon walk in CDS modes; protein mode bypasses
    // them entirely, but the frame still accepts them.
    exons: [
      { cdsStart: 1, cdsEnd: 150 },
      { cdsStart: 151, cdsEnd: 300 },
    ],
  };
}

describe('ProjectionFrame — ruler ↔ baseline (genome)', () => {
  it('maps each bp to the centre of its cell at fit-gene', () => {
    const { baseline, exons } = withIntronsBaseline();
    const frame = new ProjectionFrame({
      baseline, range: [1, 200], width: 210, mode: 'genome', exons,
    });
    // Cell-width invariant: bp N's centre = (N - cdsStart + 0.5) * pxPerBp + exon.xStart.
    expect(frame.rulerToBaselineX(1)).toBeCloseTo(0.5);     // exon 0, first cell centre
    expect(frame.rulerToBaselineX(100)).toBeCloseTo(99.5);  // exon 0, last cell centre
    expect(frame.rulerToBaselineX(101)).toBeCloseTo(110.5); // exon 1, first cell centre
    expect(frame.rulerToBaselineX(200)).toBeCloseTo(209.5); // exon 1, last cell centre
    // Cell EDGES land on the exon rects' baseline endpoints.
    expect(frame.rulerToBaselineX(0.5)).toBeCloseTo(0);     // bp 1's left cell edge
    expect(frame.rulerToBaselineX(100.5)).toBeCloseTo(100); // bp 100's right cell edge
    expect(frame.rulerToBaselineX(200.5)).toBeCloseTo(210); // bp 200's right cell edge
  });

  it('round-trips ruler positions through baselineXToRuler inside exons', () => {
    const { baseline, exons } = withIntronsBaseline();
    const frame = new ProjectionFrame({
      baseline, range: [1, 200], width: 210, mode: 'genome', exons,
    });
    for (const r of [1, 25, 50, 75, 100, 101, 150, 200]) {
      const x = frame.rulerToBaselineX(r);
      expect(frame.baselineXToRuler(x)).toBeCloseTo(r);
    }
  });

  it('interpolates baselineXToRuler continuously across the gap', () => {
    const { baseline, exons } = withIntronsBaseline();
    const frame = new ProjectionFrame({
      baseline, range: [1, 200], width: 210, mode: 'genome', exons,
    });
    // The fictitious-ruler-through-gap behaviour is what the controller
    // relies on for pan-animation continuity. Lock it in: at the gap's
    // boundaries, the ruler sits on bp 100's right cell edge (= 100.5)
    // and bp 101's left cell edge (= 100.5 again, post-snap).
    expect(frame.baselineXToRuler(100)).toBeCloseTo(100.5);
    expect(frame.baselineXToRuler(105)).toBeCloseTo(100.5);
    expect(frame.baselineXToRuler(110)).toBeCloseTo(100.5);
  });

  it('extrapolates past the gene edges using baseline pxPerBp', () => {
    const { baseline, exons } = withIntronsBaseline();
    const frame = new ProjectionFrame({
      baseline, range: [1, 200], width: 210, mode: 'genome', exons,
    });
    // Padding before bp 1's cell: ruler 0 is 0.5 bp left of bp 1's centre
    // (= 0.5 bp left of x=0.5), so baseline-x = -0.5.
    expect(frame.rulerToBaselineX(0)).toBeCloseTo(-0.5);
    // Past the 3' end: ruler 210 is 10 bp past bp 200, whose centre is at
    // 209.5; the extrapolation steps a full bp per ruler unit, so 210 lands
    // at 209.5 + 10 * 1 = 219.5.
    expect(frame.rulerToBaselineX(210)).toBeCloseTo(219.5);
  });
});

describe('ProjectionFrame — exonLayout', () => {
  it('exonScale = 1 at fit-gene; exon-current-x matches baseline', () => {
    const { baseline, exons } = withIntronsBaseline();
    const frame = new ProjectionFrame({
      baseline, range: [1, 200], width: 210, mode: 'genome', exons,
    });
    const layout = frame.exonLayout();
    expect(layout.exonScale).toBeCloseTo(1);
    expect(layout.exonCurrentX[0]).toBeCloseTo(0);
    expect(layout.exonCurrentX[1]).toBeCloseTo(110);
  });

  it('reserves the visible gap budget when zoomed inside one exon', () => {
    // Zoom into exon 0 only: range = [1, 100] (cell-inclusive).
    // S_lo = 0 (bp 1's left cell edge), S_hi = 100 (bp 100's right cell edge).
    // No gap in view. visibleScalingBaseline = 100. exonScale = 210/100 = 2.1.
    const { baseline, exons } = withIntronsBaseline();
    const frame = new ProjectionFrame({
      baseline, range: [1, 100], width: 210, mode: 'genome', exons,
    });
    const layout = frame.exonLayout();
    expect(layout.exonScale).toBeCloseTo(2.1, 4);
    // Exon 0's left edge IS S_lo, so its current-x is at 0.
    expect(layout.exonCurrentX[0]).toBeCloseTo(0, 4);
  });

  it('keeps gap baseline pixels at a fixed screen width in genome', () => {
    // Zoom that straddles the gap: range = [51, 150] (cell-inclusive).
    // S_lo = 50 (bp 51's left cell edge), S_hi = 160 (bp 150's right cell
    // edge) → baseline span 110. Gap [100, 110] fully visible at 10 px.
    // visibleFixed = 10, visibleScaling = 100. exonScale = (210 - 10) / 100
    // = 2 — exactly. The gap holds its 10-px budget even as exons stretch.
    const { baseline, exons } = withIntronsBaseline();
    const frame = new ProjectionFrame({
      baseline, range: [51, 150], width: 210, mode: 'genome', exons,
    });
    const layout = frame.exonLayout();
    expect(layout.exonScale).toBeCloseTo(2, 4);
    // Verify exon 1 sits exactly 10 px past exon 0's right edge in screen
    // space — the gap stays at its baseline width.
    const exon0End = layout.exonCurrentX[0]! + 100 * layout.exonScale;
    expect(layout.exonCurrentX[1]).toBeCloseTo(exon0End + 10, 4);
  });
});

describe('ProjectionFrame — baseline ↔ current screen', () => {
  it('round-trips baseline through current at fit-gene', () => {
    const { baseline, exons } = withIntronsBaseline();
    const frame = new ProjectionFrame({
      baseline, range: [1, 200], width: 210, mode: 'genome', exons,
    });
    for (const s of [0, 50, 100, 105, 110, 160, 210]) {
      const cur = frame.baselineToCurrent(s);
      expect(cur).not.toBeNull();
      expect(frame.currentToBaseline(cur!)).toBeCloseTo(s, 4);
    }
  });

  it('round-trips baseline through current when zoomed across a gap', () => {
    const { baseline, exons } = withIntronsBaseline();
    const frame = new ProjectionFrame({
      baseline, range: [51, 150], width: 210, mode: 'genome', exons,
    });
    for (const s of [50, 75, 100, 105, 110, 130, 159]) {
      const cur = frame.baselineToCurrent(s);
      expect(cur).not.toBeNull();
      expect(frame.currentToBaseline(cur!)).toBeCloseTo(s, 4);
    }
  });

  it('zoomFactor reports 1 at fit-gene and > 1 when zoomed', () => {
    const { baseline, exons } = withIntronsBaseline();
    const fit = new ProjectionFrame({
      baseline, range: [1, 200], width: 210, mode: 'genome', exons,
    });
    expect(fit.zoomFactor()).toBeCloseTo(1, 4);
    const zoomed = new ProjectionFrame({
      baseline, range: [1, 100], width: 210, mode: 'genome', exons,
    });
    expect(zoomed.zoomFactor()).toBeGreaterThan(1.5);
  });

  it('S_hi maps to current-x = width even when visible window includes 5\' padding (genome)', () => {
    // Pan into the padding zone before the gene: S_lo lands negative.
    // Pre-fix, the layout treated the padding region as if it scaled with
    // linearScale (the formula divided by `S_hi - S_lo - visibleFixed`,
    // ignoring that padding is rendered 1:1 in anyFixed mode). The total
    // screen width covered then over-shot `width` by `padding * (1 -
    // scale)`. The new layout subtracts padding-baseline from both sides
    // and `baselineToCurrent` uses `paddingScale` (= 1 here) for the
    // padding extrapolation.
    const { baseline, exons } = withIntronsBaseline();
    // range = [-10, 100] (cell-inclusive). S_lo = rulerToBaselineX(-10.5)
    // = -11 (the bp 1-cell-edge extrapolation crosses 0.5 of a bp); S_hi
    // = rulerToBaselineX(100.5) = 100 (bp 100's right cell edge).
    const frame = new ProjectionFrame({
      baseline, range: [-10, 100], width: 210, mode: 'genome', exons,
    });
    expect(frame.baselineToCurrent(-11)).toBeCloseTo(0, 4);
    expect(frame.baselineToCurrent(100)).toBeCloseTo(210, 4);
  });
});

describe('ProjectionFrame — protein mode', () => {
  it('rulerToBaselineX places aa N at its cell centre', () => {
    const { baseline, exons } = proteinBaseline();
    const frame = new ProjectionFrame({
      baseline, range: [1, 100], width: 100, mode: 'protein', exons,
    });
    // Cell-width invariant: aa N centre = (N - 0.5) * pxPerAa.
    expect(frame.rulerToBaselineX(1)).toBeCloseTo(0.5);
    expect(frame.rulerToBaselineX(50)).toBeCloseTo(49.5);
    expect(frame.rulerToBaselineX(100)).toBeCloseTo(99.5);
    // Cell EDGES land on figure / exon endpoints.
    expect(frame.rulerToBaselineX(0.5)).toBeCloseTo(0);
    expect(frame.rulerToBaselineX(100.5)).toBeCloseTo(100);
  });

  it('baselineXToRuler inverts the cell mapping', () => {
    const { baseline, exons } = proteinBaseline();
    const frame = new ProjectionFrame({
      baseline, range: [1, 100], width: 100, mode: 'protein', exons,
    });
    expect(frame.baselineXToRuler(0.5)).toBeCloseTo(1);
    expect(frame.baselineXToRuler(49.5)).toBeCloseTo(50);
    expect(frame.baselineXToRuler(99.5)).toBeCloseTo(100);
  });
});

describe('ProjectionFrame — degenerate inputs', () => {
  it('returns 0/null gracefully when the baseline is empty', () => {
    const baseline: BaselineGeometry = {
      exons: [], gaps: [], pxPerBp: 0, gapPx: 0, totalWidth: 0,
    };
    const frame = new ProjectionFrame({
      baseline, range: [1, 1], width: 0, mode: 'transcript', exons: [],
    });
    expect(frame.rulerToBaselineX(50)).toBe(0);
    expect(frame.baselineXToRuler(0)).toBe(0);
    expect(frame.baselineToCurrent(0)).toBeNull();
    expect(frame.currentToBaseline(0)).toBeNull();
  });
});
