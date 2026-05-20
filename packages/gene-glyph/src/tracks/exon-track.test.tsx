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
  const viewport = new ViewportController({ mapper, width: 720, mode: 'genome' });
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

  it('renders every exon at its baseline width — rect widths are stable across pan / zoom (Slice 10)', () => {
    // Slice 10: instead of clipping rects to the viewport, the figure SVG
    // clips at the edge and exon rects stay at their baseline width forever.
    // We render the same track at two different viewports and assert that
    // each exon's rendered `width` attribute is unchanged — the only thing
    // that should differ is the wrapping `<g>`'s inline transform, which
    // is published via CSS variables on the controller's attached element.
    const { mapper, painter, interaction } = setup();
    const fitVp = new ViewportController({ mapper, width: 720, mode: 'genome' });
    const zoomedVp = new ViewportController({
      mapper,
      width: 720,
      mode: 'genome',
      range: [50, 250],
    });
    const t = exonTrack();

    function Probe({ vp }: { vp: ViewportController }) {
      return (
        <svg>
          {t.render({
            data: { ready: true },
            rect: { yTop: 0, yBottom: 24 },
            viewport: vp,
            mapper,
            interaction,
            painter,
          })}
        </svg>
      );
    }

    const fit = render(<Probe vp={fitVp} />);
    const zoom = render(<Probe vp={zoomedVp} />);

    const fitWidths = [...fit.container.querySelectorAll<SVGRectElement>('.vv-exon-rect')]
      .map((r) => r.getAttribute('width'));
    const zoomWidths = [...zoom.container.querySelectorAll<SVGRectElement>('.vv-exon-rect')]
      .map((r) => r.getAttribute('width'));

    // All three exons rendered in both configurations (no exon dropped, no
    // visible-only filtering) and rect widths are identical.
    expect(fitWidths).toHaveLength(3);
    expect(zoomWidths).toEqual(fitWidths);
  });

  it('off-figure exons get true off-figure --vv-exon-x-{N} values (not 0px)', () => {
    // Slice 10 contract: the CSS-variable publisher emits a true off-figure
    // value for exons whose current screen-x is outside [0, width]. With the
    // figure SVG's `overflow: hidden`, those exons stay in the DOM and slide
    // cleanly past the edge rather than snapping to x=0.
    const { mapper } = setup();
    const viewport = new ViewportController({
      mapper,
      width: 720,
      mode: 'genome',
      range: [130, 170], // tight zoom into mid exon 1; exons 0 + 2 sit off-figure
    });
    const el = document.createElement('div');
    viewport.attach(el);
    const exon0X = parseFloat(el.style.getPropertyValue('--vv-exon-x-0'));
    const exon2X = parseFloat(el.style.getPropertyValue('--vv-exon-x-2'));
    expect(exon0X).toBeLessThan(0);
    expect(exon2X).toBeGreaterThan(720);
  });

  it('publishes per-exon scale-x and per-gap scale-x for every exon / gap', () => {
    const { mapper } = setup();
    const viewport = new ViewportController({ mapper, width: 720, mode: 'genome' });
    const el = document.createElement('div');
    viewport.attach(el);
    // Three exons → three scale-x vars, two gap scale-x vars.
    for (let i = 0; i < 3; i++) {
      expect(el.style.getPropertyValue(`--vv-exon-scale-x-${i}`)).not.toBe('');
    }
    for (let i = 0; i < 2; i++) {
      expect(el.style.getPropertyValue(`--vv-intron-scale-x-${i}`)).not.toBe('');
    }
  });

  it('renders a hidden-feature mark for each bucket in hiddenByIntron with the documented anchor id', () => {
    const { mapper, viewport, painter, interaction } = setup();
    const t = exonTrack();
    const hiddenByIntron = new Map([
      ['0:1', { exonIdxA: 0, exonIdxB: 1, count: 3, featureIds: ['v1', 'v2', 'v3'] }],
    ]);
    const clicks: string[] = [];

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
            hiddenByIntron,
            onFeatureClick: (id: string) => clicks.push(id),
          })}
        </svg>
      );
    }

    const { container } = render(<Probe />);
    const marks = container.querySelectorAll<SVGGElement>('.vv-hidden-feature-mark');
    expect(marks).toHaveLength(1);
    const mark = marks[0]!;
    expect(mark.getAttribute('data-vv-feature-id')).toBe('__hidden_intron_0_1');
    expect(mark.getAttribute('data-vv-hidden-count')).toBe('3');
    expect(mark.querySelector('.vv-hidden-feature-count')?.textContent).toBe('3');
    mark.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(clicks).toEqual(['__hidden_intron_0_1']);
  });

  it('omits hidden-feature marks when no track contributed counts', () => {
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
            hiddenByIntron: new Map(),
          })}
        </svg>
      );
    }
    const { container } = render(<Probe />);
    expect(container.querySelector('.vv-hidden-feature-mark')).toBeNull();
    expect(container.querySelector('.vv-hidden-feature-marks')).toBeNull();
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
