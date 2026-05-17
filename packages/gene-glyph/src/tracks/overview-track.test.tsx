import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { GeneGlyph, type GeneGlyphRef } from '../viewer.js';
import { exonTrack } from './exon-track.js';
import { overviewTrack } from './overview-track.js';
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
  // One rAF drains the overview's getViewportInfo poll.
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

describe('overviewTrack — factory', () => {
  it('reports fixed height', () => {
    const ref = createRef<GeneGlyphRef>();
    const t = overviewTrack({ viewerRef: ref, height: 40 });
    expect(t.heightPolicy).toBe('fixed');
    expect(t.coordSystem).toBe('cds');
    expect(t.height({ data: null, viewport: {} as never, hint: { maxPx: 200 } }))
      .toEqual({ px: 40, didTruncate: false });
  });

  it('auto-sizes height from the number of upstream-track minimap rows', () => {
    const ref = createRef<GeneGlyphRef>();
    // Three tracks × 16 px + 2 × 4 px padding = 56.
    const t = overviewTrack({
      viewerRef: ref,
      tracks: [exonTrack({ id: 'a' }), exonTrack({ id: 'b' }), exonTrack({ id: 'c' })],
    });
    expect(t.height({ data: null, viewport: {} as never, hint: { maxPx: 200 } }).px)
      .toBe(56);
  });

  it('honours an explicit height override', () => {
    const ref = createRef<GeneGlyphRef>();
    const t = overviewTrack({
      viewerRef: ref,
      tracks: [exonTrack({}), exonTrack({ id: 'b' })],
      height: 80,
    });
    expect(t.height({ data: null, viewport: {} as never, hint: { maxPx: 200 } }).px)
      .toBe(80);
  });
});

describe('overviewTrack — embedded render', () => {
  it('renders one minimap-exon rect per exon (via the upstream exon track) and a window rectangle inside the figure SVG', async () => {
    const ref = createRef<GeneGlyphRef>();
    const upstream = [exonTrack({})];
    const { container } = render(
      <GeneGlyph
        ref={ref}
        transcript={transcript}
        width={720}
        tracks={[
          overviewTrack({ viewerRef: ref, tracks: upstream }),
          ...upstream,
        ]}
      />,
    );
    await flush();
    const figure = container.querySelector<SVGSVGElement>('svg.vv-figure');
    expect(figure).not.toBeNull();
    // The exon track's renderMinimap output appears inside the overview's
    // row wrapper, one rect per exon.
    expect(
      figure!.querySelectorAll('.vv-overview-row .vv-exon-minimap-exon'),
    ).toHaveLength(3);
    const window = figure!.querySelector<SVGRectElement>(
      '[data-testid="gene-glyph-overview-window"]',
    );
    expect(window).not.toBeNull();
    const w = Number(window!.getAttribute('width'));
    // Fit-gene: the window covers most of the figure width.
    expect(w).toBeGreaterThan(400);
  });

  it('exposes both edge resize handles', async () => {
    const ref = createRef<GeneGlyphRef>();
    const upstream = [exonTrack({})];
    const { container } = render(
      <GeneGlyph
        ref={ref}
        transcript={transcript}
        tracks={[overviewTrack({ viewerRef: ref, tracks: upstream }), ...upstream]}
      />,
    );
    await flush();
    expect(
      container.querySelector('[data-testid="gene-glyph-overview-handle-left"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="gene-glyph-overview-handle-right"]'),
    ).not.toBeNull();
  });

  it('shrinks the window rectangle when the viewer zooms in', async () => {
    const ref = createRef<GeneGlyphRef>();
    const upstream = [exonTrack({})];
    const { container } = render(
      <GeneGlyph
        ref={ref}
        transcript={transcript}
        width={720}
        tracks={[overviewTrack({ viewerRef: ref, tracks: upstream }), ...upstream]}
      />,
    );
    await flush();
    const window = container.querySelector<SVGRectElement>(
      '[data-testid="gene-glyph-overview-window"]',
    )!;
    const widthBefore = Number(window.getAttribute('width'));
    await act(async () => {
      ref.current!.zoomBy(8, { animate: false });
    });
    await flush();
    const widthAfter = Number(window.getAttribute('width'));
    expect(widthAfter).toBeLessThan(widthBefore - 50);
  });

  it('jumps the viewer when the overview background is clicked', async () => {
    const ref = createRef<GeneGlyphRef>();
    const upstream = [exonTrack({})];
    const { container } = render(
      <GeneGlyph
        ref={ref}
        transcript={transcript}
        width={720}
        tracks={[overviewTrack({ viewerRef: ref, tracks: upstream }), ...upstream]}
      />,
    );
    await flush();
    await act(async () => {
      ref.current!.zoomBy(10, { animate: false });
    });
    await flush();
    const rangeBefore = ref.current!.getViewportInfo().range;
    const bg = container.querySelector<SVGRectElement>(
      '[data-testid="gene-glyph-overview-bg"]',
    )!;
    fireEvent.pointerDown(bg, { clientX: 0, clientY: 5, button: 0 });
    await flush();
    const rangeAfter = ref.current!.getViewportInfo().range;
    expect(rangeAfter[0]).toBeLessThanOrEqual(rangeBefore[0] + 1e-3);
  });

  it('does not let the figure enter pan-drag mode when the window rect is grabbed', async () => {
    const ref = createRef<GeneGlyphRef>();
    const upstream = [exonTrack({})];
    const { container } = render(
      <GeneGlyph
        ref={ref}
        transcript={transcript}
        width={720}
        tracks={[overviewTrack({ viewerRef: ref, tracks: upstream }), ...upstream]}
      />,
    );
    await flush();
    const root = container.querySelector<HTMLDivElement>('.gene-glyph')!;
    const window = container.querySelector<SVGRectElement>(
      '[data-testid="gene-glyph-overview-window"]',
    )!;
    fireEvent.pointerDown(window, { clientX: 100, clientY: 5, button: 0 });
    expect(root.classList.contains('vv-dragging')).toBe(false);
  });

  it('skips tracks without a renderMinimap hook', async () => {
    // A bare track stub (no renderMinimap). The overview should silently
    // drop it from the minimap rows without crashing.
    const ref = createRef<GeneGlyphRef>();
    const stub = {
      id: 'no-minimap',
      coordSystem: 'cds' as const,
      heightPolicy: 'fixed' as const,
      async load() {
        return { ready: true } as const;
      },
      height() {
        return { px: 20, didTruncate: false };
      },
      render() {
        return null;
      },
      toJSON() {
        return { id: 'no-minimap' };
      },
    };
    const upstream = [exonTrack({}), stub];
    const { container } = render(
      <GeneGlyph
        ref={ref}
        transcript={transcript}
        width={720}
        tracks={[overviewTrack({ viewerRef: ref, tracks: upstream }), ...upstream]}
      />,
    );
    await flush();
    const rows = container.querySelectorAll('.vv-overview-row');
    // Only the exon track produced a row.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.getAttribute('data-vv-row-track-id')).toBe('exon-track');
  });
});
