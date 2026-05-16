import { createRef, useState, type Ref } from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GeneGlyph, type GeneGlyphRef } from './viewer.js';
import { exonTrack } from './tracks/exon-track.js';
import type { Transcript } from './types.js';

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

async function flushTrackLoads() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** JSDOM returns 0×0 for `getBoundingClientRect()`. Stub it on the figure SVG
 *  to mirror the actual rendered width so the hook's CSS-px ↔ viewBox-px
 *  conversion behaves like the browser would. */
function stubFigureRect(container: HTMLElement, width: number, height = 60): SVGSVGElement {
  const svg = container.querySelector<SVGSVGElement>('svg.vv-figure')!;
  svg.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON: () => ({}),
    }) as DOMRect;
  return svg;
}

function dispatchWheel(target: Element, init: WheelEventInit): WheelEvent {
  // JSDOM ships WheelEvent; use it directly so ctrlKey / deltaMode survive
  // the trip into our non-passive listener (fireEvent.wheel routes through
  // its own Event constructor that drops some fields in older versions).
  const ev = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(ev);
  return ev;
}

describe('GeneGlyph — Slice 9 interactions', () => {
  describe('wheel pan', () => {
    it('plain wheel pans the visible range horizontally', async () => {
      const ref = createRef<GeneGlyphRef>();
      const onChange = vi.fn();
      const { container } = render(
        <GeneGlyph
          ref={ref}
          transcript={transcript}
          tracks={[exonTrack({})]}
          onViewportChange={onChange}
        />,
      );
      await flushTrackLoads();
      // Start tighter than full-gene so we have room to pan in either direction.
      act(() => {
        ref.current!.fitTo({ kind: 'range', range: [80, 220] });
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 400));
      });
      const svg = stubFigureRect(container, 1000);
      onChange.mockClear();
      dispatchWheel(svg, { deltaX: 100, deltaY: 0 });
      // Slice 10: pan operates in baseline screen-x space, not uniformly in
      // CDS bp. A 100 px wheel input shifts the visible window by exactly
      // 100 baseline px; the resulting CDS-bp shift depends on the local
      // slope of `cdsToBaselineX` (steeper through gaps than within exons).
      // For range [80, 220] at the test's geometry that's ≈ +24 cPos on lo,
      // ≈ +31 on hi (the new hi sits inside exon 2 where the inverse slope
      // differs slightly from lo's position in exon 0).
      const range = ref.current!.getViewportInfo().range;
      expect(range[0]).toBeGreaterThan(80);
      expect(range[1]).toBeGreaterThan(220);
      expect(range[0]).toBeLessThan(range[1]);
      expect(onChange).toHaveBeenCalledWith(expect.any(Array), 'wheel');
    });

    it('falls through to the page (no preventDefault) once the range hits the pan limit', async () => {
      const { container } = render(
        <GeneGlyph transcript={transcript} tracks={[exonTrack({})]} />,
      );
      await flushTrackLoads();
      const svg = stubFigureRect(container, 1000);
      // First wheel-left does pan (into the 5% padding) and consumes the
      // event; once the range pegs against the padded-bounds left edge a
      // subsequent wheel-left has to fall through to the page.
      const first = dispatchWheel(svg, { deltaX: -100, deltaY: 0 });
      expect(first.defaultPrevented).toBe(true);
      for (let i = 0; i < 20; i++) dispatchWheel(svg, { deltaX: -100, deltaY: 0 });
      const limit = dispatchWheel(svg, { deltaX: -100, deltaY: 0 });
      expect(limit.defaultPrevented).toBe(false);
    });

    it('Cmd+wheel zooms cursor-anchored', async () => {
      const ref = createRef<GeneGlyphRef>();
      const { container } = render(
        <GeneGlyph
          ref={ref}
          transcript={transcript}
          tracks={[exonTrack({})]}
          mode="cds-spliced"
        />,
      );
      await flushTrackLoads();
      const svg = stubFigureRect(container, 1000);
      const beforeLen = ref.current!.getViewportInfo().range[1] -
        ref.current!.getViewportInfo().range[0];
      dispatchWheel(svg, { deltaY: -100, ctrlKey: true, clientX: 250 });
      const after = ref.current!.getViewportInfo().range;
      const afterLen = after[1] - after[0];
      expect(afterLen).toBeLessThan(beforeLen);
      // Cursor at 25% of width should leave more headroom on the right.
      const anchorRulerBefore = 1 + 0.25 * 299;
      expect(after[0]).toBeLessThanOrEqual(anchorRulerBefore + 0.5);
      expect(after[1]).toBeGreaterThanOrEqual(anchorRulerBefore - 0.5);
    });

    it('respects interactionMode="embed" by ignoring Cmd+wheel zoom', async () => {
      const ref = createRef<GeneGlyphRef>();
      const { container } = render(
        <GeneGlyph
          ref={ref}
          transcript={transcript}
          tracks={[exonTrack({})]}
          interactionMode="embed"
        />,
      );
      await flushTrackLoads();
      const before = ref.current!.getViewportInfo().range;
      const svg = stubFigureRect(container, 1000);
      const ev = dispatchWheel(svg, { deltaY: -100, ctrlKey: true, clientX: 250 });
      expect(ev.defaultPrevented).toBe(false);
      expect(ref.current!.getViewportInfo().range).toEqual(before);
    });
  });

  describe('drag pan', () => {
    it('updates range as the cursor drags and stops on pointerup', async () => {
      const ref = createRef<GeneGlyphRef>();
      const { container } = render(
        <GeneGlyph ref={ref} transcript={transcript} tracks={[exonTrack({})]} />,
      );
      await flushTrackLoads();
      act(() => {
        ref.current!.fitTo({ kind: 'range', range: [80, 220] });
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 400));
      });
      const svg = stubFigureRect(container, 1000);
      fireEvent.pointerDown(svg, { pointerId: 1, clientX: 500, button: 0 });
      fireEvent.pointerMove(window, { pointerId: 1, clientX: 400 });
      const mid = ref.current!.getViewportInfo().range;
      // Slice 10: drag-pan moves in baseline screen-x space, so the resulting
      // CDS-bp shift depends on the local slope of `cdsToBaselineX`. Dragging
      // the cursor left by 100 shifts the visible window 100 baseline px
      // right — both lo and hi increase, and the visible range slides under
      // the cursor cleanly.
      expect(mid[0]).toBeGreaterThan(80);
      expect(mid[1]).toBeGreaterThan(220);
      expect(mid[0]).toBeLessThan(mid[1]);
      fireEvent.pointerUp(window, { pointerId: 1, clientX: 400 });
      // After release, the no-transition flag should be off so future
      // programmatic moves animate again.
      const root = container.querySelector('[data-testid="gene-glyph"]');
      expect(root?.classList.contains('vv-no-transition')).toBe(false);
    });
  });

  describe('brush selection', () => {
    it('shift+drag emits a non-null brush range and shift-click clears it', async () => {
      const onBrush = vi.fn();
      const { container } = render(
        <GeneGlyph
          transcript={transcript}
          tracks={[exonTrack({})]}
          onBrushChange={onBrush}
        />,
      );
      await flushTrackLoads();
      const svg = stubFigureRect(container, 1000);
      // Shift-drag from cssX=300 to cssX=600. With width=1000 and the rect
      // stubbed at 0..1000 css, that's a viewBox-x sweep of 300→600 which
      // covers a substantial slice of the gene's CDS-bp ruler.
      fireEvent.pointerDown(svg, {
        pointerId: 7,
        clientX: 300,
        button: 0,
        shiftKey: true,
      });
      fireEvent.pointerMove(window, { pointerId: 7, clientX: 600 });
      fireEvent.pointerUp(window, { pointerId: 7, clientX: 600 });
      expect(onBrush).toHaveBeenCalled();
      const lastNonNull = [...onBrush.mock.calls].reverse().find((c) => c[0] !== null);
      expect(lastNonNull).toBeDefined();
      const range = lastNonNull![0] as [number, number];
      expect(range[0]).toBeLessThan(range[1]);
      expect(range[0]).toBeGreaterThan(0);
      expect(range[1]).toBeLessThan(transcript.cdsLength + 1);

      // Brush rect renders inside the figure SVG.
      expect(
        container.querySelector('svg.vv-figure .vv-brush-overlay'),
      ).not.toBeNull();

      // A shift-click with no drag clears the brush.
      onBrush.mockClear();
      fireEvent.pointerDown(svg, {
        pointerId: 8,
        clientX: 500,
        button: 0,
        shiftKey: true,
      });
      fireEvent.pointerUp(window, { pointerId: 8, clientX: 500 });
      expect(onBrush).toHaveBeenLastCalledWith(null);
    });

    it('fitTo({kind:"selection"}) zooms to the active brush range', async () => {
      const ref = createRef<GeneGlyphRef>();
      const { container } = render(
        <GeneGlyph
          ref={ref}
          transcript={transcript}
          tracks={[exonTrack({})]}
          brushRange={[80, 220]}
        />,
      );
      await flushTrackLoads();
      // Avoid the unused warning while keeping the symbol stable for future
      // hit-tests; the rect stub isn't needed because fitTo is imperative.
      void container;
      act(() => {
        ref.current!.fitTo({ kind: 'selection' });
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 400));
      });
      const range = ref.current!.getViewportInfo().range;
      expect(range[0]).toBeCloseTo(80, 5);
      expect(range[1]).toBeCloseTo(220, 5);
    });
  });

  describe('keyboard', () => {
    it('arrow keys pan and +/- zoom; "1" returns to fit-gene', async () => {
      const ref = createRef<GeneGlyphRef>();
      const { container } = render(
        <GeneGlyph ref={ref} transcript={transcript} tracks={[exonTrack({})]} />,
      );
      await flushTrackLoads();
      const root = container.querySelector<HTMLElement>('[data-testid="gene-glyph"]')!;
      // Zoom in once.
      fireEvent.keyDown(root, { key: '+' });
      const zoomed = ref.current!.getViewportInfo();
      expect(zoomed.zoom).toBeGreaterThan(1);
      const len = zoomed.range[1] - zoomed.range[0];

      // Pan right.
      fireEvent.keyDown(root, { key: 'ArrowRight' });
      const panned = ref.current!.getViewportInfo();
      expect(panned.range[0]).toBeGreaterThan(zoomed.range[0]);
      expect(panned.range[1] - panned.range[0]).toBeCloseTo(len, 5);

      // Reset to fit-gene.
      fireEvent.keyDown(root, { key: '1' });
      expect(ref.current!.getViewportInfo().range).toEqual([1, transcript.cdsLength]);
    });

    it('keyboard pan/zoom animates (no vv-no-transition) — Slice 10 baseline geometry keeps children stable across the animation', async () => {
      const ref = createRef<GeneGlyphRef>();
      const { container } = render(
        <GeneGlyph ref={ref} transcript={transcript} tracks={[exonTrack({})]} />,
      );
      await flushTrackLoads();
      const root = container.querySelector<HTMLElement>('[data-testid="gene-glyph"]')!;
      fireEvent.keyDown(root, { key: 'ArrowRight' });
      // With baseline geometry the children's SVG attributes don't change on
      // pan / zoom — only the wrapping `<g>`'s `transform` CSS variable. That
      // means keyboard pan can ride the same CSS transition as `fitTo`; we
      // assert the gesture-level "skip CSS easing" flag is *not* set.
      expect(root.classList.contains('vv-no-transition')).toBe(false);
    });
  });

  describe('clamping', () => {
    it('pans bite at the padded gene bounds', async () => {
      const ref = createRef<GeneGlyphRef>();
      const onChange = vi.fn();
      const { container } = render(
        <GeneGlyph
          ref={ref}
          transcript={transcript}
          tracks={[exonTrack({})]}
          onViewportChange={onChange}
        />,
      );
      await flushTrackLoads();
      act(() => {
        ref.current!.fitTo({ kind: 'range', range: [200, 250] });
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 400));
      });
      const svg = stubFigureRect(container, 1000);
      // Pan a long way to the right; range should clamp to the padded
      // bounds' right edge (300 + 0.05 * 299 ≈ 314.95) instead of running off.
      for (let i = 0; i < 50; i++) {
        dispatchWheel(svg, { deltaX: 100, deltaY: 0 });
      }
      const range = ref.current!.getViewportInfo().range;
      const naturalLen = transcript.cdsLength - 1;
      const padRight = transcript.cdsLength + naturalLen * 0.05;
      expect(range[1]).toBeCloseTo(padRight, 3);
    });

    it('zooms bite at the configured maxZoom', async () => {
      const ref = createRef<GeneGlyphRef>();
      const { container } = render(
        <GeneGlyph
          ref={ref}
          transcript={transcript}
          tracks={[exonTrack({})]}
          maxZoom={4}
        />,
      );
      await flushTrackLoads();
      const svg = stubFigureRect(container, 1000);
      for (let i = 0; i < 20; i++) {
        dispatchWheel(svg, { deltaY: -100, ctrlKey: true, clientX: 500 });
      }
      const info = ref.current!.getViewportInfo();
      expect(info.zoom).toBeLessThanOrEqual(4 + 1e-6);
      expect(info.zoom).toBeCloseTo(4, 3);
    });
  });

  describe('controlled mode', () => {
    function ControlledHarness({ refForward }: { refForward: Ref<GeneGlyphRef> }) {
      const [range, setRange] = useState<readonly [number, number]>([50, 250]);
      const [last, setLast] = useState<string | null>(null);
      return (
        <div>
          <span data-testid="last-reason">{last ?? ''}</span>
          <GeneGlyph
            ref={refForward}
            transcript={transcript}
            tracks={[exonTrack({})]}
            viewportRange={range}
            onViewportChange={(r, reason) => {
              setLast(reason);
              setRange([r[0], r[1]]);
            }}
          />
        </div>
      );
    }

    it('renders against the controlled range and updates only via the callback', async () => {
      const ref = createRef<GeneGlyphRef>();
      const { container, getByTestId } = render(<ControlledHarness refForward={ref} />);
      await flushTrackLoads();
      expect(ref.current!.getViewportInfo().range).toEqual([50, 250]);
      const svg = stubFigureRect(container, 1000);
      dispatchWheel(svg, { deltaX: 100, deltaY: 0 });
      await act(async () => {
        await Promise.resolve();
      });
      // Wheel emitted "wheel" reason and host updated the prop.
      expect(getByTestId('last-reason').textContent).toBe('wheel');
      const range = ref.current!.getViewportInfo().range;
      expect(range[0]).toBeGreaterThan(50);
      expect(range[1]).toBeGreaterThan(250);
    });
  });
});
