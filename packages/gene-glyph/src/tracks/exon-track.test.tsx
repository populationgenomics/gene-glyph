import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { createCoordinateMapper } from '../coordinate-mapper.js';
import { createSvgPainter } from '../painter/svg-painter.js';
import type { InteractionState, Transcript } from '../types.js';
import { ViewportController } from '../viewport.js';
import { exonTrack } from './exon-track.js';

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

function setup() {
  const mapper = createCoordinateMapper(transcript);
  const viewport = new ViewportController({ mapper, width: 720, mode: 'cds-with-introns' });
  const painter = createSvgPainter({ mode: 'screen' });
  const interaction: InteractionState = {
    hoveredFeatureId: null,
    selectedFeatureIds: new Set(),
    brushRange: null,
  };
  return { mapper, viewport, painter, interaction };
}

describe('exonTrack', () => {
  it('reports fixed height regardless of data', () => {
    const t = exonTrack({ height: 32 });
    const { viewport } = setup();
    expect(t.height({ data: null, viewport, hint: { maxPx: 200 } })).toMatchObject({
      px: 32,
      didTruncate: false,
    });
  });

  it('renders one .vv-exon-group per exon and N-1 intron decorations', () => {
    const { mapper, viewport, painter, interaction } = setup();
    const t = exonTrack();

    function Probe() {
      return (
        <svg>
          {t.render({
            data: { ready: true },
            rect: { yTop: 0, yBottom: 24 },
            viewport,
            mapper,
            interaction,
            painter,
          })}
        </svg>
      );
    }

    const { container } = render(<Probe />);
    expect(container.querySelectorAll('.vv-exon-group')).toHaveLength(3);
    expect(container.querySelectorAll('.vv-intron-decoration')).toHaveLength(2);
    expect(container.querySelectorAll('.vv-exon-rect')).toHaveLength(3);
  });

  it('renders a clipped sliver of partially-visible exons so intron decorations always anchor on something', () => {
    const { mapper, painter, interaction } = setup();
    // Range starts mid-exon-1 (50..250); exon 1 (1..100) is partially visible
    // and exon 3 (201..300) is also partially visible. The bug this exercises:
    // before clipping, those exons rendered no rect at all and the intron
    // chevrons trailed into empty space at the figure edges.
    const viewport = new ViewportController({
      mapper,
      width: 720,
      mode: 'cds-with-introns',
      range: [50, 250],
    });
    const t = exonTrack();

    function Probe() {
      return (
        <svg>
          {t.render({
            data: { ready: true },
            rect: { yTop: 0, yBottom: 24 },
            viewport,
            mapper,
            interaction,
            painter,
          })}
        </svg>
      );
    }

    const { container } = render(<Probe />);
    // Three exons visible (two clipped, one full); two intron decorations
    // because all three are placed and the chevrons sit between them.
    expect(container.querySelectorAll('.vv-exon-rect')).toHaveLength(3);
    expect(container.querySelectorAll('.vv-intron-decoration')).toHaveLength(2);
  });

  it('places exon-group transforms via per-exon CSS variables', () => {
    const { mapper, viewport, painter, interaction } = setup();
    const t = exonTrack();

    function Probe() {
      return (
        <svg>
          {t.render({
            data: { ready: true },
            rect: { yTop: 0, yBottom: 24 },
            viewport,
            mapper,
            interaction,
            painter,
          })}
        </svg>
      );
    }

    const { container } = render(<Probe />);
    const groups = container.querySelectorAll<SVGGElement>('.vv-exon-group');
    expect(groups[0]?.getAttribute('style')).toMatch(/var\(--vv-exon-x-0\)/);
    expect(groups[2]?.getAttribute('style')).toMatch(/var\(--vv-exon-x-2\)/);
  });
});
