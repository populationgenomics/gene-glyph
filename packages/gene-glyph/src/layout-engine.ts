import {
  isTrackGroup,
  type Track,
  type TrackGroup,
  type TrackHeightResult,
  type TrackOrGroup,
  type TrackRect,
  type Viewport,
} from './types.js';

export interface LayoutItem {
  kind: 'track' | 'group';
  id: string;
  /** Label, set from `TrackGroup.label` for groups and from `Track.label`
   *  for tracks (optional on tracks). Surfaced via gutter slots so hosts
   *  can render group + sub-track labels (e.g. multi-level InterPro
   *  nesting) without re-walking the input track list. */
  label?: string;
  rect: TrackRect;
  didTruncate: boolean;
  droppedCount: number;
  /** Group members, populated when `kind === 'group'`. Recursive — a
   *  group's children may themselves be groups (RD-1110 follow-up). */
  children?: LayoutItem[];
  /** For groups: vertical pixels reserved at the top of the group's
   *  extent for its label slot (mirrors {@link TrackGroup.headerHeight}).
   *  The gutter uses this to size the parent's chevron cell so it
   *  doesn't overlap the first child's cell. Undefined / 0 means flush
   *  layout (the parent's label shares the first child's row). */
  headerHeight?: number;
}

export interface LayoutResult {
  totalHeight: number;
  items: LayoutItem[];
  /** Flat lookup from track id -> rect, including tracks inside nested
   *  groups. */
  trackRects: Map<string, TrackRect>;
}

export interface LayoutEngineArgs {
  tracks: TrackOrGroup[];
  viewport: Viewport;
  data: Map<string, unknown>;
  totalHeightBudget: number;
  /** Top y-coordinate to lay the first track from. Defaults to 0. */
  yStart?: number;
  /** Group ids that should render as folded. When a folded group carries
   *  a {@link TrackGroup.summaryTrack} the engine lays out the summary
   *  track in its place; when it doesn't, the group contributes zero
   *  height (today's "remove rows" semantics). Consulted at every level
   *  of nesting, so a parent group can be expanded while one of its
   *  child groups is folded. */
  collapsedGroupIds?: ReadonlySet<string>;
}

/**
 * Negotiate vertical layout by walking items top-to-bottom and offering each
 * the remaining height as `hint.maxPx`. Tracks return their actual height plus
 * whether they truncated; groups recurse over their sub-entries (which may
 * themselves be groups) within their own optionally-explicit `heightBudget`.
 */
export function layoutTracks(args: LayoutEngineArgs): LayoutResult {
  const { tracks, viewport, data, totalHeightBudget } = args;
  const yStart = args.yStart ?? 0;
  const collapsedGroupIds = args.collapsedGroupIds ?? EMPTY_COLLAPSED_SET;
  const trackRects = new Map<string, TrackRect>();
  const walked = walkEntries(tracks, viewport, data, yStart, totalHeightBudget, collapsedGroupIds, trackRects);
  return { totalHeight: walked.consumed, items: walked.items, trackRects };
}

interface WalkResult {
  items: LayoutItem[];
  /** Pixels consumed by this walk. The caller uses this to advance `y`
   *  and decrement its remaining budget. */
  consumed: number;
  /** Whether the walk had to stop before laying out every entry (out of
   *  budget). Surfaces as `didTruncate` on the enclosing group item. */
  truncated: boolean;
  droppedTotal: number;
}

function walkEntries(
  entries: TrackOrGroup[],
  viewport: Viewport,
  data: Map<string, unknown>,
  yStart: number,
  budget: number,
  collapsedGroupIds: ReadonlySet<string>,
  trackRects: Map<string, TrackRect>,
): WalkResult {
  const items: LayoutItem[] = [];
  let y = yStart;
  let remaining = budget;
  let truncated = false;
  let droppedTotal = 0;

  for (const entry of entries) {
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    if (isTrackGroup(entry)) {
      const gap = entry.gapAbove ?? 0;
      // Gaps eat budget upfront so a group flush against the previous
      // row doesn't crowd its label / chevron — same as the pre-nesting
      // behaviour.
      y += gap;
      remaining -= gap;
      if (remaining <= 0) {
        truncated = true;
        break;
      }
      const groupBudget = Math.min(entry.heightBudget ?? remaining, remaining);
      const groupRes = layoutGroup(
        entry,
        viewport,
        data,
        y,
        groupBudget,
        collapsedGroupIds,
        trackRects,
      );
      items.push(groupRes.item);
      const consumed = groupRes.item.rect.yBottom - groupRes.item.rect.yTop;
      y += consumed;
      remaining -= consumed;
      droppedTotal += groupRes.item.droppedCount;
      if (groupRes.item.didTruncate) truncated = true;
    } else {
      const gap = entry.gapAbove ?? 0;
      if (gap > 0) {
        y += gap;
        remaining -= gap;
        if (remaining <= 0) {
          truncated = true;
          break;
        }
      }
      const r = layoutTrack(entry, viewport, data, y, remaining);
      items.push(r.item);
      trackRects.set(entry.id, r.item.rect);
      const consumed = r.item.rect.yBottom - r.item.rect.yTop;
      y += consumed;
      remaining -= consumed;
      droppedTotal += r.item.droppedCount;
      if (r.item.didTruncate) truncated = true;
    }
  }

  return { items, consumed: y - yStart, truncated, droppedTotal };
}

function layoutTrack(
  track: Track,
  viewport: Viewport,
  data: Map<string, unknown>,
  yTop: number,
  budget: number,
): { item: LayoutItem } {
  const result: TrackHeightResult = track.height({
    data: (data.get(track.id) ?? null) as never,
    viewport,
    hint: { maxPx: Math.max(0, budget) },
  });
  const px = Math.max(0, Math.min(result.px, budget));
  const item: LayoutItem = {
    kind: 'track',
    id: track.id,
    label: track.label,
    rect: { yTop, yBottom: yTop + px },
    didTruncate: result.didTruncate || px < result.px,
    droppedCount: result.droppedCount ?? 0,
  };
  return { item };
}

const EMPTY_COLLAPSED_SET: ReadonlySet<string> = new Set<string>();

function layoutGroup(
  group: TrackGroup,
  viewport: Viewport,
  data: Map<string, unknown>,
  yTop: number,
  budget: number,
  collapsedGroupIds: ReadonlySet<string>,
  trackRects: Map<string, TrackRect>,
): { item: LayoutItem } {
  const collapsed = collapsedGroupIds.has(group.id);
  // When the group is folded the engine walks the summary track in place
  // of the detail stack. Without a summary track a folded group simply
  // contributes its header row (the parent chevron stays reachable even
  // with no body to paint). Nesting is unbounded: a folded parent skips
  // its sub-groups entirely; an expanded parent passes through to walk
  // its child entries, each of which consults `collapsedGroupIds`
  // independently.
  const effective: TrackOrGroup[] = collapsed
    ? group.summaryTrack
      ? [group.summaryTrack]
      : []
    : group.tracks;

  // Reserve a label row at the top of the group's extent so the gutter
  // can render the chevron + label above the first child without
  // overlapping it. Only takes effect when the group is *expanded*: a
  // folded group's body is a single-row summary (or nothing), and
  // pushing the summary down by the header would leave dead space
  // above it instead of letting the label + strip share the row.
  const headerHeight = Math.max(0, group.headerHeight ?? 0);
  const headerConsumed = collapsed ? 0 : Math.min(headerHeight, budget);
  const remainingBudget = Math.max(0, budget - headerConsumed);
  const bodyYStart = yTop + headerConsumed;

  const walked = walkEntries(
    effective,
    viewport,
    data,
    bodyYStart,
    remainingBudget,
    collapsedGroupIds,
    trackRects,
  );

  return {
    item: {
      kind: 'group',
      id: group.id,
      label: group.label,
      rect: { yTop, yBottom: bodyYStart + walked.consumed },
      didTruncate: walked.truncated,
      droppedCount: walked.droppedTotal,
      children: walked.items,
      headerHeight: headerConsumed,
    },
  };
}
