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
    {
      aaStart: 60,
      aaEnd: 90,
      source: 'InterPro',
      sourceId: 'IPR0002',
      shortName: 'D1',
      description: 'Domain 1',
      entryType: 'domain',
    },
  ],
};

async function flushLoads() {
  // Two layers of async resolution to settle: (1) track.load() returns its
  // Promise; (2) Promise.all collects; (3) setState lands; (4) layout
  // recomputes with the new data, which is itself a useMemo derived from
  // trackData state. Five microtask ticks is comfortable headroom and lets
  // both the initial empty layout and the data-loaded layout commit.
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

describe('GeneGlyph.LeftGutter slot', () => {
  it('renders nothing in the gutter region when no slot child is provided', async () => {
    const { container } = render(
      <GeneGlyph
        transcript={transcript}
        protein={protein}
        tracks={[exonTrack({}), interProTrack({ groups: ['family'] })]}
      />,
    );
    await flushLoads();
    expect(container.querySelector('[data-testid="gene-glyph-left-gutter"]')).toBeNull();
  });

  it('calls the render-prop once per visible track and group, with rect info', async () => {
    const seen: GutterItem[] = [];
    const { container } = render(
      <GeneGlyph
        transcript={transcript}
        protein={protein}
        tracks={[
          exonTrack({}),
          interProTrack({ groups: ['family', 'domain'] }),
        ]}
      >
        <GeneGlyph.LeftGutter width={64}>
          {(item) => {
            seen.push(item);
            return <span data-testid={`row-${item.kind}-${item.id}`}>{item.label ?? item.id}</span>;
          }}
        </GeneGlyph.LeftGutter>
      </GeneGlyph>,
    );
    await flushLoads();

    const gutter = container.querySelector('[data-testid="gene-glyph-left-gutter"]');
    expect(gutter).not.toBeNull();

    const ids = seen.map((s) => `${s.kind}:${s.id}`);
    expect(ids).toContain('track:exon-track');
    expect(ids).toContain('group:interpro');
    expect(ids).toContain('track:interpro-family');
    expect(ids).toContain('track:interpro-domain');

    // `seen` accumulates across every render — initial-empty + post-load — so
    // inspect the most recent group item, which reflects the settled layout.
    const groupCalls = seen.filter((s) => s.kind === 'group' && s.id === 'interpro');
    const latestGroup = groupCalls[groupCalls.length - 1]!;
    expect(latestGroup.label).toBe('InterPro');
    expect(latestGroup.rect.yBottom).toBeGreaterThan(latestGroup.rect.yTop);
  });

  it('reserves the requested width on the gutter wrapper', async () => {
    const { container } = render(
      <GeneGlyph
        transcript={transcript}
        protein={protein}
        tracks={[exonTrack({}), interProTrack({ groups: ['family'] })]}
      >
        <GeneGlyph.LeftGutter width={88}>
          {() => <span>row</span>}
        </GeneGlyph.LeftGutter>
      </GeneGlyph>,
    );
    await flushLoads();
    const gutter = container.querySelector<HTMLDivElement>('[data-testid="gene-glyph-left-gutter"]');
    expect(gutter?.style.width).toBe('88px');
  });
});
