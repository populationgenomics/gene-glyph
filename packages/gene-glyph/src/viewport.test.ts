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
    expect(proj.droppedRanges[0]).toMatchObject({ kind: 'intronic' });
  });

  it('projectGenomicRange returns no segments for a range fully outside any exon', () => {
    const vp = fitGene('cds-spliced');
    const proj = vp.projectGenomicRange('chr1', 1200, 1800);
    expect(proj.segments).toHaveLength(0);
    expect(proj.droppedExonicCount).toBe(1);
  });

  it('projectProteinRange fragments at exon boundaries for cross-exon protein ranges', () => {
    const vp = fitGene('cds-spliced');
    // Exon 1 covers c.1-100 -> aa 1..33 (codon at 100 spans into c.102 == exon 2).
    // aa 30..40 spans the exon-1/exon-2 boundary.
    const proj = vp.projectProteinRange(30, 40);
    expect(proj.segments.length).toBeGreaterThanOrEqual(2);
  });
});

describe('ViewportController — programmatic transitions', () => {
  it('transitionTo snaps the committed range to the target and reports interpolated values until the duration elapses', () => {
    const vp = fitGene('cds-spliced');
    const startRange: readonly [number, number] = [...vp.range] as readonly [number, number];
    const target: readonly [number, number] = [100, 200];

    const t0 = performance.now();
    vp.transitionTo({ range: target }, { duration: 200 });

    // Committed range jumps to target so CSS variables publish target values;
    // CSS transitions handle the visual interpolation.
    expect(vp.range[0]).toBe(target[0]);
    expect(vp.range[1]).toBe(target[1]);
    expect(vp.isTransitioning()).toBe(true);

    // Interpolated range sits between the from and to range while in flight.
    const mid = vp.getInterpolatedRange();
    expect(mid[0]).toBeGreaterThan(Math.min(startRange[0], target[0]) - 0.001);
    expect(mid[0]).toBeLessThan(target[0] + 0.001);

    // After the duration elapses, getInterpolatedRange returns the committed
    // range and isTransitioning flips false.
    const elapsed = performance.now() - t0;
    const wait = Math.max(0, 250 - elapsed);
    // Spin until the duration has passed without using async sleep.
    const until = performance.now() + wait;
    while (performance.now() < until) {
      /* spin */
    }
    expect(vp.getInterpolatedRange()).toEqual(target);
    expect(vp.isTransitioning()).toBe(false);
  });

  it('setRange clears any in-flight transition', () => {
    const vp = fitGene('cds-spliced');
    vp.transitionTo({ range: [50, 150] }, { duration: 500 });
    expect(vp.isTransitioning()).toBe(true);
    vp.setRange([200, 300]);
    expect(vp.isTransitioning()).toBe(false);
    expect(vp.getInterpolatedRange()).toEqual([200, 300]);
  });

  it('naturalRange returns the fit-gene span for the active mode', () => {
    const cds = fitGene('cds-spliced');
    expect(cds.naturalRange()).toEqual([1, 360]);
    const protein = fitGene('protein');
    expect(protein.naturalRange()).toEqual([1, 120]);
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
