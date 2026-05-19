import { describe, expect, it } from 'vitest';
import { ProjectionFrame } from './projection-frame.js';
import type { BaselineGeometry } from './types.js';

/** Two exons of 100 baseline-px each separated by a 10-px gap, `pxPerBp = 1`.
 *  Total fit-gene width = 100 + 10 + 100 = 210. Mimics `cds-with-introns`
 *  mode where the gap takes a fixed pixel budget. Exon bp bounds follow the
 *  baseline-builder convention `bp_in_exon = cdsEnd - cdsStart`, so the
 *  arithmetic in the assertions matches what `computeBaseline` would
 *  produce for the same fixture. */
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
      { cdsStart: 1, cdsEnd: 101 },
      { cdsStart: 102, cdsEnd: 202 },
    ],
  };
}

/** Protein-mode fixture: single linear ruler, no gap pixels. 100 aa over
 *  width 100 → `pxPerBp = 1` (frame treats `pxPerBp` as px-per-ruler-unit
 *  in protein mode). */
function proteinBaseline(): { baseline: BaselineGeometry; exons: readonly { cdsStart: number; cdsEnd: number }[] } {
  return {
    baseline: {
      exons: [
        { exonIdx: 0, xStart: 0, xEnd: 50, width: 50 },
        { exonIdx: 1, xStart: 50, xEnd: 99, width: 49 },
      ],
      gaps: [{ exonIdxA: 0, exonIdxB: 1, xStart: 50, xEnd: 50, width: 0 }],
      pxPerBp: 1,
      gapPx: 0,
      totalWidth: 99,
    },
    // CDS bounds drive the per-exon walk in CDS modes; protein mode bypasses
    // them entirely, but the frame still accepts them.
    exons: [
      { cdsStart: 1, cdsEnd: 150 },
      { cdsStart: 151, cdsEnd: 300 },
    ],
  };
}

describe('ProjectionFrame — ruler ↔ baseline (cds-with-introns)', () => {
  it('maps each exon\'s cdsStart to its baseline xStart at fit-gene', () => {
    const { baseline, exons } = withIntronsBaseline();
    const frame = new ProjectionFrame({
      baseline, range: [1, 202], width: 210, mode: 'cds-with-introns', exons,
    });
    expect(frame.rulerToBaselineX(1)).toBeCloseTo(0);
    expect(frame.rulerToBaselineX(101)).toBeCloseTo(100);
    expect(frame.rulerToBaselineX(102)).toBeCloseTo(110);
    expect(frame.rulerToBaselineX(202)).toBeCloseTo(210);
  });

  it('round-trips ruler positions through baselineXToRuler inside exons', () => {
    const { baseline, exons } = withIntronsBaseline();
    const frame = new ProjectionFrame({
      baseline, range: [1, 202], width: 210, mode: 'cds-with-introns', exons,
    });
    for (const r of [1, 25, 50, 75, 101, 102, 150, 202]) {
      const x = frame.rulerToBaselineX(r);
      expect(frame.baselineXToRuler(x)).toBeCloseTo(r);
    }
  });

  it('interpolates baselineXToRuler continuously across the gap', () => {
    const { baseline, exons } = withIntronsBaseline();
    const frame = new ProjectionFrame({
      baseline, range: [1, 202], width: 210, mode: 'cds-with-introns', exons,
    });
    // The fictitious-ruler-through-gap behaviour is what the controller
    // relies on for pan-animation continuity. Lock it in: at the gap's
    // midpoint, ruler-pos should sit half-way between cdsEnd(exon 0) and
    // cdsStart(exon 1).
    expect(frame.baselineXToRuler(100)).toBeCloseTo(101);
    expect(frame.baselineXToRuler(105)).toBeCloseTo(101.5);
    expect(frame.baselineXToRuler(110)).toBeCloseTo(102);
  });

  it('extrapolates past the gene edges using baseline pxPerBp', () => {
    const { baseline, exons } = withIntronsBaseline();
    const frame = new ProjectionFrame({
      baseline, range: [1, 202], width: 210, mode: 'cds-with-introns', exons,
    });
    // Padding region before exon 0: cPos 0 sits one bp left of exon 0's
    // cdsStart=1, so baseline-x = 0 - 1 * pxPerBp = -1.
    expect(frame.rulerToBaselineX(0)).toBeCloseTo(-1);
    // Past the 3' end: cPos 212 is 10 bp past exon 1's cdsEnd=202, so
    // baseline-x = 210 + 10 = 220.
    expect(frame.rulerToBaselineX(212)).toBeCloseTo(220);
  });
});

describe('ProjectionFrame — exonLayout', () => {
  it('exonScale = 1 at fit-gene; exon-current-x matches baseline', () => {
    const { baseline, exons } = withIntronsBaseline();
    const frame = new ProjectionFrame({
      baseline, range: [1, 202], width: 210, mode: 'cds-with-introns', exons,
    });
    const layout = frame.exonLayout();
    expect(layout.exonScale).toBeCloseTo(1);
    expect(layout.exonCurrentX[0]).toBeCloseTo(0);
    expect(layout.exonCurrentX[1]).toBeCloseTo(110);
  });

  it('reserves the visible gap budget when zoomed inside one exon', () => {
    // Zoom into exon 0 only: range = [1, 101]. No gap in view.
    // visibleScalingBaseline = 100 (rulerToBaselineX(101) - rulerToBaselineX(1))
    // exonScale = 210 / 100 = 2.1.
    const { baseline, exons } = withIntronsBaseline();
    const frame = new ProjectionFrame({
      baseline, range: [1, 101], width: 210, mode: 'cds-with-introns', exons,
    });
    const layout = frame.exonLayout();
    expect(layout.exonScale).toBeCloseTo(2.1, 4);
    // Exon 0's left edge should be anchored at screen-x 0.
    expect(layout.exonCurrentX[0]).toBeCloseTo(0);
  });

  it('keeps gap baseline pixels at a fixed screen width in cds-with-introns', () => {
    // Zoom that straddles the gap: range = [51, 151]. The 10-px gap should
    // occupy exactly 10 px of screen regardless of zoom — that's the load-
    // bearing property the gap-budget logic was added for.
    // rulerToBaselineX(51) = 50, rulerToBaselineX(151) = 110 + (151-102)*1 = 159.
    // Visible exon baseline = (100 - 50) + (159 - 110) = 99; gap baseline = 10.
    // Solve: 99 * scale + 10 = 210 → scale = 200/99 ≈ 2.0202.
    const { baseline, exons } = withIntronsBaseline();
    const frame = new ProjectionFrame({
      baseline, range: [51, 151], width: 210, mode: 'cds-with-introns', exons,
    });
    const layout = frame.exonLayout();
    expect(layout.exonScale).toBeCloseTo(200 / 99, 4);
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
      baseline, range: [1, 202], width: 210, mode: 'cds-with-introns', exons,
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
      baseline, range: [51, 151], width: 210, mode: 'cds-with-introns', exons,
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
      baseline, range: [1, 202], width: 210, mode: 'cds-with-introns', exons,
    });
    expect(fit.zoomFactor()).toBeCloseTo(1, 4);
    const zoomed = new ProjectionFrame({
      baseline, range: [1, 101], width: 210, mode: 'cds-with-introns', exons,
    });
    expect(zoomed.zoomFactor()).toBeGreaterThan(1.5);
  });
});

describe('ProjectionFrame — protein mode', () => {
  it('rulerToBaselineX is linear in aa: aa=1 at x=0, aa=aaLen at x=width', () => {
    const { baseline, exons } = proteinBaseline();
    const frame = new ProjectionFrame({
      baseline, range: [1, 100], width: 99, mode: 'protein', exons,
    });
    expect(frame.rulerToBaselineX(1)).toBeCloseTo(0);
    expect(frame.rulerToBaselineX(100)).toBeCloseTo(99);
    expect(frame.rulerToBaselineX(50)).toBeCloseTo(49);
  });

  it('baselineXToRuler inverts the linear protein mapping', () => {
    const { baseline, exons } = proteinBaseline();
    const frame = new ProjectionFrame({
      baseline, range: [1, 100], width: 99, mode: 'protein', exons,
    });
    expect(frame.baselineXToRuler(0)).toBeCloseTo(1);
    expect(frame.baselineXToRuler(99)).toBeCloseTo(100);
    expect(frame.baselineXToRuler(49)).toBeCloseTo(50);
  });
});

describe('ProjectionFrame — degenerate inputs', () => {
  it('returns 0/null gracefully when the baseline is empty', () => {
    const baseline: BaselineGeometry = {
      exons: [], gaps: [], pxPerBp: 0, gapPx: 0, totalWidth: 0,
    };
    const frame = new ProjectionFrame({
      baseline, range: [1, 1], width: 0, mode: 'cds-spliced', exons: [],
    });
    expect(frame.rulerToBaselineX(50)).toBe(0);
    expect(frame.baselineXToRuler(0)).toBe(0);
    expect(frame.baselineToCurrent(0)).toBeNull();
    expect(frame.currentToBaseline(0)).toBeNull();
  });
});
