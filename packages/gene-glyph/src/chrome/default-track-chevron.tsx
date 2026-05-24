import type { ReactNode } from 'react';
import type { GutterItem } from '../viewer.js';

export interface DefaultTrackChevronProps {
  /** The gutter item this chevron toggles. Used for the label, the
   *  `aria-controls` link to the corresponding track group, and to scope
   *  `data-vv-item-id` for tests. */
  item: GutterItem;
  /** Whether the corresponding track/group is currently collapsed (hidden
   *  from the figure). The host owns this state; the chevron only renders
   *  the toggle UI. */
  collapsed: boolean;
  /** Fires on click or Enter/Space when the chevron is focused. The host
   *  flips `collapsed` and updates its `tracks` prop accordingly. */
  onToggle: () => void;
  /** Optional override for the visible label. Defaults to `item.label` for
   *  groups and `item.id` for tracks. */
  label?: ReactNode;
}

/**
 * Slice 20 — chrome convenience component for the LeftGutter. Renders a
 * single chevron button with the item's label; the host wires the collapse
 * state and the matching `tracks` edit.
 *
 * The chevron is purely presentational — it has no opinion about how the
 * host implements collapsing. The canonical pattern (RD-1110) is for
 * `onToggle` to call into the viewer's collapse API — either through the
 * imperative ref (`viewerRef.current?.toggleGroup(item.id)`) or by
 * updating the host's mirror of `collapsedGroupIds` — rather than editing
 * the `tracks` prop. Wrapping the detail tracks in a `TrackGroup` with a
 * `summaryTrack` then lets the figure swap the stacked detail for a
 * one-row summary while the chevron is in the folded state, instead of
 * removing the rows entirely.
 *
 * Built using only the public API.
 */
export function DefaultTrackChevron({
  item,
  collapsed,
  onToggle,
  label,
}: DefaultTrackChevronProps) {
  const display = label ?? item.label ?? item.id;
  return (
    <button
      type="button"
      className="vv-default-chevron"
      data-vv-item-id={item.id}
      data-vv-item-kind={item.kind}
      data-vv-collapsed={collapsed ? '' : undefined}
      data-testid={`gene-glyph-chevron-${item.id}`}
      aria-expanded={!collapsed}
      aria-controls={`gene-glyph-item-${item.id}`}
      onClick={onToggle}
    >
      <span className="vv-default-chevron-icon" aria-hidden>
        <svg viewBox="0 0 12 12" width="10" height="10">
          <path d="M3 2 L8 6 L3 10" />
        </svg>
      </span>
      <span className="vv-default-chevron-label">{display}</span>
    </button>
  );
}
