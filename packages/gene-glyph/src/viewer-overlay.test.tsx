import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GeneGlyph } from './viewer.js';
import { exonTrack } from './tracks/exon-track.js';
import { variantTrack } from './tracks/variant-track.js';
import type { TooltipRenderArgs, Transcript, ViewerVariant } from './types.js';

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

const variants: ViewerVariant[] = [
  { id: 'v1', label: 'V1 label', coord: { kind: 'cds', cPos: 50, offset: 0 }, category: 'missense' },
  { id: 'v2', label: 'V2 label', coord: { kind: 'cds', cPos: 250, offset: 0 }, category: 'nonsense' },
];

async function flushTrackLoads() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** JSDOM omits SVG screen-CTM plumbing. The overlay tooltip places itself in
 *  client px via `getScreenCTM` + `createSVGPoint`; stub both so the rAF tick
 *  produces a deterministic position instead of bailing out. */
function stubScreenCtm(container: HTMLElement, width = 1000): void {
  const svg = container.querySelector<SVGSVGElement>('svg.vv-figure')!;
  const wrap = container.querySelector<HTMLDivElement>('.vv-figure-wrap')!;
  wrap.getBoundingClientRect = () =>
    ({ x: 0, y: 0, left: 0, top: 0, right: width, bottom: 60, width, height: 60, toJSON: () => ({}) }) as DOMRect;
  const fakeCtm = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  svg.createSVGPoint = () => {
    const obj: { x: number; y: number; matrixTransform: (m: typeof fakeCtm) => { x: number; y: number } } = {
      x: 0,
      y: 0,
      matrixTransform(m) {
        return { x: this.x * m.a + this.y * m.c + m.e, y: this.x * m.b + this.y * m.d + m.f };
      },
    };
    return obj as unknown as SVGPoint;
  };
  svg.getScreenCTM = () => fakeCtm as unknown as DOMMatrix;
}

async function tickRaf(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    await Promise.resolve();
  });
}

describe('GeneGlyph — Slice 17 overlay tooltips', () => {
  it('renders an empty overlay layer as a sibling of the figure SVG by default', async () => {
    const { container } = render(
      <GeneGlyph transcript={transcript} tracks={[exonTrack({})]} />,
    );
    await flushTrackLoads();
    const overlay = container.querySelector('[data-testid="gene-glyph-overlay-layer"]')!;
    expect(overlay).not.toBeNull();
    // Export discipline: overlay layer must NOT live inside the figure SVG.
    const svg = container.querySelector('svg.vv-figure')!;
    expect(svg.contains(overlay)).toBe(false);
    // No tooltip until a feature is hovered.
    expect(overlay.querySelector('.vv-tooltip')).toBeNull();
  });

  it('shows the default tooltip with Track.featureLabel on hover', async () => {
    const { container } = render(
      <GeneGlyph
        transcript={transcript}
        tracks={[exonTrack({}), variantTrack({ id: 'variants', source: variants })]}
      />,
    );
    await flushTrackLoads();
    stubScreenCtm(container);
    const v1 = container.querySelector<SVGGElement>('[data-vv-feature-id="v1"]')!;
    fireEvent.mouseEnter(v1);
    await tickRaf();
    await waitFor(() => {
      const tip = container.querySelector('.vv-tooltip');
      expect(tip).not.toBeNull();
      expect(tip!.textContent).toBe('V1 label');
    });
    fireEvent.mouseLeave(v1);
    await waitFor(() => {
      expect(container.querySelector('.vv-tooltip')).toBeNull();
    });
  });

  it('uses host-supplied renderTooltip when provided', async () => {
    const renderTooltip = vi.fn((args: TooltipRenderArgs) => {
      const v = args.feature as ViewerVariant;
      return <span data-testid="custom-tip">{v.id}/{v.category}</span>;
    });
    const { container } = render(
      <GeneGlyph
        transcript={transcript}
        tracks={[exonTrack({}), variantTrack({ id: 'variants', source: variants })]}
        renderTooltip={renderTooltip}
      />,
    );
    await flushTrackLoads();
    stubScreenCtm(container);
    const v2 = container.querySelector<SVGGElement>('[data-vv-feature-id="v2"]')!;
    fireEvent.mouseEnter(v2);
    await tickRaf();
    await waitFor(() => {
      const tip = screen.getByTestId('custom-tip');
      expect(tip.textContent).toBe('v2/nonsense');
    });
    expect(renderTooltip).toHaveBeenCalledWith(
      expect.objectContaining({ trackId: 'variants', featureId: 'v2' }),
    );
  });

  it('suppresses the tooltip when renderTooltip returns null', async () => {
    const { container } = render(
      <GeneGlyph
        transcript={transcript}
        tracks={[exonTrack({}), variantTrack({ id: 'variants', source: variants })]}
        renderTooltip={() => null}
      />,
    );
    await flushTrackLoads();
    stubScreenCtm(container);
    const v1 = container.querySelector<SVGGElement>('[data-vv-feature-id="v1"]')!;
    fireEvent.mouseEnter(v1);
    await tickRaf();
    await tickRaf();
    expect(container.querySelector('.vv-tooltip')).toBeNull();
  });
});
