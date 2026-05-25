import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { createCoordinateMapper } from '../coordinate-mapper.js';
import { createSvgPainter } from '../painter/svg-painter.js';
import { ViewportController } from '../viewport.js';
import type { InteractionState, Transcript } from '../types.js';
import type { ClinVarRecord } from './clinvar-track.js';
import { clinVarSummaryTrack } from './clinvar-summary-track.js';

const transcript: Transcript = {
  geneSymbol: 'TEST',
  transcriptId: 'NM_TEST.1',
  cdsLength: 300,
  strand: '+',
  exons: [
    { number: 1, cdsStart: 1, cdsEnd: 100, genomicStart: 1000, genomicEnd: 1099, chr: 'chr1' },
    { number: 2, cdsStart: 101, cdsEnd: 200, genomicStart: 2000, genomicEnd: 2099, chr: 'chr1' },
    { number: 3, cdsStart: 201, cdsEnd: 300, genomicStart: 3000, genomicEnd: 3099, chr: 'chr1' },
  ],
};

function makeRecord(id: string, pos: number, significance: ClinVarRecord['significance']): ClinVarRecord {
  return {
    id,
    label: id,
    chr: 'chr1',
    pos,
    significance,
  };
}

// Mix of significances clustered near the start of exon 1 and exon 2 so the
// summary's density-binning has something to encode.
const records: ClinVarRecord[] = [
  makeRecord('r1', 1010, 'pathogenic'),
  makeRecord('r2', 1011, 'likely_pathogenic'),
  makeRecord('r3', 1012, 'uncertain_significance'),
  makeRecord('r4', 2010, 'benign'),
  makeRecord('r5', 2011, 'conflicting'),
];

function emptyInteraction(): InteractionState {
  return { hoveredFeatureId: null, selectedFeatureIds: new Set(), brushRange: null };
}

describe('clinVarSummaryTrack', () => {
  it('declares fixed height with an 18 px default', () => {
    const track = clinVarSummaryTrack({ source: records });
    const viewport = new ViewportController({
      mapper: createCoordinateMapper(transcript),
      width: 720,
      mode: 'transcript',
    });
    const result = track.height({ data: { records }, viewport, hint: { maxPx: 100 } });
    expect(track.heightPolicy).toBe('fixed');
    expect(result.px).toBe(18);
  });

  it('emits one heat-strip cell per occupied screen-pixel bin', () => {
    const mapper = createCoordinateMapper(transcript);
    const viewport = new ViewportController({ mapper, width: 720, mode: 'transcript' });
    const painter = createSvgPainter({ mode: 'screen' });
    const track = clinVarSummaryTrack({ source: records, binPx: 4 });
    const node = track.render({
      data: { records },
      rect: { yTop: 0, yBottom: 18 },
      viewport,
      mapper,
      interaction: emptyInteraction(),
      painter,
    });
    const { container } = render(
      <svg viewBox="0 0 720 18" width={720} height={18}>
        {node}
      </svg>,
    );
    const cells = container.querySelectorAll('.vv-clinvar-summary-cell');
    expect(cells.length).toBeGreaterThan(0);
    // Cells carry their bin count + dominant significance.
    const sigs = new Set(
      [...cells].map((c) => c.getAttribute('data-vv-significance')),
    );
    // At fit-gene the exon-1 cluster collapses into one bin and its
    // pathogenic record dominates over the LP / VUS members.
    expect(sigs).toContain('pathogenic');
  });

  it('respects the host filter predicate', () => {
    const mapper = createCoordinateMapper(transcript);
    const viewport = new ViewportController({ mapper, width: 720, mode: 'transcript' });
    const painter = createSvgPainter({ mode: 'screen' });
    const track = clinVarSummaryTrack({
      source: records,
      filter: (r) => r.significance !== 'pathogenic' && r.significance !== 'likely_pathogenic',
    });
    const node = track.render({
      data: { records },
      rect: { yTop: 0, yBottom: 18 },
      viewport,
      mapper,
      interaction: emptyInteraction(),
      painter,
    });
    const { container } = render(
      <svg viewBox="0 0 720 18" width={720} height={18}>
        {node}
      </svg>,
    );
    const sigs = new Set(
      [...container.querySelectorAll('.vv-clinvar-summary-cell')].map((c) =>
        c.getAttribute('data-vv-significance'),
      ),
    );
    expect(sigs.has('pathogenic')).toBe(false);
    expect(sigs.has('likely_pathogenic')).toBe(false);
  });

  it('emits butterfly ribbons: pathogenic above centerline, benign below, VUS as neutral strip', () => {
    const mixed: ClinVarRecord[] = [
      makeRecord('p1', 1010, 'pathogenic'),
      makeRecord('v1', 1011, 'uncertain_significance'),
      makeRecord('b1', 2010, 'benign'),
    ];
    const mapper = createCoordinateMapper(transcript);
    const viewport = new ViewportController({ mapper, width: 720, mode: 'transcript' });
    const painter = createSvgPainter({ mode: 'screen' });
    const track = clinVarSummaryTrack({ source: mixed });
    const yTop = 0;
    const yBottom = 18;
    const yCenter = (yTop + yBottom) / 2;
    const node = track.render({
      data: { records: mixed },
      rect: { yTop, yBottom },
      viewport,
      mapper,
      interaction: emptyInteraction(),
      painter,
    });
    const { container } = render(
      <svg viewBox="0 0 720 18" width={720} height={18}>
        {node}
      </svg>,
    );

    // Directional cells: pathogenic and benign — no VUS/conflicting in this set.
    const cells = container.querySelectorAll('.vv-clinvar-summary-cell');
    const sigs = new Set(
      [...cells].map((c) => c.getAttribute('data-vv-significance')),
    );
    expect(sigs).toEqual(new Set(['pathogenic', 'benign']));

    // Neutral strip element exists for the VUS record.
    expect(container.querySelector('.vv-clinvar-summary-neutral')).not.toBeNull();

    // Pathogenic ribbon's peak (smallest y on its top spline) sits above the
    // centerline; benign ribbon's peak (largest y) sits below.
    const pathCell = container.querySelector('[data-vv-significance="pathogenic"]')!;
    const benCell = container.querySelector('[data-vv-significance="benign"]')!;
    const minY = (path: SVGPathElement): number => {
      const d = path.getAttribute('d') ?? '';
      const ys = [...d.matchAll(/[-\d.]+\s+([-\d.]+)/g)].map((m) => Number(m[1]));
      return Math.min(...ys);
    };
    const maxY = (path: SVGPathElement): number => {
      const d = path.getAttribute('d') ?? '';
      const ys = [...d.matchAll(/[-\d.]+\s+([-\d.]+)/g)].map((m) => Number(m[1]));
      return Math.max(...ys);
    };
    const pathTop = pathCell.querySelector('path:last-child') as SVGPathElement;
    const benBottom = benCell.querySelector('path:last-child') as SVGPathElement;
    expect(minY(pathTop)).toBeLessThan(yCenter);
    expect(maxY(benBottom)).toBeGreaterThan(yCenter);
  });
});
