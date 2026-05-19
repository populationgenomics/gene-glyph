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

function fitGene(mode: 'cds-spliced' | 'cds-with-introns' | 'protein' = 'cds-spliced') {
  const mapper = createCoordinateMapper(transcript);
  return new ViewportController({ mapper, width: 720, mode });
}

describe('ViewportController — screen <-> CDS at fit-gene zoom', () => {
  it('cdsToScreen and screenToCds round-trip on the cds-spliced ruler', () => {
    const vp = fitGene('cds-spliced');
    const samples = [1, 50, 100, 101, 200, 250, 359, 360];
    for (const cPos of samples) {
      const x = vp.cdsToScreen(cPos, 0);
      expect(x).not.toBeNull();
      const back = vp.screenToCds(x!);
      expect(back).toEqual({ cPos, offset: 0 });
    }
  });

  it('cdsToScreen places the start of the gene at x=0 and the end at x=width', () => {
    const vp = fitGene('cds-spliced');
    expect(vp.cdsToScreen(1, 0)).toBe(0);
    expect(vp.cdsToScreen(360, 0)).toBe(720);
  });

  it('returns null for CDS positions outside the active range', () => {
    const vp = fitGene('cds-spliced');
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

  it('protein mode places aa=1 at x=0 and the C-terminus at x=width', () => {
    const vp = fitGene('protein');
    expect(vp.proteinToScreen(1)).toBe(0);
    expect(vp.proteinToScreen(120)).toBe(720);
  });
});

describe('ViewportController — range projection', () => {
  it('returns a single segment for a range entirely within one exon (spliced)', () => {
    const vp = fitGene('cds-spliced');
    const proj = vp.projectCdsRange(20, 60);
    expect(proj.segments).toHaveLength(1);
    expect(proj.segments[0]!.exonIdx).toBe(0);
    expect(proj.droppedIntronicCount).toBe(0);
    expect(proj.droppedExonicCount).toBe(0);
  });

  it('fragments at exon boundaries when a CDS range spans multiple exons (spliced)', () => {
    const vp = fitGene('cds-spliced');
    const proj = vp.projectCdsRange(50, 300);
    expect(proj.segments.map((s) => s.exonIdx)).toEqual([0, 1, 2]);
    expect(proj.segments[0]!.xEnd).toBeCloseTo(vp.cdsToScreen(100, 0)!);
    expect(proj.segments[1]!.xStart).toBeCloseTo(vp.cdsToScreen(101, 0)!);
    // Slice 15: cross-exon CDS ranges report one intronic drop per crossed gap
    // so tracks aggregating hidden-feature counts can index uniformly across
    // coord systems.
    expect(proj.droppedIntronicCount).toBe(2);
    expect(proj.droppedRanges).toEqual([
      { kind: 'intronic', exonIdxA: 0, exonIdxB: 1 },
      { kind: 'intronic', exonIdxA: 1, exonIdxB: 2 },
    ]);
  });

  it('fragments at exon boundaries in cds-with-introns mode too (per-exon segments)', () => {
    // Pfam / IPR domains need per-exon rectangles + a linker drawn over the
    // dashed-gap polyline; a single segment that spans the gap would draw a
    // solid bar across the collapsed intron and defeat the visual.
    const vp = fitGene('cds-with-introns');
    const proj = vp.projectCdsRange(50, 300);
    expect(proj.segments.map((s) => s.exonIdx)).toEqual([0, 1, 2]);
    // Adjacent segments meet at the exon boundary in screen-x, since
    // cdsToScreen places exon i's cdsEnd and exon i+1's cdsStart at the same
    // point only when intronScale=0; here (intronScale=1) the segments sit
    // either side of the collapsed-intron gap.
    expect(proj.segments[0]!.xEnd).toBeLessThan(proj.segments[1]!.xStart);
  });

  it('projectGenomicRange across an intron drops the intronic gap and yields one segment per exon', () => {
    const vp = fitGene('cds-spliced');
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
    const vp = fitGene('cds-spliced');
    const proj = vp.projectProteinRange(30, 40);
    expect(proj.droppedIntronicCount).toBeGreaterThanOrEqual(1);
    expect(proj.droppedRanges[0]).toMatchObject({
      kind: 'intronic',
      exonIdxA: 0,
      exonIdxB: 1,
    });
  });

  it('projectGenomicRange returns no segments for a range fully outside any exon', () => {
    const vp = fitGene('cds-spliced');
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
    // The transcript's exons are c.1-100, c.101-250, c.251-360 → aa 1..34,
    // aa 34..84, aa 84..120 (codons span both boundaries). aa 1..42 fragments
    // into exon 0 (aa 1..34) and exon 1 (aa 34..42).
    const vp = fitGene('protein');
    const proj = vp.projectProteinRange(1, 42);
    expect(proj.segments.length).toBeGreaterThanOrEqual(2);
    const last = proj.segments[proj.segments.length - 1]!;
    expect(last.xEnd).toBeCloseTo(vp.cdsToBaselineX(42), 5);
    // And the last segment's xEnd must be well below where aa 126 would land,
    // which is the symptom of the old bug.
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
    const vp = fitGene('cds-spliced');
    // Exon 1 covers c.1-100 -> aa 1..33 (codon at 100 spans into c.102 == exon 2).
    // aa 30..40 spans the exon-1/exon-2 boundary.
    const proj = vp.projectProteinRange(30, 40);
    expect(proj.segments.length).toBeGreaterThanOrEqual(2);
  });
});

describe('ViewportController — programmatic range updates', () => {
  it('setRange snaps the committed range to the target and notifies subscribers', () => {
    const vp = fitGene('cds-spliced');
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
    const vp = fitGene('cds-spliced');
    vp.setRange([50, 150]);
    let calls = 0;
    vp.subscribe(() => {
      calls += 1;
    });
    vp.setRange([50, 150]);
    expect(calls).toBe(0);
  });

  it('naturalRange returns the fit-gene span for the active mode', () => {
    const cds = fitGene('cds-spliced');
    expect(cds.naturalRange()).toEqual([1, 360]);
    const protein = fitGene('protein');
    expect(protein.naturalRange()).toEqual([1, 120]);
  });
});

describe('ViewportController — mode transitions', () => {
  it('setMode reprojects the visible range through the ruler conversion', () => {
    const vp = fitGene('cds-spliced');
    // Zoom into c.100..c.200 (a 100-bp window mid-gene).
    vp.setRange([100, 200]);
    vp.setMode('protein');
    // CDS bp → aa: bp 100 → aa 34 (codon (100-1)/3 + 1), bp 200 → aa 67 ((200-1)/3 + 1).
    expect(vp.mode).toBe('protein');
    expect(vp.range[0]).toBe(34);
    expect(vp.range[1]).toBe(67);
  });

  it('setMode is a no-op when the mode is unchanged', () => {
    const vp = fitGene('cds-spliced');
    vp.setRange([50, 150]);
    vp.setMode('cds-spliced');
    expect(vp.range[0]).toBe(50);
    expect(vp.range[1]).toBe(150);
  });

  it('setMode flips intronScale to 1 when entering cds-with-introns', () => {
    const vp = fitGene('cds-spliced');
    expect(vp.intronScale).toBe(0);
    vp.setMode('cds-with-introns');
    expect(vp.intronScale).toBe(1);
  });

  it('setMode publishes new exon-x and intron-scale CSS vars to the attached element', () => {
    const vp = fitGene('cds-with-introns');
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

describe('ViewportController — CSS variable publication', () => {
  it('publishes --vv-* variables to an attached element on attach() and on state changes', () => {
    const vp = fitGene('cds-spliced');
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
    const vp = fitGene('cds-spliced');
    const [pLo, pHi] = vp.paddedBounds();
    // Natural [1, 360]; len = 359; pad = 17.95.
    expect(pLo).toBeCloseTo(1 - 359 * 0.05, 5);
    expect(pHi).toBeCloseTo(360 + 359 * 0.05, 5);
  });

  it('clampRange snaps a too-wide range to the padded bounds', () => {
    const vp = fitGene('cds-spliced');
    const clamped = vp.clampRange([-1000, 1000], { maxZoom: 100 });
    const [pLo, pHi] = vp.paddedBounds();
    expect(clamped[0]).toBeCloseTo(pLo, 5);
    expect(clamped[1]).toBeCloseTo(pHi, 5);
  });

  it('clampRange enforces minVisibleLen so we cannot zoom past maxZoom', () => {
    const vp = fitGene('cds-spliced');
    const clamped = vp.clampRange([180, 180.0001], { maxZoom: 10 });
    const naturalLen = 360 - 1; // 359
    const minLen = naturalLen / 10;
    expect(clamped[1] - clamped[0]).toBeCloseTo(minLen, 3);
  });

  it('clampRange slides an off-edge range back inside the padded bounds', () => {
    const vp = fitGene('cds-spliced');
    const clamped = vp.clampRange([-100, -50], { maxZoom: 100 });
    const [pLo] = vp.paddedBounds();
    expect(clamped[0]).toBeCloseTo(pLo, 5);
    expect(clamped[1] - clamped[0]).toBeCloseTo(50, 5);
  });

  it('rulerAtScreen returns aa in protein mode and CDS bp in CDS modes', () => {
    const cds = fitGene('cds-spliced');
    expect(cds.rulerAtScreen(0)).toBeCloseTo(1, 5);
    expect(cds.rulerAtScreen(720)).toBeCloseTo(360, 5);
    const protein = fitGene('protein');
    expect(protein.rulerAtScreen(0)).toBeCloseTo(1, 5);
    expect(protein.rulerAtScreen(720)).toBeCloseTo(120, 5);
  });
});

describe('ViewportController — Position-based projection', () => {
  it('toBaselineX agrees across coord systems for the same biological position', () => {
    const vp = fitGene('cds-spliced');
    // cPos 4 = aa 2 (first base of codon 2) = genomic 1003 (exon 1, strand +).
    const fromCds = vp.toBaselineX({ kind: 'cds', cPos: 4, offset: 0 });
    const fromProtein = vp.toBaselineX({ kind: 'protein', aa: 2 });
    const fromGenomic = vp.toBaselineX({ kind: 'genomic', chr: 'chr1', pos: 1003 });
    expect(fromCds).not.toBeNull();
    expect(fromProtein).toBeCloseTo(fromCds!, 5);
    expect(fromGenomic).toBeCloseTo(fromCds!, 5);
  });

  it('toBaselineX returns null for intronic CDS positions and off-transcript genomic positions', () => {
    const vp = fitGene('cds-spliced');
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
    const vp = fitGene('cds-spliced');
    vp.setRange([1, 50]);
    expect(vp.toScreen({ kind: 'cds', cPos: 200, offset: 0 })).toBeNull();
    expect(vp.toScreen({ kind: 'cds', cPos: 10, offset: 0 })).not.toBeNull();
  });

  it('mapper.resolveCds reduces every Position kind to (cPos, offset)', () => {
    const mapper = createCoordinateMapper(transcript);
    expect(mapper.resolveCds({ kind: 'cds', cPos: 42, offset: 3 })).toEqual({
      cPos: 42,
      offset: 3,
    });
    expect(mapper.resolveCds({ kind: 'protein', aa: 5 })).toEqual({
      cPos: 13,
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
