import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { GeneGlyph } from './viewer.js';
import type { ProteinAnnotations, Transcript } from './types.js';

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
});
