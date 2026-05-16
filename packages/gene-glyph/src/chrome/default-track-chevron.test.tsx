import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { DefaultTrackChevron } from './default-track-chevron.js';
import type { GutterItem } from '../viewer.js';

function groupItem(overrides: Partial<GutterItem> = {}): GutterItem {
  return {
    kind: 'group',
    id: 'domains',
    label: 'Domains',
    rect: { yTop: 0, yBottom: 24 },
    didTruncate: false,
    droppedCount: 0,
    ...overrides,
  };
}

describe('DefaultTrackChevron', () => {
  it('renders the item label and reports the expanded state via aria-expanded', () => {
    const { getByTestId } = render(
      <DefaultTrackChevron item={groupItem()} collapsed={false} onToggle={() => {}} />,
    );
    const btn = getByTestId('gene-glyph-chevron-domains');
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    expect(btn).toHaveTextContent('Domains');
  });

  it('flips aria-expanded when collapsed and surfaces the collapsed data attribute', () => {
    const { getByTestId } = render(
      <DefaultTrackChevron item={groupItem()} collapsed={true} onToggle={() => {}} />,
    );
    const btn = getByTestId('gene-glyph-chevron-domains');
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(btn).toHaveAttribute('data-vv-collapsed');
  });

  it('fires onToggle on click', () => {
    const onToggle = vi.fn();
    const { getByTestId } = render(
      <DefaultTrackChevron item={groupItem()} collapsed={false} onToggle={onToggle} />,
    );
    fireEvent.click(getByTestId('gene-glyph-chevron-domains'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('falls back to item.id when no label is set', () => {
    const item = groupItem({ kind: 'track', id: 'pfam', label: undefined });
    const { getByTestId } = render(
      <DefaultTrackChevron item={item} collapsed={false} onToggle={() => {}} />,
    );
    expect(getByTestId('gene-glyph-chevron-pfam')).toHaveTextContent('pfam');
  });

  it('accepts a custom label override', () => {
    const { getByTestId } = render(
      <DefaultTrackChevron
        item={groupItem()}
        collapsed={false}
        onToggle={() => {}}
        label="Custom label"
      />,
    );
    expect(getByTestId('gene-glyph-chevron-domains')).toHaveTextContent('Custom label');
  });
});
