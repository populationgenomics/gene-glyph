import { act, fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GeneGlyph } from './viewer.js';
import { exonTrack } from './tracks/exon-track.js';
import { segmentBandTrack } from './tracks/segment-band-track.js';
import { variantTrack } from './tracks/variant-track.js';
import type { Track, Transcript, ViewerVariant } from './types.js';

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
  {
    id: 'cited',
    label: 'Cited',
    coord: { kind: 'cds', cPos: 50, offset: 0 },
    category: 'missense',
  },
  {
    id: 'plain',
    label: 'Plain',
    coord: { kind: 'cds', cPos: 150, offset: 0 },
    category: 'nonsense',
  },
  {
    id: 'far-cited',
    label: 'Far cited',
    coord: { kind: 'genomic', chr: 'chr2', pos: 5 },
    category: 'other',
  },
  {
    id: 'far-plain',
    label: 'Far plain',
    coord: { kind: 'genomic', chr: 'chr2', pos: 6 },
    category: 'other',
  },
];

const bands = segmentBandTrack({
  id: 'bands',
  source: [
    { id: 'band-cited', start: 10, end: 20, category: 'a' },
    { id: 'band-plain', start: 30, end: 40, category: 'a' },
  ],
  coordSystem: 'cds',
  palette: { a: '#000' },
});

async function renderMap(props: {
  onFeatureClick?: (featureId: string, trackId: string) => void;
  isFeatureClickable?: (featureId: string, trackId: string) => boolean;
}) {
  const view = render(
    <GeneGlyph
      transcript={transcript}
      tracks={[exonTrack({}), variantTrack({ id: 'variants', source: variants }), bands]}
      {...props}
    />,
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  const feature = (id: string) =>
    view.container.querySelector<HTMLElement>(`[data-vv-feature-id="${id}"]`)!;
  return { ...view, feature };
}

const citedOnly = (featureId: string) => featureId.includes('cited');

describe('GeneGlyph — per-feature clickability', () => {
  it.each(['cited', 'band-cited'])(
    'makes %s, which the host lets be clicked, a button with a tab stop',
    async (id) => {
      const { feature } = await renderMap({
        onFeatureClick: vi.fn(),
        isFeatureClickable: citedOnly,
      });
      expect(feature(id).getAttribute('role')).toBe('button');
      expect(feature(id).getAttribute('tabindex')).toBe('0');
      expect(feature(id).classList.contains('is-clickable')).toBe(true);
    },
  );

  it('keeps a variant tick the host does not let be clicked a tab stop, not a button', async () => {
    const { feature } = await renderMap({ onFeatureClick: vi.fn(), isFeatureClickable: citedOnly });
    expect(feature('plain').getAttribute('tabindex')).toBe('0');
    expect(feature('plain').hasAttribute('role')).toBe(false);
  });

  it('puts a button in an unplaced chip the host lets be clicked', async () => {
    const onFeatureClick = vi.fn();
    const { feature } = await renderMap({ onFeatureClick, isFeatureClickable: citedOnly });
    expect(feature('far-cited').hasAttribute('role')).toBe(false);
    const button = feature('far-cited').querySelector('button')!;
    fireEvent.click(button);
    expect(onFeatureClick).toHaveBeenCalledWith('far-cited', 'variants');
  });

  it('gives an unplaced chip the host keeps unclickable a focusable control, not a button', async () => {
    const { feature } = await renderMap({ onFeatureClick: vi.fn(), isFeatureClickable: citedOnly });
    expect(feature('far-plain').querySelector('button')).toBeNull();
    const control = feature('far-plain').querySelector('.vv-unplaced-chip-control')!;
    expect(control.getAttribute('tabindex')).toBe('0');
  });

  it.each(['plain', 'band-plain'])(
    'leaves %s, which the host does not let be clicked, without button semantics',
    async (id) => {
      const onFeatureClick = vi.fn();
      const { feature } = await renderMap({ onFeatureClick, isFeatureClickable: citedOnly });
      expect(feature(id).hasAttribute('role')).toBe(false);
      expect(feature(id).classList.contains('is-clickable')).toBe(false);
      fireEvent.click(feature(id));
      fireEvent.keyDown(feature(id), { key: 'Enter' });
      expect(onFeatureClick).not.toHaveBeenCalled();
    },
  );

  it('keeps a feature the host does not let be clicked hoverable', async () => {
    const onHover = vi.fn();
    const view = render(
      <GeneGlyph
        transcript={transcript}
        tracks={[exonTrack({}), variantTrack({ id: 'variants', source: variants })]}
        onFeatureClick={vi.fn()}
        isFeatureClickable={citedOnly}
        onHover={onHover}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.mouseEnter(view.container.querySelector('[data-vv-feature-id="plain"]')!);
    expect(onHover).toHaveBeenCalledWith('plain', 'variants');
  });

  it.each([
    ['Enter', 'cited', 'variants'],
    [' ', 'cited', 'variants'],
    [' ', 'band-cited', 'bands'],
  ])('activates on the %j key (%s)', async (key, id, trackId) => {
    const onFeatureClick = vi.fn();
    const { feature } = await renderMap({ onFeatureClick, isFeatureClickable: citedOnly });
    fireEvent.keyDown(feature(id), { key });
    expect(onFeatureClick).toHaveBeenCalledWith(id, trackId);
  });

  it('makes every feature clickable when only onFeatureClick is given', async () => {
    const { feature } = await renderMap({ onFeatureClick: vi.fn() });
    expect(feature('plain').getAttribute('role')).toBe('button');
  });

  it('makes no feature a button without onFeatureClick', async () => {
    const { container } = await renderMap({});
    expect(container.querySelectorAll('[data-vv-feature-id][role="button"]')).toHaveLength(0);
  });
});

describe('GeneGlyph — clicks from tracks that ignore isFeatureClickable', () => {
  it('does not report a click on a feature the host keeps unclickable', async () => {
    const onFeatureClick = vi.fn();
    const naive: Track<unknown, { ready: true }> = {
      id: 'naive',
      coordSystem: 'cds',
      heightPolicy: 'fixed',
      load: async () => ({ ready: true }),
      height: () => ({ px: 10, didTruncate: false }),
      render: ({ onFeatureClick: click }) => (
        <g>
          <rect data-testid="naive-plain" onClick={() => click?.('plain')} />
          <rect data-testid="naive-cited" onClick={() => click?.('cited')} />
        </g>
      ),
      toJSON: () => ({}),
    };
    const view = render(
      <GeneGlyph
        transcript={transcript}
        tracks={[naive]}
        onFeatureClick={onFeatureClick}
        isFeatureClickable={citedOnly}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(view.getByTestId('naive-plain'));
    fireEvent.click(view.getByTestId('naive-cited'));
    expect(onFeatureClick.mock.calls).toEqual([['cited', 'naive']]);
  });
});
