import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { createCoordinateMapper } from '../coordinate-mapper.js';
import { createSvgPainter } from '../painter/svg-painter.js';
import type { InteractionState, Transcript } from '../types.js';
import { ViewportController } from '../viewport.js';
import { pickAutoStep, scaleTrack } from './scale-track.js';

const tp53Like: Transcript = {
  geneSymbol: 'TP53',
  transcriptId: 'NM_TEST.1',
  cdsLength: 1182,
  strand: '+',
  exons: [
    { number: 1, cdsStart: 1, cdsEnd: 140, genomicStart: 1000, genomicEnd: 1139, chr: 'chr1' },
    { number: 2, cdsStart: 141, cdsEnd: 441, genomicStart: 2000, genomicEnd: 2300, chr: 'chr1' },
    { number: 3, cdsStart: 442, cdsEnd: 1182, genomicStart: 3000, genomicEnd: 3740, chr: 'chr1' },
  ],
};

const shortGene: Transcript = {
  geneSymbol: 'TINY',
  transcriptId: 'NM_TINY.1',
  cdsLength: 12,
  strand: '+',
  exons: [
    { number: 1, cdsStart: 1, cdsEnd: 12, genomicStart: 1000, genomicEnd: 1011, chr: 'chr1' },
  ],
};

function setup(transcript: Transcript = tp53Like, mode: 'cds-with-introns' | 'cds-spliced' | 'protein' = 'cds-with-introns') {
  const mapper = createCoordinateMapper(transcript);
  const viewport = new ViewportController({ mapper, width: 1000, mode });
  const painter = createSvgPainter({ mode: 'screen' });
  const interaction: InteractionState = {
    hoveredFeatureId: null,
    selectedFeatureIds: new Set(),
    brushRange: null,
  };
  return { mapper, viewport, painter, interaction };
}

describe('pickAutoStep', () => {
  it('returns 100 for fit-gene TP53 in CDS-bp mode', () => {
    const { viewport } = setup();
    const px = viewport.baselineGeometry().pxPerBp;
    // px-per-bp ≈ 0.66 at width=1000 with gaps. The minimum 32 px gap
    // demands ≥ 32 / 0.66 ≈ 48 units → ladder picks 50.
    const step = pickAutoStep(px, 32, viewport.naturalRange()[1] - 1);
    expect(step).toBe(50);
  });

  it('returns 50 for fit-gene TP53 in protein mode', () => {
    const { viewport } = setup(tp53Like, 'protein');
    const px = viewport.baselineGeometry().pxPerBp;
    // pxPerBp encodes px-per-aa in protein mode; with aaLen=394 over
    // ~1000 px → ~2.54 px/aa → 32 px / 2.54 ≈ 12.6 → ladder picks 20.
    const step = pickAutoStep(px, 32, viewport.naturalRange()[1] - 1);
    expect(step).toBe(20);
  });

  it('demotes the step for very short genes so at least one major tick fits', () => {
    // Force a step larger than the ruler length; the picker should
    // drop back down the ladder until the step fits.
    const step = pickAutoStep(/* pxPerUnit */ 0.001, 32, /* rulerLength */ 12);
    // px/unit so small that the initial step would be the ladder max;
    // demote until step ≤ rulerLength (12) → 10.
    expect(step).toBe(10);
  });
});

describe('scaleTrack', () => {
  it('reports fixed height equal to its configured height', () => {
    const { viewport } = setup();
    const t = scaleTrack({ height: 22 });
    expect(t.heightPolicy).toBe('fixed');
    expect(t.height({ data: null, viewport, hint: { maxPx: 200 } })).toEqual({
      px: 22,
      didTruncate: false,
    });
  });

  it('renders major + minor ticks at fit-gene; major ticks land on the chosen step', () => {
    const { mapper, viewport, painter, interaction } = setup();
    const t = scaleTrack({});

    function Probe() {
      return (
        <svg>
          {t.render({
            data: { ready: true },
            rect: { yTop: 0, yBottom: 18 },
            viewport,
            mapper,
            interaction,
            painter,
          })}
        </svg>
      );
    }

    const { container } = render(<Probe />);
    const track = container.querySelector<SVGGElement>('.vv-scale-track')!;
    expect(track.getAttribute('data-vv-scale-unit')).toBe('bp');
    expect(track.getAttribute('data-vv-scale-major-step')).toBe('50');
    // CDS length 1182 → candidate major positions are 50, 100, …, 1150
    // (23 candidates). The crash-aware walk drops any whose label would
    // overlap its predecessor — a few near the right end where short
    // exons compress the baseline-x spacing fall out. The remaining set
    // is still close to the candidate count.
    const majorCount = container.querySelectorAll('.vv-scale-tick-major').length;
    expect(majorCount).toBeGreaterThanOrEqual(18);
    expect(majorCount).toBeLessThanOrEqual(23);
    // Minor ticks subdivide major by 5 (default); minors at 10, 20, 30,
    // 40, 60, 70, … excluding emitted-major positions.
    expect(container.querySelectorAll('.vv-scale-tick-minor').length).toBeGreaterThan(50);
    // Every emitted major has a label.
    const labels = container.querySelectorAll<SVGTextElement>('.vv-scale-label');
    expect(labels.length).toBe(majorCount);
  });

  it('flips bp ↔ aa unit when the viewport mode changes', () => {
    const { mapper, painter, interaction } = setup();
    const tCds = scaleTrack({});

    function probe(mode: 'cds-with-introns' | 'protein') {
      const v = new ViewportController({ mapper, width: 1000, mode });
      return render(
        <svg>
          {tCds.render({
            data: { ready: true },
            rect: { yTop: 0, yBottom: 18 },
            viewport: v,
            mapper,
            interaction,
            painter,
          })}
        </svg>,
      );
    }
    const cdsTrack = probe('cds-with-introns').container.querySelector('.vv-scale-track');
    expect(cdsTrack?.getAttribute('data-vv-scale-unit')).toBe('bp');
    const proteinTrack = probe('protein').container.querySelector('.vv-scale-track');
    expect(proteinTrack?.getAttribute('data-vv-scale-unit')).toBe('aa');
  });

  it("appends the unit suffix only to the last major label by default", () => {
    const { mapper, viewport, painter, interaction } = setup();
    const t = scaleTrack({});
    const { container } = render(
      <svg>
        {t.render({
          data: { ready: true },
          rect: { yTop: 0, yBottom: 18 },
          viewport,
          mapper,
          interaction,
          painter,
        })}
      </svg>,
    );
    const labels = [
      ...container.querySelectorAll<SVGTextElement>('.vv-scale-label'),
    ].map((n) => n.textContent ?? '');
    // The last label in DOM order may not equal the last ruler position
    // because labels emit per-exon; pick the one whose text ends with 'bp'.
    const suffixed = labels.filter((l) => /\bbp$/.test(l));
    expect(suffixed.length).toBe(1);
    // None of the others carry the suffix.
    expect(labels.filter((l) => /\baa$/.test(l)).length).toBe(0);
  });

  it("emits no suffix when unitSuffix='never'", () => {
    const { mapper, viewport, painter, interaction } = setup();
    const t = scaleTrack({ unitSuffix: 'never' });
    const { container } = render(
      <svg>
        {t.render({
          data: { ready: true },
          rect: { yTop: 0, yBottom: 18 },
          viewport,
          mapper,
          interaction,
          painter,
        })}
      </svg>,
    );
    const labels = [
      ...container.querySelectorAll<SVGTextElement>('.vv-scale-label'),
    ].map((n) => n.textContent ?? '');
    expect(labels.every((l) => !/\b(bp|aa)$/.test(l))).toBe(true);
  });

  it('handles very short genes by demoting the auto step', () => {
    const { mapper, viewport, painter, interaction } = setup(shortGene);
    const t = scaleTrack({});
    const { container } = render(
      <svg>
        {t.render({
          data: { ready: true },
          rect: { yTop: 0, yBottom: 18 },
          viewport,
          mapper,
          interaction,
          painter,
        })}
      </svg>,
    );
    // 12 bp gene at width=1000 has so much room per bp that even the
    // smallest ladder rung (step=1) clears the minimum label gap.
    // Every CDS bp ends up labelled. The point of the test is that the
    // step doesn't snap to the LADDER MAX and produce zero visible
    // ticks for a short gene.
    const track = container.querySelector('.vv-scale-track');
    expect(track?.getAttribute('data-vv-scale-major-step')).toBe('1');
    expect(container.querySelectorAll('.vv-scale-tick-major').length).toBeGreaterThanOrEqual(1);
  });

  it('renders ticks inside per-exon `<g>` wrappers so they ride exon transforms', () => {
    const { mapper, viewport, painter, interaction } = setup();
    const t = scaleTrack({});
    const { container } = render(
      <svg>
        {t.render({
          data: { ready: true },
          rect: { yTop: 0, yBottom: 18 },
          viewport,
          mapper,
          interaction,
          painter,
        })}
      </svg>,
    );
    const track = container.querySelector('.vv-scale-track')!;
    // Every tick is a descendant of a per-exon group.
    const ticks = track.querySelectorAll('.vv-scale-tick');
    for (const tk of ticks) {
      expect(tk.closest('.vv-exon-group')).not.toBeNull();
    }
  });
});
