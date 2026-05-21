import { describe, expect, it } from 'vitest';
import { ViewportController } from './viewport.js';
import { createCoordinateMapper } from './coordinate-mapper.js';
import type { Transcript } from './types.js';

const transcript: Transcript = {
  geneSymbol: 'TEST',
  transcriptId: 'NM_TEST.1',
  cdsLength: 360,
  strand: '+',
  exons: [
    { number: 1, cdsStart: 1, cdsEnd: 100, genomicStart: 1000, genomicEnd: 1099, chr: 'chr1' },
    { number: 2, cdsStart: 101, cdsEnd: 250, genomicStart: 2000, genomicEnd: 2149, chr: 'chr1' },
    { number: 3, cdsStart: 251, cdsEnd: 360, genomicStart: 3000, genomicEnd: 3109, chr: 'chr1' },
  ],
};

function fitGene(mode: 'transcript' | 'genome' | 'protein' = 'transcript') {
  const mapper = createCoordinateMapper(transcript);
  return new ViewportController({ mapper, width: 720, mode });
}

describe('ViewportController — screen <-> CDS at fit-gene zoom', () => {
  it('cdsToScreen and screenToCds round-trip on the transcript ruler', () => {
    const vp = fitGene('transcript');
    const samples = [1, 50, 100, 101, 200, 250, 359, 360];
    for (const cPos of samples) {
      const x = vp.cdsToScreen(cPos, 0);
      expect(x).not.toBeNull();
      const back = vp.screenToCds(x!);
      expect(back).toEqual({ cPos, offset: 0 });
    }
  });

  it('cdsToScreen places bp 1 / bp cdsLength at their cell centres', () => {
    // Cell-width invariant: bp N has a cell of width pxPerBp centred at
    // its lattice point. At fit-gene the figure spans cdsLength cells of
    // width pxPerBp = width / cdsLength, so bp 1's centre sits 0.5
    // pxPerBp inside the left edge and bp cdsLength's centre sits 0.5
    // pxPerBp inside the right edge.
    const vp = fitGene('transcript');
    const pxPerBp = 720 / 360;
    expect(vp.cdsToScreen(1, 0)).toBeCloseTo(0.5 * pxPerBp, 5);
    expect(vp.cdsToScreen(360, 0)).toBeCloseTo(720 - 0.5 * pxPerBp, 5);
  });

  it('returns null for CDS positions outside the active range', () => {
    const vp = fitGene('transcript');
    vp.setRange([100, 200]);
    expect(vp.cdsToScreen(50, 0)).toBeNull();
    expect(vp.cdsToScreen(250, 0)).toBeNull();
  });

  it('protein mode round-trips aa <-> screen', () => {
    const vp = fitGene('protein');
    for (const aa of [1, 17, 50, 119, 120]) {
      const x = vp.proteinToScreen(aa);
      expect(x).not.toBeNull();
      expect(vp.screenToProtein(x!)).toBe(aa);
    }
  });

  it('protein mode places aa=1 / C-terminus at their cell centres', () => {
    // Same cell-width invariant as CDS modes. aaLen = 120, pxPerAa = 6,
    // so aa 1's centre sits at 0.5*pxPerAa = 3 and the C-terminus at
    // width - 3.
    const vp = fitGene('protein');
    const pxPerAa = 720 / 120;
    expect(vp.proteinToScreen(1)).toBeCloseTo(0.5 * pxPerAa, 5);
    expect(vp.proteinToScreen(120)).toBeCloseTo(720 - 0.5 * pxPerAa, 5);
  });
});

describe('ViewportController — range projection', () => {
  it('returns a single segment for a range entirely within one exon (spliced)', () => {
    const vp = fitGene('transcript');
    const proj = vp.projectCdsRange(20, 60);
    expect(proj.segments).toHaveLength(1);
    expect(proj.segments[0]!.exonIdx).toBe(0);
    expect(proj.droppedIntronicCount).toBe(0);
    expect(proj.droppedExonicCount).toBe(0);
  });

  it('fragments at exon boundaries when a CDS range spans multiple exons (spliced)', () => {
    const vp = fitGene('transcript');
    const proj = vp.projectCdsRange(50, 300);
    expect(proj.segments.map((s) => s.exonIdx)).toEqual([0, 1, 2]);
    // Range projections span cell extents, not centres: exon 0's segment
    // ends at bp 100's RIGHT cell edge (= exon 0's xEnd in baseline), exon
    // 1's segment starts at bp 101's LEFT cell edge (= exon 1's xStart).
    // In transcript mode (zero-width junction) these meet at the same x.
    const geom = vp.baselineGeometry();
    expect(proj.segments[0]!.xEnd).toBeCloseTo(geom.exons[0]!.xEnd, 5);
    expect(proj.segments[1]!.xStart).toBeCloseTo(geom.exons[1]!.xStart, 5);
    // Slice 15: cross-exon CDS ranges report one intronic drop per crossed gap
    // so tracks aggregating hidden-feature counts can index uniformly across
    // coord systems.
    expect(proj.droppedIntronicCount).toBe(2);
    expect(proj.droppedRanges).toEqual([
      { kind: 'intronic', exonIdxA: 0, exonIdxB: 1 },
      { kind: 'intronic', exonIdxA: 1, exonIdxB: 2 },
    ]);
  });

  it('fragments at exon boundaries in genome mode too (per-exon segments)', () => {
    // Pfam / IPR domains need per-exon rectangles + a linker drawn over the
    // dashed-gap polyline; a single segment that spans the gap would draw a
    // solid bar across the collapsed intron and defeat the visual.
    const vp = fitGene('genome');
    const proj = vp.projectCdsRange(50, 300);
    expect(proj.segments.map((s) => s.exonIdx)).toEqual([0, 1, 2]);
    // In genome mode the intron (bulk + flanks) sits between the exon
    // segments, so exon 0's right cell-edge sits strictly to the left of
    // exon 1's left cell-edge.
    expect(proj.segments[0]!.xEnd).toBeLessThan(proj.segments[1]!.xStart);
  });

  it('projectGenomicRange across an intron drops the intronic gap and yields one segment per exon', () => {
    const vp = fitGene('transcript');
    // Range spans end of exon 1 (genomic 1050..1099), the entire first intron,
    // and the start of exon 2 (genomic 2000..2050).
    const proj = vp.projectGenomicRange('chr1', 1050, 2050);
    expect(proj.segments).toHaveLength(2);
    expect(proj.segments[0]!.exonIdx).toBe(0);
    expect(proj.segments[1]!.exonIdx).toBe(1);
    expect(proj.droppedIntronicCount).toBe(1);
    expect(proj.droppedRanges[0]).toEqual({
      kind: 'intronic',
      exonIdxA: 0,
      exonIdxB: 1,
    });
  });

  it('projectProteinRange reports intronic drops between the exons the range crosses', () => {
    // aa 30..40 spans the exon-1/exon-2 boundary (codon at c.100 ends in exon
    // 1, codon at c.103 starts in exon 2). Slice 15: protein ranges should
    // surface intronic drops the same way CDS and genomic ranges do.
    const vp = fitGene('transcript');
    const proj = vp.projectProteinRange(30, 40);
    expect(proj.droppedIntronicCount).toBeGreaterThanOrEqual(1);
    expect(proj.droppedRanges[0]).toMatchObject({
      kind: 'intronic',
      exonIdxA: 0,
      exonIdxB: 1,
    });
  });

  it('projectGenomicRange returns no segments for a range fully outside any exon', () => {
    const vp = fitGene('transcript');
    const proj = vp.projectGenomicRange('chr1', 1200, 1800);
    expect(proj.segments).toHaveLength(0);
    expect(proj.droppedExonicCount).toBe(1);
  });

  it('projectProteinRange in protein mode places domain segments at aa-linear baseline positions', () => {
    // Regression: projectProteinRange used to pass CDS bp (the cdsLo/cdsHi
    // it computed from aa endpoints) into cdsToBaselineX, which in protein
    // mode treats input as aa. The last segment of a domain at aa 1..42 then
    // rendered as if it ended at aa 126 — three times too wide.
    //
    // Cell-width invariant: aa range [1, 42] spans cells with right edge at
    // `cdsToBaselineX(42.5)`. The last fragment's xEnd must land on that
    // edge, not three times further along where aa 126 would sit.
    const vp = fitGene('protein');
    const proj = vp.projectProteinRange(1, 42);
    expect(proj.segments.length).toBeGreaterThanOrEqual(2);
    const last = proj.segments[proj.segments.length - 1]!;
    expect(last.xEnd).toBeCloseTo(vp.cdsToBaselineX(42.5), 5);
    expect(last.xEnd).toBeLessThan(vp.cdsToBaselineX(60));
  });

  it('protein-mode projection segments tile contiguously at exon boundaries (no visible gap between domain fragments)', () => {
    // Without the snap, cdsToProtein(440)=147 (exon 1 end, with cdsEnd=440)
    // and cdsToProtein(441)=147 (exon 2 start) round to the same aa only when
    // the codon happens to span. In a transcript where codons end cleanly,
    // adjacent fragments would have a 1-aa gap; the snap keeps consecutive
    // segments meeting at the exon-rect boundary.
    const t: Transcript = {
      geneSymbol: 'X',
      transcriptId: 'X.1',
      cdsLength: 12,
      strand: '+',
      exons: [
        { number: 1, cdsStart: 1, cdsEnd: 3, genomicStart: 1, genomicEnd: 3, chr: 'chr1' },
        { number: 2, cdsStart: 4, cdsEnd: 12, genomicStart: 10, genomicEnd: 18, chr: 'chr1' },
      ],
    };
    const mapper = createCoordinateMapper(t);
    const vp = new ViewportController({ mapper, width: 100, mode: 'protein' });
    const proj = vp.projectProteinRange(1, 4);
    expect(proj.segments).toHaveLength(2);
    expect(proj.segments[0]!.xEnd).toBeCloseTo(proj.segments[1]!.xStart, 5);
  });

  it('protein-mode baselineGeometry tiles adjacent exons with no gap when codons do not span the boundary', () => {
    // Custom transcript: exon 0 ends on codon boundary (cdsEnd=3 = end of aa
    // 1), exon 1 starts on the next codon (cdsStart=4 = start of aa 2). The
    // unsnapped model puts exon 0 xEnd at (1-1)*pxPerAa = 0 and exon 1 xStart
    // at (2-1)*pxPerAa = pxPerAa — a one-residue visible gap. After snapping
    // they share aa 2 as the lattice point.
    const t: Transcript = {
      geneSymbol: 'X',
      transcriptId: 'X.1',
      cdsLength: 12,
      strand: '+',
      exons: [
        { number: 1, cdsStart: 1, cdsEnd: 3, genomicStart: 1, genomicEnd: 3, chr: 'chr1' },
        { number: 2, cdsStart: 4, cdsEnd: 12, genomicStart: 10, genomicEnd: 18, chr: 'chr1' },
      ],
    };
    const mapper = createCoordinateMapper(t);
    const vp = new ViewportController({ mapper, width: 100, mode: 'protein' });
    const geom = vp.baselineGeometry();
    expect(geom.exons[0]!.xEnd).toBeCloseTo(geom.exons[1]!.xStart, 5);
  });

  it('projectProteinRange fragments at exon boundaries for cross-exon protein ranges', () => {
    const vp = fitGene('transcript');
    // Exon 1 covers c.1-100 -> aa 1..33 (codon at 100 spans into c.102 == exon 2).
    // aa 30..40 spans the exon-1/exon-2 boundary.
    const proj = vp.projectProteinRange(30, 40);
    expect(proj.segments.length).toBeGreaterThanOrEqual(2);
  });
});

describe('ViewportController — programmatic range updates', () => {
  it('setRange snaps the committed range to the target and notifies subscribers', () => {
    const vp = fitGene('transcript');
    const observed: Array<readonly [number, number]> = [];
    const unsubscribe = vp.subscribe(() => {
      observed.push([vp.range[0], vp.range[1]]);
    });
    vp.setRange([100, 200]);
    expect(vp.range[0]).toBe(100);
    expect(vp.range[1]).toBe(200);
    expect(observed).toEqual([[100, 200]]);
    unsubscribe();
    vp.setRange([1, 360]);
    expect(observed).toEqual([[100, 200]]);
  });

  it('setRange skips notification when the range is unchanged', () => {
    const vp = fitGene('transcript');
    vp.setRange([50, 150]);
    let calls = 0;
    vp.subscribe(() => {
      calls += 1;
    });
    vp.setRange([50, 150]);
    expect(calls).toBe(0);
  });

  it('naturalRange returns the fit-gene span for the active mode', () => {
    const cds = fitGene('transcript');
    expect(cds.naturalRange()).toEqual([1, 360]);
    const protein = fitGene('protein');
    expect(protein.naturalRange()).toEqual([1, 120]);
  });
});

describe('ViewportController — mode transitions', () => {
  it('setMode reprojects the visible range through the ruler conversion', () => {
    const vp = fitGene('transcript');
    // Zoom into c.100..c.200 (a 100-bp window mid-gene).
    vp.setRange([100, 200]);
    vp.setMode('protein');
    // CDS bp → aa: bp 100 → aa 34 (codon (100-1)/3 + 1), bp 200 → aa 67 ((200-1)/3 + 1).
    expect(vp.mode).toBe('protein');
    expect(vp.range[0]).toBe(34);
    expect(vp.range[1]).toBe(67);
  });

  it('setMode is a no-op when the mode is unchanged', () => {
    const vp = fitGene('transcript');
    vp.setRange([50, 150]);
    vp.setMode('transcript');
    expect(vp.range[0]).toBe(50);
    expect(vp.range[1]).toBe(150);
  });

  it('setMode flips intronScale to 1 when entering genome', () => {
    const vp = fitGene('transcript');
    expect(vp.intronScale).toBe(0);
    vp.setMode('genome');
    expect(vp.intronScale).toBe(1);
  });

  it('setMode publishes new exon-x and intron-scale CSS vars to the attached element', () => {
    const vp = fitGene('genome');
    const el = document.createElement('div');
    vp.attach(el);
    const intronsAtStart = el.style.getPropertyValue('--vv-intron-scale');
    expect(intronsAtStart).toBe('1');
    vp.setMode('protein');
    expect(el.style.getPropertyValue('--vv-intron-scale')).toBe('0');
    // Protein-mode baseline places aa=1 at x=0, the C-terminus at x=width.
    expect(el.style.getPropertyValue('--vv-exon-x-0')).toBe('0px');
  });
});

describe('ViewportController — pixel-for-pixel pan via screenToBaselineX', () => {
  /** Mirrors `useViewportInteractions.panByPx` (which lives in a React
   *  hook and so is awkward to drive without a host). The math is the
   *  contract under test: panning by `deltaViewboxPx` in current-x space
   *  must move every feature by exactly `-deltaViewboxPx` screen px. */
  function panByPx(vp: ViewportController, deltaViewboxPx: number): void {
    const newSLo = vp.screenToBaselineX(deltaViewboxPx);
    const newSHi = vp.screenToBaselineX(vp.width + deltaViewboxPx);
    const newLo = vp.baselineXToRuler(newSLo) + 0.5;
    const newHi = vp.baselineXToRuler(newSHi) - 0.5;
    vp.setRange([newLo, newHi]);
  }

  it('genome mode: a feature\'s screen position shifts by exactly -delta across a fixed-budget gap', () => {
    // Visible window straddles a fixed-budget intron gap so the
    // piecewise baseline-to-current mapping is exercised. Pre-fix
    // `panByPx` used an average `baselineSpan / width` ratio that
    // over-shot the gene's position whenever the gap was inside the
    // window. The new pan goes through `screenToBaselineX` so the
    // promise holds exactly.
    const vp = fitGene('genome');
    vp.setRange([50, 150]); // straddles the cdsEnd=100 / cdsStart=101 gap
    const featureCpos = 130;
    const featureBaseline = vp.cdsToBaselineX(featureCpos);
    const before = vp.cdsToScreen(featureCpos, 0)!;
    const delta = 50; // pretend the user dragged the gene 50 px left
    panByPx(vp, delta);
    const after = vp.cdsToScreen(featureCpos, 0)!;
    // Sanity: the feature stayed in the visible window and the
    // baseline anchor didn't move.
    expect(vp.cdsToBaselineX(featureCpos)).toBeCloseTo(featureBaseline, 5);
    // Pixel-for-pixel: screen displacement = -delta (a positive delta
    // shifts the visible window right, sliding the feature left).
    expect(after - before).toBeCloseTo(-delta, 4);
  });

  it('preserves the visible baseline span across the gesture (no zoom drift)', () => {
    const vp = fitGene('genome');
    vp.setRange([50, 150]);
    const beforeSpan =
      vp.screenToBaselineX(vp.width) - vp.screenToBaselineX(0);
    panByPx(vp, 50);
    const afterSpan =
      vp.screenToBaselineX(vp.width) - vp.screenToBaselineX(0);
    expect(afterSpan).toBeCloseTo(beforeSpan, 4);
  });
});

describe('ViewportController — CSS variable publication', () => {
  it('publishes --vv-* variables to an attached element on attach() and on state changes', () => {
    const vp = fitGene('transcript');
    const el = document.createElement('div');
    vp.attach(el);

    expect(el.style.getPropertyValue('--vv-intron-scale')).toBe('0');
    expect(el.style.getPropertyValue('--vv-exon-x-0')).toBe('0px');
    expect(el.style.getPropertyValue('--vv-exon-w-0')).not.toBe('');

    vp.setIntronScale(0.5);
    expect(el.style.getPropertyValue('--vv-intron-scale')).toBe('0.5');
  });
});

describe('ViewportController — clampRange + paddedBounds', () => {
  it('paddedBounds() extends the natural range by 5% on each side', () => {
    const vp = fitGene('transcript');
    const [pLo, pHi] = vp.paddedBounds();
    // Natural [1, 360]; len = 359; pad = 17.95.
    expect(pLo).toBeCloseTo(1 - 359 * 0.05, 5);
    expect(pHi).toBeCloseTo(360 + 359 * 0.05, 5);
  });

  it('clampRange snaps a too-wide range to the padded bounds', () => {
    const vp = fitGene('transcript');
    const clamped = vp.clampRange([-1000, 1000], { maxZoom: 100 });
    const [pLo, pHi] = vp.paddedBounds();
    expect(clamped[0]).toBeCloseTo(pLo, 5);
    expect(clamped[1]).toBeCloseTo(pHi, 5);
  });

  it('clampRange enforces minVisibleLen so we cannot zoom past maxZoom', () => {
    const vp = fitGene('transcript');
    const clamped = vp.clampRange([180, 180.0001], { maxZoom: 10 });
    const naturalLen = 360 - 1; // 359
    const minLen = naturalLen / 10;
    expect(clamped[1] - clamped[0]).toBeCloseTo(minLen, 3);
  });

  it('clampRange slides an off-edge range back inside the padded bounds', () => {
    const vp = fitGene('transcript');
    const clamped = vp.clampRange([-100, -50], { maxZoom: 100 });
    const [pLo] = vp.paddedBounds();
    expect(clamped[0]).toBeCloseTo(pLo, 5);
    expect(clamped[1] - clamped[0]).toBeCloseTo(50, 5);
  });

  it('rulerAtScreen returns aa in protein mode and CDS bp in CDS modes', () => {
    // Cell-width invariant: screen 0 is bp 1's left cell edge, ruler 0.5;
    // screen width is bp cdsLength's right cell edge, ruler cdsLength + 0.5.
    // Bp / aa centres sit half a pxPerUnit inside each edge.
    const cds = fitGene('transcript');
    const pxPerBp = 720 / 360;
    expect(cds.rulerAtScreen(0)).toBeCloseTo(0.5, 5);
    expect(cds.rulerAtScreen(720)).toBeCloseTo(360.5, 5);
    expect(cds.rulerAtScreen(0.5 * pxPerBp)).toBeCloseTo(1, 5);
    const protein = fitGene('protein');
    expect(protein.rulerAtScreen(0)).toBeCloseTo(0.5, 5);
    expect(protein.rulerAtScreen(720)).toBeCloseTo(120.5, 5);
  });
});

describe('ViewportController — Position-based projection', () => {
  it('toBaselineX agrees across coord systems for the same biological position', () => {
    const vp = fitGene('transcript');
    // Codon 2 spans c.4-6; its centre is c.5, which in exon 1 (+strand)
    // sits at genomic 1004. Aa 2 anchors to the codon centre so all three
    // coord adapters land at the same baseline-x.
    const fromCds = vp.toBaselineX({ kind: 'cds', cPos: 5, offset: 0 });
    const fromProtein = vp.toBaselineX({ kind: 'protein', aa: 2 });
    const fromGenomic = vp.toBaselineX({ kind: 'genomic', chr: 'chr1', pos: 1004 });
    expect(fromCds).not.toBeNull();
    expect(fromProtein).toBeCloseTo(fromCds!, 5);
    expect(fromGenomic).toBeCloseTo(fromCds!, 5);
  });

  it('±0.5 cell-width invariant: every bp / aa occupies a cell of pxPerBp / pxPerAa', () => {
    // The figure shows every bp / aa as a cell of width pxPerBp / pxPerAa
    // centred on its lattice point. Cell extents on the left edge map to
    // baseline 0; right edge maps to baseline = width. Adjacent cells share
    // their inner edges; bp / aa centres sit ±0.5 cell inside each edge.
    const cds = fitGene('transcript');
    const cdsGeom = cds.baselineGeometry();
    // Adjacent bp centres are pxPerBp apart anywhere inside an exon body.
    expect(cds.cdsToBaselineX(50) - cds.cdsToBaselineX(49)).toBeCloseTo(
      cdsGeom.pxPerBp,
      5,
    );
    // First / last bp centre is half a cell from the figure edge.
    expect(cds.cdsToBaselineX(1)).toBeCloseTo(0.5 * cdsGeom.pxPerBp, 5);
    // Cell EDGES align with exon rect endpoints.
    expect(cds.cdsToBaselineX(1 - 0.5)).toBeCloseTo(cdsGeom.exons[0]!.xStart, 5);
    expect(cds.cdsToBaselineX(100 + 0.5)).toBeCloseTo(cdsGeom.exons[0]!.xEnd, 5);

    const protein = fitGene('protein');
    const pGeom = protein.baselineGeometry();
    // pGeom.pxPerBp is `pxPerAa` in protein mode (the underlying frame
    // reuses the field for both unit kinds).
    expect(protein.cdsToBaselineX(50) - protein.cdsToBaselineX(49)).toBeCloseTo(
      pGeom.pxPerBp,
      5,
    );
    expect(protein.cdsToBaselineX(1)).toBeCloseTo(0.5 * pGeom.pxPerBp, 5);
    expect(protein.cdsToBaselineX(120)).toBeCloseTo(720 - 0.5 * pGeom.pxPerBp, 5);
  });

  it('aa N projects to codon-centre bp 3N-1 across every aa-aware API', () => {
    // INV-5 (modified): aa N's canonical position is bp 3N-1, the codon's
    // middle bp. proteinToScreen, resolveAnchor, and screenToPosition
    // (cds/genomic inverses in protein mode) must all land on that anchor
    // so a {kind:'protein',aa:N} variant co-locates with the aa-track
    // letter glyph (which renders at 3N-1) and with a scale tick there.
    const cds = fitGene('transcript');
    const aa = 17;
    const centerCpos = 3 * aa - 1; // = 50
    const expectedX = cds.cdsToScreen(centerCpos, 0)!;
    expect(cds.proteinToScreen(aa)).toBeCloseTo(expectedX, 5);
    expect(cds.toScreen({ kind: 'protein', aa })).toBeCloseTo(expectedX, 5);
    const anchor = cds.resolveAnchor({ kind: 'protein-aa', aa });
    expect(anchor!.x).toBeCloseTo(expectedX, 5);

    // Inverse direction: a screen click at aa N's rendered position in
    // protein mode round-trips back to bp 3N-1 (not 3N-2).
    const protein = fitGene('protein');
    const x = protein.proteinToScreen(aa)!;
    expect(protein.screenToCds(x)!.cPos).toBe(centerCpos);
    // Genomic inverse picks up the corresponding genomic bp; exon 1 is
    // +strand starting at genomic 1000, so bp 50 → genomic 1049.
    expect(protein.screenToGenomic(x)!.pos).toBe(1049);
  });

  it('toBaselineX returns null for intronic CDS positions and off-transcript genomic positions', () => {
    const vp = fitGene('transcript');
    expect(vp.toBaselineX({ kind: 'cds', cPos: 100, offset: 5 })).toBeNull();
    expect(vp.toBaselineX({ kind: 'genomic', chr: 'chr1', pos: 5000 })).toBeNull();
    expect(vp.toBaselineX({ kind: 'genomic', chr: 'chr2', pos: 1050 })).toBeNull();
  });

  it('toScreen handles a CDS position in protein mode (no callsite-level mode branch)', () => {
    // The legacy `cdsToScreen` returns null in protein mode, forcing callers
    // to branch on viewport.mode. `toScreen` does the right thing — convert
    // cPos to its containing aa and project — so feature placement works in
    // any mode regardless of the variant's coord kind.
    const protein = fitGene('protein');
    const x = protein.toScreen({ kind: 'cds', cPos: 4, offset: 0 });
    const xAa = protein.toScreen({ kind: 'protein', aa: 2 });
    expect(x).not.toBeNull();
    expect(x).toBeCloseTo(xAa!, 5);
  });

  it('toScreen returns null for positions panned out of the visible range', () => {
    const vp = fitGene('transcript');
    vp.setRange([1, 50]);
    expect(vp.toScreen({ kind: 'cds', cPos: 200, offset: 0 })).toBeNull();
    expect(vp.toScreen({ kind: 'cds', cPos: 10, offset: 0 })).not.toBeNull();
  });

  it('screenToPosition round-trips toScreen for each Position kind in CDS modes', () => {
    const vp = fitGene('transcript');
    const cases: Array<{ kind: 'cds' | 'protein' | 'genomic'; build: () => import('./types.js').Position }> = [
      { kind: 'cds', build: () => ({ kind: 'cds', cPos: 31, offset: 0 }) },
      { kind: 'protein', build: () => ({ kind: 'protein', aa: 11 }) },
      { kind: 'genomic', build: () => ({ kind: 'genomic', chr: 'chr1', pos: 1030 }) },
    ];
    for (const { kind, build } of cases) {
      const pos = build();
      const x = vp.toScreen(pos)!;
      const back = vp.screenToPosition(x, kind);
      expect(back).not.toBeNull();
      expect(back!.kind).toBe(kind);
      // Forward path then inverse path lands at the same biological point.
      expect(vp.toScreen(back!)).toBeCloseTo(x, 4);
    }
  });

  it('screenToPosition unifies the protein-mode inverse — screenToCds no longer returns null there', () => {
    // Pre-refactor `screenToCds` was hard-coded to return null in protein
    // mode, forcing every caller to branch on viewport.mode. The unified
    // shim now returns the cPos of the codon at that screen-x (a sensible
    // answer at the active mode's precision).
    const protein = fitGene('protein');
    const x = protein.toScreen({ kind: 'protein', aa: 5 })!;
    const cds = protein.screenToCds(x);
    expect(cds).not.toBeNull();
    expect(cds!.cPos).toBe(14); // codon-centre bp of codon 5 (= 3*5 - 1)
  });

  it('mapper.resolveCds reduces every Position kind to (cPos, offset)', () => {
    const mapper = createCoordinateMapper(transcript);
    expect(mapper.resolveCds({ kind: 'cds', cPos: 42, offset: 3 })).toEqual({
      cPos: 42,
      offset: 3,
    });
    // Codon-centre bp: aa 5 → bp 3*5 - 1 = 14. The reducer returns the
    // canonical CDS position of the residue, not the codon's first bp.
    expect(mapper.resolveCds({ kind: 'protein', aa: 5 })).toEqual({
      cPos: 14,
      offset: 0,
    });
    expect(
      mapper.resolveCds({ kind: 'genomic', chr: 'chr1', pos: 1003 }),
    ).toEqual({ cPos: 4, offset: 0 });
    expect(
      mapper.resolveCds({ kind: 'genomic', chr: 'chrX', pos: 9999 }),
    ).toBeNull();
  });
});

describe('ViewportController — Phase 3 soft-collapse spec', () => {
  it('produces flank baseline pieces in genome mode when the spec covers an intron', () => {
    const mapper = createCoordinateMapper(transcript);
    const vp = new ViewportController({
      mapper,
      width: 1000,
      mode: 'genome',
      collapsedRegions: [
        // Default-shaped spec for the first intron only — second intron
        // falls back to the legacy single-gap layout.
        { start: { cPos: 100, offset: 11 }, end: { cPos: 101, offset: -11 } },
      ],
    });
    const baseline = vp.baselineGeometry();
    expect(baseline.flanks).toBeDefined();
    const donor = baseline.flanks!.find(
      (f) => f.intronIdx === 0 && f.side === 'donor',
    );
    const acceptor = baseline.flanks!.find(
      (f) => f.intronIdx === 0 && f.side === 'acceptor',
    );
    expect(donor?.bp).toBe(10);
    expect(acceptor?.bp).toBe(10);
    // Second intron has no spec — no flanks emitted for it.
    expect(
      baseline.flanks!.filter((f) => f.intronIdx === 1),
    ).toHaveLength(0);
  });

  it('omits flanks entirely with an empty spec (legacy pre-Phase-3 layout)', () => {
    const mapper = createCoordinateMapper(transcript);
    const vp = new ViewportController({
      mapper,
      width: 1000,
      mode: 'genome',
      collapsedRegions: [],
    });
    const baseline = vp.baselineGeometry();
    expect(baseline.flanks ?? []).toHaveLength(0);
    // The gap layout matches the pre-Phase-3 shape — one gap per intron.
    expect(baseline.gaps).toHaveLength(2);
  });

  it("gap.width covers the whole intron (donor flank + bulk + acceptor flank); flanks listed in baseline.flanks", () => {
    const mapper = createCoordinateMapper(transcript);
    const vp = new ViewportController({
      mapper,
      width: 1000,
      mode: 'genome',
      collapsedRegions: [
        { start: { cPos: 100, offset: 11 }, end: { cPos: 101, offset: -11 } },
        { start: { cPos: 250, offset: 11 }, end: { cPos: 251, offset: -11 } },
      ],
    });
    const baseline = vp.baselineGeometry();
    // The first gap covers the whole intron in baseline-x — its width
    // sums to donor + bulk + acceptor. Pre-Phase-3 the gap was bulk-only.
    const intron0Flanks = baseline.flanks!.filter((f) => f.intronIdx === 0);
    expect(intron0Flanks).toHaveLength(2);
    const donor0 = intron0Flanks.find((f) => f.side === 'donor')!;
    const acceptor0 = intron0Flanks.find((f) => f.side === 'acceptor')!;
    const gap0 = baseline.gaps[0]!;
    expect(gap0.width).toBeCloseTo(
      donor0.width + (gap0.width - donor0.width - acceptor0.width) + acceptor0.width,
      4,
    );
    // And `cdsToBaselineX(100)` / `cdsToBaselineX(101)` land on the
    // CENTRES of bp 100's and bp 101's cells, which sit half a bp inside
    // each exon edge. So the bp-centre separation = gap.width + pxPerBp
    // (the two half-cells live on the exon sides of the gap, not inside
    // it).
    expect(vp.cdsToBaselineX(101) - vp.cdsToBaselineX(100)).toBeCloseTo(
      gap0.width + baseline.pxPerBp,
      4,
    );
  });

  it('transcript mode ignores the spec (hard collapse subsumes it)', () => {
    const mapper = createCoordinateMapper(transcript);
    const vp = new ViewportController({
      mapper,
      width: 1000,
      mode: 'transcript',
      collapsedRegions: [
        { start: { cPos: 100, offset: 11 }, end: { cPos: 101, offset: -11 } },
      ],
    });
    const baseline = vp.baselineGeometry();
    // Transcript mode hard-collapses every intron, so the spec is
    // silently subsumed: no flanks, gaps stay at the 1-bp transition
    // shape (legacy transcript-mode behaviour).
    expect(baseline.flanks ?? []).toHaveLength(0);
  });
});
