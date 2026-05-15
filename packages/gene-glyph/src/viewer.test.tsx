import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { GeneGlyph } from './viewer.js';
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
});
