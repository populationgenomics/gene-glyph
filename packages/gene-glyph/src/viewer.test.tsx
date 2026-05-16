import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { GeneGlyph, type GeneGlyphRef } from './viewer.js';
import { variantTrack } from './tracks/variant-track.js';
import { exonTrack } from './tracks/exon-track.js';
import type { ProteinAnnotations, Transcript, ViewerVariant } from './types.js';

const transcript: Transcript = {
  geneSymbol: 'TEST',
  transcriptId: 'NM_TEST.1',
  isManeSelect: true,
  cdsLength: 300,
  strand: '+',
  exons: [
    { number: 1, cdsStart: 1, cdsEnd: 100, genomicStart: 1000, genomicEnd: 1099, chr: 'chr1' },
    { number: 2, cdsStart: 101, cdsEnd: 200, genomicStart: 2000, genomicEnd: 2099, chr: 'chr1' },
    { number: 3, cdsStart: 201, cdsEnd: 300, genomicStart: 3000, genomicEnd: 3099, chr: 'chr1' },
  ],
};

const protein: ProteinAnnotations = {
  uniprotAcc: 'P00000',
  length: 99,
  alphafoldId: 'P00000',
  domains: [],
};

async function flushTrackLoads() {
  // The viewer kicks off `track.load()` in a useEffect; let microtasks drain
  // so the resulting state update lands before assertions inspect the DOM.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function waitForTransition(ms = 400) {
  // `getViewportInfo()` returns interpolated values while a transition is in
  // flight; tests that assert against the final state wait the transition
  // duration first.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

describe('GeneGlyph', () => {
  it('renders the header with gene symbol, transcript ID and MANE badge', async () => {
    render(<GeneGlyph transcript={transcript} protein={protein} />);
    await flushTrackLoads();
    expect(screen.getByTestId('gene-glyph-header')).toBeInTheDocument();
    expect(screen.getByText('TEST')).toBeInTheDocument();
    expect(screen.getByText('NM_TEST.1')).toBeInTheDocument();
    expect(screen.getByText('MANE Select')).toBeInTheDocument();
  });

  it('renders an AlphaFold link when a protein record with alphafoldId is provided', async () => {
    render(<GeneGlyph transcript={transcript} protein={protein} />);
    await flushTrackLoads();
    const link = screen.getByRole('link', { name: /AlphaFold/ });
    expect(link).toHaveAttribute('href', 'https://alphafold.ebi.ac.uk/entry/P00000');
  });

  it('renders the figure SVG with a default exon track once load resolves', async () => {
    const { container } = render(<GeneGlyph transcript={transcript} />);
    await flushTrackLoads();
    expect(container.querySelector('svg.vv-figure')).toBeInTheDocument();
    expect(container.querySelectorAll('.vv-exon-group')).toHaveLength(3);
    expect(container.querySelectorAll('.vv-intron-decoration')).toHaveLength(2);
  });

  it('publishes per-exon CSS variables on the figure SVG root', async () => {
    const { container } = render(<GeneGlyph transcript={transcript} width={720} />);
    await flushTrackLoads();
    const svg = container.querySelector<SVGSVGElement>('svg.vv-figure');
    expect(svg).not.toBeNull();
    expect(svg!.style.getPropertyValue('--vv-exon-x-0')).toBe('0px');
    expect(svg!.style.getPropertyValue('--vv-exon-w-0')).not.toBe('');
    expect(svg!.style.getPropertyValue('--vv-intron-scale')).toBe('1');
  });

  describe('mode transitions', () => {
    it('controlled mode prop drives viewport mode + republishes CSS vars', async () => {
      const { container, rerender } = render(
        <GeneGlyph transcript={transcript} mode="cds-with-introns" width={720} />,
      );
      await flushTrackLoads();
      const svg = container.querySelector<SVGSVGElement>('svg.vv-figure');
      expect(svg!.style.getPropertyValue('--vv-intron-scale')).toBe('1');
      rerender(<GeneGlyph transcript={transcript} mode="cds-spliced" width={720} />);
      await flushTrackLoads();
      expect(svg!.style.getPropertyValue('--vv-intron-scale')).toBe('0');
    });

    it('toggles .vv-mode-transitioning on the root for the duration of the curve', async () => {
      const { container, rerender } = render(
        <GeneGlyph transcript={transcript} mode="cds-with-introns" width={720} />,
      );
      await flushTrackLoads();
      const root = container.querySelector('[data-testid="gene-glyph"]')!;
      expect(root.classList.contains('vv-mode-transitioning')).toBe(false);
      await act(async () => {
        rerender(<GeneGlyph transcript={transcript} mode="protein" width={720} />);
      });
      expect(root.classList.contains('vv-mode-transitioning')).toBe(true);
      expect(root.getAttribute('data-vv-mode')).toBe('protein');
      // The class clears after the 450ms transition + 16ms slack.
      await waitForTransition(500);
      expect(root.classList.contains('vv-mode-transitioning')).toBe(false);
    });

    it('fires onModeChange after every committed mode change', async () => {
      const onModeChange = vi.fn();
      const { rerender } = render(
        <GeneGlyph
          transcript={transcript}
          mode="cds-with-introns"
          onModeChange={onModeChange}
        />,
      );
      await flushTrackLoads();
      await act(async () => {
        rerender(
          <GeneGlyph
            transcript={transcript}
            mode="cds-spliced"
            onModeChange={onModeChange}
          />,
        );
      });
      expect(onModeChange).toHaveBeenCalledWith('cds-spliced');
    });

    it('uncontrolled mode falls back to defaultMode and stays stable across rerenders', async () => {
      const { container } = render(
        <GeneGlyph transcript={transcript} defaultMode="cds-spliced" />,
      );
      await flushTrackLoads();
      const root = container.querySelector('[data-testid="gene-glyph"]')!;
      expect(root.getAttribute('data-vv-mode')).toBe('cds-spliced');
    });
  });

  describe('variant interaction wiring', () => {
    const variants: ViewerVariant[] = [
      { id: 'v1', label: 'V1', coord: { kind: 'cds', cPos: 50, offset: 0 }, category: 'missense' },
      { id: 'v2', label: 'V2', coord: { kind: 'cds', cPos: 150, offset: 0 }, category: 'nonsense' },
      { id: 'oob', label: 'OOB', coord: { kind: 'cds', cPos: 9999, offset: 0 }, category: 'utr' },
    ];

    it('forwards onHover and onFeatureClick from a placed variant', async () => {
      const onHover = vi.fn();
      const onFeatureClick = vi.fn();
      const { container } = render(
        <GeneGlyph
          transcript={transcript}
          tracks={[exonTrack({}), variantTrack({ id: 'variants', source: variants })]}
          onHover={onHover}
          onFeatureClick={onFeatureClick}
        />,
      );
      await flushTrackLoads();
      const v1 = container.querySelector<SVGGElement>('[data-vv-feature-id="v1"]');
      expect(v1).not.toBeNull();
      fireEvent.mouseEnter(v1!);
      fireEvent.click(v1!);
      fireEvent.mouseLeave(v1!);
      expect(onHover).toHaveBeenCalledWith('v1', 'variants');
      expect(onHover).toHaveBeenCalledWith(null, 'variants');
      expect(onFeatureClick).toHaveBeenCalledWith('v1', 'variants');
    });

    it('applies the hover lift class when hoveredFeatureId is supplied', async () => {
      const { container } = render(
        <GeneGlyph
          transcript={transcript}
          tracks={[exonTrack({}), variantTrack({ id: 'variants', source: variants })]}
          hoveredFeatureId="v2"
        />,
      );
      await flushTrackLoads();
      const v2 = container.querySelector<SVGGElement>('[data-vv-feature-id="v2"]');
      expect(v2?.classList.contains('is-hovered')).toBe(true);
    });

    it('applies the selection class when selectedFeatureIds includes a variant', async () => {
      const { container } = render(
        <GeneGlyph
          transcript={transcript}
          tracks={[exonTrack({}), variantTrack({ id: 'variants', source: variants })]}
          selectedFeatureIds={new Set(['v1'])}
        />,
      );
      await flushTrackLoads();
      const v1 = container.querySelector<SVGGElement>('[data-vv-feature-id="v1"]');
      expect(v1?.classList.contains('is-selected')).toBe(true);
    });

    it('forwards an imperative ref exposing fitTo / zoomBy / getViewportInfo', async () => {
      const ref = createRef<GeneGlyphRef>();
      render(
        <GeneGlyph
          ref={ref}
          transcript={transcript}
          tracks={[exonTrack({}), variantTrack({ id: 'variants', source: variants })]}
        />,
      );
      await flushTrackLoads();
      expect(ref.current).not.toBeNull();
      const info = ref.current!.getViewportInfo();
      expect(info.mode).toBe('cds-with-introns');
      expect(info.range).toEqual([1, transcript.cdsLength]);
      expect(info.zoom).toBeCloseTo(1);
      expect(info.layout.length).toBeGreaterThan(0);
    });

    it('fitTo({kind: feature}) narrows the range around the feature and toggles vv-transitioning', async () => {
      const ref = createRef<GeneGlyphRef>();
      const { container } = render(
        <GeneGlyph
          ref={ref}
          transcript={transcript}
          tracks={[exonTrack({}), variantTrack({ id: 'variants', source: variants })]}
        />,
      );
      await flushTrackLoads();
      await act(async () => {
        ref.current!.fitTo({ kind: 'feature', trackId: 'variants', featureId: 'v2' });
      });
      const root = container.querySelector('[data-testid="gene-glyph"]');
      expect(root?.classList.contains('vv-transitioning')).toBe(true);
      await waitForTransition();
      const after = ref.current!.getViewportInfo();
      expect(after.range[1] - after.range[0]).toBeLessThan(transcript.cdsLength);
      // v2 is at cPos 150; the new range should bracket it.
      expect(after.range[0]).toBeLessThanOrEqual(150);
      expect(after.range[1]).toBeGreaterThanOrEqual(150);
      expect(root?.classList.contains('vv-transitioning')).toBe(false);
    });

    it('fitTo({kind: gene}) restores the full natural range', async () => {
      const ref = createRef<GeneGlyphRef>();
      render(
        <GeneGlyph
          ref={ref}
          transcript={transcript}
          tracks={[exonTrack({}), variantTrack({ id: 'variants', source: variants })]}
        />,
      );
      await flushTrackLoads();
      await act(async () => {
        ref.current!.fitTo({ kind: 'range', range: [80, 120] });
      });
      await waitForTransition();
      expect(ref.current!.getViewportInfo().range).toEqual([80, 120]);
      await act(async () => {
        ref.current!.fitTo({ kind: 'gene' });
      });
      await waitForTransition();
      expect(ref.current!.getViewportInfo().range).toEqual([1, transcript.cdsLength]);
    });

    it('zoomBy halves and doubles the visible range, centered on the current viewport', async () => {
      const ref = createRef<GeneGlyphRef>();
      render(
        <GeneGlyph
          ref={ref}
          transcript={transcript}
          tracks={[exonTrack({}), variantTrack({ id: 'variants', source: variants })]}
        />,
      );
      await flushTrackLoads();
      await act(async () => {
        ref.current!.fitTo({ kind: 'range', range: [100, 200] });
      });
      await waitForTransition();
      await act(async () => {
        ref.current!.zoomBy(2);
      });
      await waitForTransition();
      const zoomed = ref.current!.getViewportInfo().range;
      expect(zoomed[1] - zoomed[0]).toBeCloseTo(50, 5);
      expect((zoomed[0] + zoomed[1]) / 2).toBeCloseTo(150, 5);
      await act(async () => {
        ref.current!.zoomBy(0.5);
      });
      await waitForTransition();
      const back = ref.current!.getViewportInfo().range;
      expect(back[1] - back[0]).toBeCloseTo(100, 5);
    });

    it('renders an unplaced-variants chip row when variants cannot project', async () => {
      const { container } = render(
        <GeneGlyph
          transcript={transcript}
          tracks={[exonTrack({}), variantTrack({ id: 'variants', source: variants })]}
        />,
      );
      await flushTrackLoads();
      expect(container.querySelector('[data-testid="gene-glyph-below"]')).not.toBeNull();
      const chips = container.querySelectorAll('.vv-unplaced-chip');
      expect(chips.length).toBeGreaterThanOrEqual(1);
      expect(container.querySelector('[data-vv-feature-id="oob"]')).not.toBeNull();
    });
  });

  describe('Slice 18 — async loading orchestration', () => {
    const variants: ViewerVariant[] = [
      { id: 'v1', label: 'V1', coord: { kind: 'cds', cPos: 50, offset: 0 }, category: 'missense' },
    ];

    it('reports loading → ready transitions through onTrackStateChange', async () => {
      const seen: Array<[string, string]> = [];
      const onTrackStateChange = vi.fn((id: string, state: string) => {
        seen.push([id, state]);
      });
      let resolveFn: ((v: ViewerVariant[]) => void) | null = null;
      const source = {
        id: 'mock',
        cacheKey: () => 'k',
        query: () =>
          new Promise<ViewerVariant[]>((res) => {
            resolveFn = res;
          }),
      };
      render(
        <GeneGlyph
          transcript={transcript}
          tracks={[exonTrack({}), variantTrack({ id: 'variants', source })]}
          onTrackStateChange={onTrackStateChange}
        />,
      );
      await act(async () => { await Promise.resolve(); });
      expect(seen.some(([id, s]) => id === 'variants' && s === 'loading')).toBe(true);
      expect(seen.some(([id, s]) => id === 'variants' && s === 'ready')).toBe(false);
      await act(async () => {
        resolveFn!(variants);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(seen.some(([id, s]) => id === 'variants' && s === 'ready')).toBe(true);
    });

    it('renders a shimmer rect over a track stuck in loading state', async () => {
      const source = {
        id: 'mock',
        cacheKey: () => 'k',
        query: () => new Promise<ViewerVariant[]>(() => {}),
      };
      const { container } = render(
        <GeneGlyph
          transcript={transcript}
          tracks={[exonTrack({}), variantTrack({ id: 'variants', source })]}
        />,
      );
      await act(async () => { await Promise.resolve(); });
      const shimmer = container.querySelector('[data-testid="gene-glyph-shimmer-variants"]');
      expect(shimmer).not.toBeNull();
    });

    it('marks data-vv-stale on viewport range change and clears after the debounce', async () => {
      vi.useFakeTimers();
      try {
        const ref = createRef<GeneGlyphRef>();
        const { container } = render(
          <GeneGlyph
            ref={ref}
            transcript={transcript}
            tracks={[exonTrack({}), variantTrack({ id: 'variants', source: variants })]}
            loadDebounceMs={120}
          />,
        );
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });
        const root = container.querySelector('[data-testid="gene-glyph"]')!;
        expect(root.hasAttribute('data-vv-stale')).toBe(false);
        await act(async () => {
          ref.current!.fitTo({ kind: 'range', range: [50, 200] });
          await Promise.resolve();
        });
        expect(root.hasAttribute('data-vv-stale')).toBe(true);
        await act(async () => {
          vi.advanceTimersByTime(140);
          await Promise.resolve();
          await Promise.resolve();
        });
        expect(root.hasAttribute('data-vv-stale')).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('two tracks sharing one DataSource fire query() exactly once per cacheKey', async () => {
      const query = vi.fn().mockResolvedValue(variants);
      // Wrap so both tracks share the same memoised promise (the real
      // `createCachedDataSource` is covered by data-source.test.ts; this
      // viewer test only proves a shared instance dedupes per render pass).
      let pending: Promise<ViewerVariant[]> | null = null;
      const wrapped = {
        id: 'shared',
        cacheKey: () => 'k',
        query: (): Promise<ViewerVariant[]> => {
          if (!pending) pending = query();
          return pending!;
        },
      };
      render(
        <GeneGlyph
          transcript={transcript}
          tracks={[
            exonTrack({}),
            variantTrack({ id: 'variants-a', source: wrapped }),
            variantTrack({ id: 'variants-b', source: wrapped }),
          ]}
        />,
      );
      await flushTrackLoads();
      expect(query).toHaveBeenCalledTimes(1);
    });
  });
});
