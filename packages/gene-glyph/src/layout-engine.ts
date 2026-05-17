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
  /** Group members, populated when `kind === 'group'`. */
  children?: LayoutItem[];
}

export interface LayoutResult {
  totalHeight: number;
  items: LayoutItem[];
  /** Flat lookup from track id -> rect, including tracks inside groups. */
  trackRects: Map<string, TrackRect>;
}

export interface LayoutEngineArgs {
  tracks: TrackOrGroup[];
  viewport: Viewport;
  data: Map<string, unknown>;
  totalHeightBudget: number;
  /** Top y-coordinate to lay the first track from. Defaults to 0. */
  yStart?: number;
}

/**
 * Negotiate vertical layout by walking items top-to-bottom and offering each
 * the remaining height as `hint.maxPx`. Tracks return their actual height plus
 * whether they truncated; groups recurse over their sub-tracks within their
 * own (optionally explicit) heightBudget.
 */
export function layoutTracks(args: LayoutEngineArgs): LayoutResult {
  const { tracks, viewport, data, totalHeightBudget } = args;
  const yStart = args.yStart ?? 0;
  const items: LayoutItem[] = [];
  const trackRects = new Map<string, TrackRect>();

  let y = yStart;
  let remaining = totalHeightBudget;

  for (const item of tracks) {
    if (isTrackGroup(item)) {
      const groupBudget = Math.min(item.heightBudget ?? remaining, remaining);
      const gap = item.gapAbove ?? 0;
      y += gap;
      remaining -= gap;
      const groupRes = layoutGroup(item, viewport, data, y, groupBudget);
      items.push(groupRes.item);
      for (const [id, rect] of groupRes.trackRects) trackRects.set(id, rect);
      const consumed = groupRes.item.rect.yBottom - groupRes.item.rect.yTop;
      y += consumed;
      remaining -= consumed;
    } else {
      const r = layoutTrack(item, viewport, data, y, remaining);
      items.push(r.item);
      trackRects.set(item.id, r.item.rect);
      const consumed = r.item.rect.yBottom - r.item.rect.yTop;
      y += consumed;
      remaining -= consumed;
    }
    if (remaining <= 0) break;
  }

  return { totalHeight: y - yStart, items, trackRects };
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

function layoutGroup(
  group: TrackGroup,
  viewport: Viewport,
  data: Map<string, unknown>,
  yTop: number,
  budget: number,
): { item: LayoutItem; trackRects: Map<string, TrackRect> } {
  const children: LayoutItem[] = [];
  const trackRects = new Map<string, TrackRect>();
  let y = yTop;
  let remaining = budget;
  let groupTruncated = false;
  let droppedTotal = 0;

  for (const sub of group.tracks) {
    if (remaining <= 0) {
      groupTruncated = true;
      break;
    }
    const r = layoutTrack(sub, viewport, data, y, remaining);
    children.push(r.item);
    trackRects.set(sub.id, r.item.rect);
    if (r.item.didTruncate) groupTruncated = true;
    droppedTotal += r.item.droppedCount;
    const consumed = r.item.rect.yBottom - r.item.rect.yTop;
    y += consumed;
    remaining -= consumed;
  }

  return {
    item: {
      kind: 'group',
      id: group.id,
      label: group.label,
      rect: { yTop, yBottom: y },
      didTruncate: groupTruncated,
      droppedCount: droppedTotal,
      children,
    },
    trackRects,
  };
}
