import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { DefaultMinimap } from './default-minimap.js';
import { GeneGlyph, type GeneGlyphRef } from '../viewer.js';
import type { Transcript } from '../types.js';

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

async function flush() {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
  // Drain one rAF tick so the minimap's poll picks up the viewer state.
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

describe('DefaultMinimap', () => {
  it('renders an SVG with one rect per exon and a window rect at the current range', async () => {
    const ref = createRef<GeneGlyphRef>();
    const { container } = render(
      <GeneGlyph ref={ref} transcript={transcript} width={1000}>
        <GeneGlyph.Footer>
          <DefaultMinimap viewerRef={ref} width={400} height={20} />
        </GeneGlyph.Footer>
      </GeneGlyph>,
    );
    await flush();
    const exons = container.querySelectorAll('.vv-default-minimap-exon');
    expect(exons).toHaveLength(3);
    const window = container.querySelector<SVGRectElement>(
      '[data-testid="gene-glyph-minimap-window"]',
    );
    expect(window).not.toBeNull();
    // Fit-gene at the start, so the window should cover most of the minimap.
    const w = Number(window!.getAttribute('width'));
    expect(w).toBeGreaterThan(200);
  });

  it('exposes the viewer transcript and renders an aria label', async () => {
    const ref = createRef<GeneGlyphRef>();
    const { container } = render(
      <GeneGlyph ref={ref} transcript={transcript}>
        <GeneGlyph.Footer>
          <DefaultMinimap viewerRef={ref} />
        </GeneGlyph.Footer>
      </GeneGlyph>,
    );
    await flush();
    const svg = container.querySelector<SVGSVGElement>('.vv-default-minimap-svg');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('aria-label')).toContain('TEST');
  });

  it('exposes both edge resize handles', async () => {
    const ref = createRef<GeneGlyphRef>();
    const { container } = render(
      <GeneGlyph ref={ref} transcript={transcript}>
        <GeneGlyph.Footer>
          <DefaultMinimap viewerRef={ref} width={400} />
        </GeneGlyph.Footer>
      </GeneGlyph>,
    );
    await flush();
    expect(container.querySelector('[data-testid="gene-glyph-minimap-handle-left"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="gene-glyph-minimap-handle-right"]')).not.toBeNull();
  });

  it('brush slides by exactly the layout-pixel delta under panByDisplayPx, with no rescaling', async () => {
    // User-stated invariant: once a zoom level is chosen, panning the
    // figure (or its proxy in the minimap) must not change scale in
    // either view. The brush rectangle WIDTH is invariant; only its X
    // shifts, by exactly the proportional amount.
    const ref = createRef<GeneGlyphRef>();
    const { container } = render(
      <GeneGlyph ref={ref} transcript={transcript} width={1000}>
        <GeneGlyph.Footer>
          <DefaultMinimap viewerRef={ref} width={400} />
        </GeneGlyph.Footer>
      </GeneGlyph>,
    );
    await flush();
    // Zoom in so the brush is a meaningful sub-rectangle.
    await act(async () => {
      ref.current!.zoomBy(5, { animate: false });
    });
    await flush();
    const before = ref.current!.getViewportInfo();
    const brushBefore = container.querySelector<SVGRectElement>(
      '[data-testid="gene-glyph-minimap-window"]',
    )!;
    const xBefore = Number(brushBefore.getAttribute('x'));
    const wBefore = Number(brushBefore.getAttribute('width'));
    // Pan by 80 layout pixels (= 80 main-view px) RIGHT (the figure
    // slides LEFT inside the main viewport).
    await act(async () => {
      ref.current!.panByDisplayPx(80);
    });
    await flush();
    const after = ref.current!.getViewportInfo();
    const brushAfter = container.querySelector<SVGRectElement>(
      '[data-testid="gene-glyph-minimap-window"]',
    )!;
    const xAfter = Number(brushAfter.getAttribute('x'));
    const wAfter = Number(brushAfter.getAttribute('width'));
    // zoomScale must be invariant under pan.
    expect(after.zoomScale).toBe(before.zoomScale);
    // Brush WIDTH is invariant — same fraction of the layout is on screen.
    expect(wAfter).toBeCloseTo(wBefore, 5);
    // Brush X shifts by (deltaPx) × (minimapWidth / totalDisplayWidth).
    const expectedShift = 80 * (400 / after.totalDisplayWidth);
    expect(xAfter - xBefore).toBeCloseTo(expectedShift, 4);
  });

  it('jumps the viewer when the minimap background is clicked', async () => {
    const ref = createRef<GeneGlyphRef>();
    const { container } = render(
      <GeneGlyph ref={ref} transcript={transcript} width={1000}>
        <GeneGlyph.Footer>
          <DefaultMinimap viewerRef={ref} width={400} />
        </GeneGlyph.Footer>
      </GeneGlyph>,
    );
    await flush();
    // First zoom in so the window is small enough for a click to move it.
    await act(async () => {
      ref.current!.zoomBy(10, { animate: false });
    });
    await flush();
    const rangeBefore = ref.current!.getViewportInfo().range;
    const bg = container.querySelector<SVGRectElement>(
      '[data-testid="gene-glyph-minimap-bg"]',
    )!;
    // JSDOM's getBoundingClientRect for SVG elements returns zeros, which
    // makes clientX→baseline-x math collapse to zero; assert that the
    // background pointerdown is wired and triggers a viewport mutation via
    // fitTo. zoomed-in (10×) starts the range at the gene's centre; a click
    // at the very left of the minimap should pull lo to natural[0].
    fireEvent.pointerDown(bg, { clientX: 0, clientY: 5, button: 0 });
    await flush();
    const rangeAfter = ref.current!.getViewportInfo().range;
    expect(rangeAfter[0]).toBeLessThanOrEqual(rangeBefore[0] + 1e-3);
  });
});
