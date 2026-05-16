import { describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import { GeneGlyph } from './viewer.js';
import { exonTrack } from './tracks/exon-track.js';
import { interProTrack } from './tracks/interpro-track.js';
import type { GutterItem } from './viewer.js';
import type { ProteinAnnotations, Transcript } from './types.js';

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

const protein: ProteinAnnotations = {
  uniprotAcc: 'P00000',
  length: 100,
  domains: [
    {
      aaStart: 5,
      aaEnd: 30,
      source: 'InterPro',
      sourceId: 'IPR0001',
      shortName: 'F1',
      description: 'Family 1',
      entryType: 'family',
    },
  ],
};

async function flushLoads() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

describe('GeneGlyph slot system', () => {
  it('renders the default header when no Header slot is provided', async () => {
    const { container } = render(<GeneGlyph transcript={transcript} protein={protein} />);
    await flushLoads();
    expect(container.querySelector('[data-testid="gene-glyph-header"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="gene-glyph-header-slot"]')).toBeNull();
  });

  it('replaces the default header with the Header slot when provided', async () => {
    const { container, getByTestId } = render(
      <GeneGlyph transcript={transcript} protein={protein}>
        <GeneGlyph.Header height={40}>
          <button data-testid="custom-header-btn">Mode</button>
        </GeneGlyph.Header>
      </GeneGlyph>,
    );
    await flushLoads();
    expect(container.querySelector('[data-testid="gene-glyph-header"]')).toBeNull();
    const slot = getByTestId('gene-glyph-header-slot');
    expect(slot).toBeInTheDocument();
    expect(slot.style.minHeight).toBe('40px');
    expect(getByTestId('custom-header-btn')).toBeInTheDocument();
  });

  it('renders the Footer slot with React children below the figure', async () => {
    const { container, getByTestId } = render(
      <GeneGlyph transcript={transcript} protein={protein}>
        <GeneGlyph.Footer height={32}>
          <span data-testid="custom-footer">scale bar</span>
        </GeneGlyph.Footer>
      </GeneGlyph>,
    );
    await flushLoads();
    const slot = getByTestId('gene-glyph-footer-slot');
    expect(slot).toBeInTheDocument();
    expect(slot.style.minHeight).toBe('32px');
    expect(getByTestId('custom-footer')).toBeInTheDocument();
    // Footer DOM order: after the figure-row.
    const root = container.querySelector<HTMLElement>('[data-testid="gene-glyph"]')!;
    const figureRow = root.querySelector('.vv-figure-row')!;
    const footer = root.querySelector('[data-testid="gene-glyph-footer-slot"]')!;
    expect(figureRow.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('calls the RightGutter render-prop with the same items as LeftGutter and reserves the requested width', async () => {
    const rightSeen: GutterItem[] = [];
    const { container } = render(
      <GeneGlyph
        transcript={transcript}
        protein={protein}
        tracks={[exonTrack({}), interProTrack({ groups: ['family'] })]}
      >
        <GeneGlyph.RightGutter width={48}>
          {(item) => {
            rightSeen.push(item);
            return <span data-testid={`right-${item.kind}-${item.id}`}>{item.id}</span>;
          }}
        </GeneGlyph.RightGutter>
      </GeneGlyph>,
    );
    await flushLoads();
    const right = container.querySelector<HTMLDivElement>('[data-testid="gene-glyph-right-gutter"]');
    expect(right).not.toBeNull();
    expect(right!.style.width).toBe('48px');
    const ids = rightSeen.map((s) => `${s.kind}:${s.id}`);
    expect(ids).toContain('track:exon-track');
    expect(ids).toContain('group:interpro');
    expect(ids).toContain('track:interpro-family');
  });

  it('renders both gutters as flex siblings of the figure SVG', async () => {
    const { container } = render(
      <GeneGlyph
        transcript={transcript}
        protein={protein}
        tracks={[exonTrack({})]}
      >
        <GeneGlyph.LeftGutter width={32}>
          {() => <span>L</span>}
        </GeneGlyph.LeftGutter>
        <GeneGlyph.RightGutter width={24}>
          {() => <span>R</span>}
        </GeneGlyph.RightGutter>
      </GeneGlyph>,
    );
    await flushLoads();
    const row = container.querySelector('.vv-figure-row')!;
    const kids = Array.from(row.children);
    expect(kids[0]).toHaveProperty('className', expect.stringContaining('vv-left-gutter'));
    // Slice 17: the figure SVG now lives inside a positioned wrap div that
    // also hosts the overlay layer. The wrap stays a flex sibling of the
    // gutters, so export discipline (SVG-only serialisation) is preserved.
    expect(kids[1]).toHaveProperty('className', expect.stringContaining('vv-figure-wrap'));
    const wrapKids = Array.from(kids[1]!.children);
    expect(wrapKids[0]?.tagName.toLowerCase()).toBe('svg');
    expect(wrapKids[1]).toHaveProperty('className', expect.stringContaining('vv-overlay-layer'));
    expect(kids[2]).toHaveProperty('className', expect.stringContaining('vv-right-gutter'));
  });

  it('keeps all slot content structurally outside the figure SVG (export discipline)', async () => {
    const { container } = render(
      <GeneGlyph
        transcript={transcript}
        protein={protein}
        tracks={[exonTrack({}), interProTrack({ groups: ['family'] })]}
      >
        <GeneGlyph.Header>
          <span data-testid="hdr-marker">HDR</span>
        </GeneGlyph.Header>
        <GeneGlyph.LeftGutter width={32}>
          {() => <span data-testid="lg-marker">LG</span>}
        </GeneGlyph.LeftGutter>
        <GeneGlyph.RightGutter width={32}>
          {() => <span data-testid="rg-marker">RG</span>}
        </GeneGlyph.RightGutter>
        <GeneGlyph.Footer>
          <span data-testid="ftr-marker">FTR</span>
        </GeneGlyph.Footer>
      </GeneGlyph>,
    );
    await flushLoads();
    const svg = container.querySelector<SVGSVGElement>('svg.vv-figure')!;
    expect(svg.querySelector('[data-testid="hdr-marker"]')).toBeNull();
    expect(svg.querySelector('[data-testid="lg-marker"]')).toBeNull();
    expect(svg.querySelector('[data-testid="rg-marker"]')).toBeNull();
    expect(svg.querySelector('[data-testid="ftr-marker"]')).toBeNull();
    // The markers exist somewhere in the rendered tree — just not inside the SVG.
    expect(container.querySelector('[data-testid="hdr-marker"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="lg-marker"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="rg-marker"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="ftr-marker"]')).not.toBeNull();
  });
});
