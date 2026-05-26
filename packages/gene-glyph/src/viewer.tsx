/* eslint-disable react-hooks/refs */
import {
  Children,
  forwardRef,
  isValidElement,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type ForwardRefExoticComponent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  type RefAttributes,
} from 'react';
import { createCoordinateMapper } from './coordinate-mapper.js';
import { layoutTracks, type LayoutItem } from './layout-engine.js';
import { createSvgPainter } from './painter/svg-painter.js';
import { exonTrack } from './tracks/exon-track.js';
import {
  isTrackGroup,
  type BaselineGeometry,
  type CollapsedRegion,
  type HiddenFeatureBucket,
  type InteractionMode,
  type InteractionState,
  type ProteinAnnotations,
  type Track,
  type TooltipRenderArgs,
  type TrackLoadState,
  type TrackOrGroup,
  type TrackRect,
  type Transcript,
  type ViewMode,
  type ViewportChangeReason,
} from './types.js';
import { defaultCollapsedRegions } from './coordinate-mapper.js';
import {
  DEFAULT_MAX_ZOOM,
  ViewportController,
} from './viewport.js';
import { useViewportInteractions } from './use-viewport-interactions.js';
import {
  exportSvgString,
  exportPngBlob,
  type ExportArgs,
} from './export.js';

export interface GeneGlyphProps {
  transcript: Transcript;
  protein?: ProteinAnnotations | null;
  /** Track list, ordered top to bottom. Defaults to a single `exonTrack`. */
  tracks?: TrackOrGroup[];
  /** Logical width of the figure SVG in viewBox units. Default 1000. */
  width?: number;
  /** Controlled view mode. When supplied, the viewer renders against this
   *  mode and fires `onModeChange` for chrome-driven mode requests without
   *  mutating local state. */
  mode?: ViewMode;
  /** Uncontrolled initial mode. Ignored when `mode` is supplied. Default
   *  `genome`. */
  defaultMode?: ViewMode;
  /** Fires after every committed mode change (controlled or uncontrolled).
   *  Hosts use this to mirror the mode into URL state, telemetry, or the
   *  current `<select>` element. */
  onModeChange?: (mode: ViewMode) => void;
  /** Maximum vertical height budget for the track stack. Default 200. */
  trackHeightBudget?: number;
  /** Controlled-prop: feature id currently hovered by the host (e.g., from a
   *  table row). Tracks render the matching feature with a hover lift. */
  hoveredFeatureId?: string | null;
  /** Controlled-prop: feature ids currently selected by the host. Tracks
   *  render the matching features with a selection ring. Accepts a Set or any
   *  iterable for ergonomic callers. */
  selectedFeatureIds?: ReadonlySet<string> | Iterable<string>;
  /** Controlled brush range. When supplied, the viewer renders the brush
   *  overlay against this range and fires `onBrushChange` for shift+drag
   *  gestures instead of mutating local state. Range is in current-mode ruler
   *  coords (CDS bp in CDS modes, aa in protein). `null` clears the brush. */
  brushRange?: readonly [number, number] | null;
  /** Initial brush range for uncontrolled use. Default `null` (no brush). */
  defaultBrushRange?: readonly [number, number] | null;
  /** Fires after every committed brush mutation (gesture or imperative). The
   *  range is `null` when the brush is cleared (shift-click without drag, or a
   *  programmatic clear). */
  onBrushChange?: (range: readonly [number, number] | null) => void;
  /** Fires when the cursor enters a feature (with featureId) or leaves all
   *  features (`null`). The originating track id is passed for hosts that
   *  multiplex over tracks. */
  onHover?: (featureId: string | null, trackId: string) => void;
  /** Fires when a feature is clicked. */
  onFeatureClick?: (featureId: string, trackId: string) => void;
  /** Host-supplied tooltip renderer. When provided, the viewer shows an
   *  overlay anchored to the hovered feature with the host's content. When
   *  omitted, the viewer falls back to its built-in label tooltip (driven by
   *  {@link Track.featureLabel}). Return `null` to suppress the tooltip for a
   *  given feature without disabling the system. Slice 17. */
  renderTooltip?: (args: TooltipRenderArgs) => ReactNode | null;
  /** Fires when a track transitions between load states. Hosts can mirror
   *  this into their own loading UI / telemetry; the viewer renders its own
   *  default shimmer regardless. Slice 18. */
  onTrackStateChange?: (trackId: string, state: TrackLoadState) => void;
  /** Debounce for viewport-driven re-loads, in ms. The viewer marks tracks
   *  stale immediately on viewport change, then fires `track.load()` after
   *  this delay so rapid pan/zoom doesn't thrash the upstream adapter.
   *  Default 120ms (design §6.2). Slice 18. */
  loadDebounceMs?: number;
  /** Default-binding profile. `'standard'` enables drag/wheel/pinch/keyboard;
   *  `'embed'` skips Cmd/Ctrl + wheel-zoom so the viewer doesn't fight a
   *  scrolling host page; `'fullscreen'` is reserved for later expansion.
   *  Default `'standard'`. */
  interactionMode?: InteractionMode;
  /** Controlled visible ruler range (CDS bp in CDS modes, aa in protein).
   *  When supplied, the viewer renders against this range and fires
   *  `onViewportChange` for gestures without mutating local state. */
  viewportRange?: readonly [number, number];
  /** Initial range for uncontrolled use. Default = natural fit-gene range. */
  defaultViewportRange?: readonly [number, number];
  /** Fires after every committed range mutation (gesture or imperative). The
   *  `reason` tag lets hosts distinguish user gestures from programmatic
   *  changes. */
  onViewportChange?: (
    range: readonly [number, number],
    reason: ViewportChangeReason,
  ) => void;
  /** Most zoomed-out state. Defaults to fit-gene + ~5% padding. */
  minZoom?: number;
  /** Most zoomed-in state. Defaults to `DEFAULT_MAX_ZOOM` (200×). */
  maxZoom?: number;
  /** Soft-collapse spec: regions of the gene rendered at a fixed pixel
   *  budget while the surrounding linear regions scale with zoom. The
   *  default is `defaultCollapsedRegions(transcript)` — one region per
   *  intron compressing everything except the 10bp splice-site flanks
   *  on each side, which gives the out-of-box `genome` mode its
   *  splice-site-aware zoom behaviour. Hosts override to expand
   *  specific deep-intronic regions (omit the range from the spec) or
   *  compress UTRs (add a range covering exonic UTR bp). Effective in
   *  `genome` mode; in `transcript` and `protein` modes intronic
   *  entries are subsumed by hard collapse. */
  collapsedRegions?: CollapsedRegion[];
  className?: string;
  /** Controlled set of folded group ids. When supplied, the viewer reads
   *  fold state from this prop and fires `onCollapsedGroupChange` for
   *  chevron clicks / imperative calls without mutating local state.
   *  RD-1110. */
  collapsedGroupIds?: ReadonlySet<string> | Iterable<string>;
  /** Initial set of folded groups for uncontrolled use. Ignored when
   *  `collapsedGroupIds` is supplied. */
  defaultCollapsedGroupIds?: Iterable<string>;
  /** Fires after every committed change to the folded-group set
   *  (controlled or uncontrolled). RD-1110. */
  onCollapsedGroupChange?: (next: ReadonlySet<string>) => void;
  /** Compound-component slots: `GeneGlyph.Header`, `GeneGlyph.Footer`,
   *  `GeneGlyph.LeftGutter`, `GeneGlyph.RightGutter`. Slots are rendered as
   *  React DOM siblings of the figure SVG (header/footer above/below; gutters
   *  flanking it left/right) so they're structurally excluded from any future
   *  `exportSVG()`. Children that don't match a slot type are ignored. */
  children?: ReactNode;
}

/** Item info delivered to gutter render-props, once per visible layout entry
 *  (tracks + groups). The viewer recomputes this on every layout change so
 *  hosts always see fresh rects. */
export interface GutterItem {
  kind: 'track' | 'group';
  id: string;
  /** Group label when `kind === 'group'`; undefined for tracks. */
  label?: string;
  rect: TrackRect;
  didTruncate: boolean;
  droppedCount: number;
  /** Zero-based nesting depth. Top-level entries are at depth 0; entries
   *  inside one nested group are at depth 1; and so on. Hosts use this to
   *  indent the gutter so nested groups read as a hierarchy without the
   *  host having to re-walk the track tree. */
  depth: number;
  /** For groups with a {@link TrackGroup.headerHeight} reservation: the
   *  height of the label row inside the group's vertical extent. The
   *  viewer sizes the gutter cell to this when set, so the parent
   *  chevron sits in its own slot rather than overlapping its first
   *  child's cell. Undefined / 0 means the cell spans the group's full
   *  extent (flush layout, matching pre-RD-1110-followup behaviour). */
  headerHeight?: number;
}

export interface LeftGutterProps {
  /** Pixel width reserved for the gutter to the left of the figure SVG. */
  width: number;
  /** Render-prop invoked once per visible track and group. Return `null` to
   *  skip an item; the gutter rows are positioned by the viewer. */
  children: (item: GutterItem) => ReactNode;
}

export function LeftGutter(_props: LeftGutterProps): null {
  // Slot marker only. The viewer reads `props` directly off the element it
  // matches against the `LeftGutter` type and renders the gutter chrome.
  return null;
}
LeftGutter.displayName = 'GeneGlyph.LeftGutter';

export interface RightGutterProps {
  /** Pixel width reserved for the gutter to the right of the figure SVG. */
  width: number;
  /** Render-prop invoked once per visible track and group. Return `null` to
   *  skip an item; the gutter rows are positioned by the viewer. */
  children: (item: GutterItem) => ReactNode;
}

export function RightGutter(_props: RightGutterProps): null {
  return null;
}
RightGutter.displayName = 'GeneGlyph.RightGutter';

export interface HeaderProps {
  /** Optional pixel min-height reserved for the header. Keeps the header row
   *  stable when its content changes (e.g., dropdowns that grow). */
  height?: number;
  children?: ReactNode;
}

export function Header(_props: HeaderProps): null {
  return null;
}
Header.displayName = 'GeneGlyph.Header';

export interface FooterProps {
  /** Optional pixel min-height reserved for the footer. */
  height?: number;
  children?: ReactNode;
}

export function Footer(_props: FooterProps): null {
  return null;
}
Footer.displayName = 'GeneGlyph.Footer';

/** Target for `GeneGlyphRef.fitTo`. Slice 8 lands `gene`, `feature`, and
 *  `range`; Slice 16 adds `selection` which reads the active brush range. */
export type FitTarget =
  | { kind: 'gene' }
  | { kind: 'feature'; trackId: string; featureId: string }
  | { kind: 'range'; range: readonly [number, number] }
  | { kind: 'selection' };

/** Snapshot of viewport state returned by `getViewportInfo()`. `range` is
 *  the currently committed viewport range; `zoom` is derived from it.
 *  `naturalRange` and `transcript` are stable across pan/zoom and are
 *  surfaced here so chrome built on top of the ref (e.g.,
 *  `<DefaultMinimap>`) can render the full-gene context without the host
 *  having to thread the transcript through a separate prop. Slice 20. */
export interface ViewportInfo {
  mode: ViewMode;
  range: readonly [number, number];
  zoom: number;
  layout: ReadonlyArray<LayoutItem>;
  /** Fit-gene range for the active mode (CDS bp in CDS modes, aa in
   *  protein). Stable until the mode changes; chrome uses it as the
   *  thumbnail's coordinate span. */
  naturalRange: readonly [number, number];
  /** Canonical viewport state in baseline (display) coords: `[S_lo, S_hi]`
   *  in fit-gene baseline pixels. Surfaced here so chrome (minimaps,
   *  overview tracks) can compute the bounds rectangle without going
   *  through the ruler — which would snap to the gap boundary whenever
   *  an endpoint of the visible window crossed a fixed-budget gap. */
  baselineWindow: readonly [number, number];
  /** Figure's baseline geometry. Chrome that maintains a separately-
   *  scaled baseline (e.g., `DefaultMinimap` at its own width) uses this
   *  to translate figure-baseline positions into its own baseline via a
   *  segment-by-segment proportional walk — instead of going through the
   *  ruler, which snaps inside fixed-budget gaps. */
  baselineGeometry: BaselineGeometry;
  /** Live zoom scale (multiplier on flexible piece figure widths to get
   *  display widths). Constant under pan. Chrome that renders at the
   *  current layout scale (e.g., display-space minimap thumbnails) uses
   *  this together with {@link displayOffset} and {@link totalDisplayWidth}
   *  to size and place its content. */
  zoomScale: number;
  /** Layout display-x of the figure's first piece relative to viewport-x
   *  0. Pan modifies only this. */
  displayOffset: number;
  /** Total display width of the laid-out figure at the current zoom. */
  totalDisplayWidth: number;
  /** Viewport pixel width — the figure SVG's viewBox width. The brush
   *  rectangle of a display-space minimap is exactly this many layout
   *  pixels wide regardless of zoom. */
  viewportWidth: number;
  /** Per-exon display-x extent at the current zoom. Parallel to
   *  `baselineGeometry.exons` but with positions in the live layout
   *  rather than fit-zoom. */
  currentExons: ReadonlyArray<{ exonIdx: number; xStart: number; xEnd: number }>;
  /** Per-inter-exon-gap display-x extent at the current zoom. Parallel
   *  to `baselineGeometry.gaps`. Zero-width gaps (transcript / protein
   *  modes) collapse to a single x. */
  currentGaps: ReadonlyArray<{ exonIdxA: number; exonIdxB: number; xStart: number; xEnd: number }>;
  /** The transcript currently rendered by the viewer. */
  transcript: Transcript;
}

/** Options accepted by `fitTo` / `zoomBy`. Historically `animate: false`
 *  skipped a CSS transition; the animation layer was retired in Slice 33 so
 *  every imperative range update is now instantaneous, and the flag is
 *  accepted but ignored. Kept on the surface so hosts that pass it (e.g.,
 *  `<DefaultMinimap>` during a drag) don't need to change. */
export interface ViewportCommandOptions {
  animate?: boolean;
}

/** Imperative-ref API surface exposed by `<GeneGlyph>`. Slice 8 ships the
 *  first three methods; Slice 19 adds `exportSVG` / `exportPNG`; Slice 20
 *  adds the optional `options.animate` flag on `fitTo` / `zoomBy`; Slice 33
 *  adds `subscribe` for event-driven chrome updates. */
export interface GeneGlyphRef {
  fitTo(target: FitTarget, options?: ViewportCommandOptions): void;
  zoomBy(factor: number, options?: ViewportCommandOptions): void;
  /** Pure display-space pan: shift the viewport by `deltaPx` layout
   *  pixels. The figure's static layout is unchanged; only the offset
   *  shifts, so zoom is preserved exactly and every visible point
   *  moves uniformly. Used by the display-space minimap's brush-pan
   *  gesture and by any host chrome that wants smooth pan without
   *  going through ruler-space round-trip. */
  panByDisplayPx(deltaPx: number): void;
  /** Set the visible baseline window directly. The viewer solves for the
   *  (zoomScale, displayOffset) pair that maps `[window[0], window[1]]`
   *  to viewport `[0, width]`. Use this for the minimap's handle drag /
   *  brush-resize gestures — bypasses ruler-space and so doesn't snap
   *  inside fixed-budget intron bulks. */
  setBaselineWindow(window: readonly [number, number]): void;
  /** Convert a position in the figure's static layout (display-x in the
   *  laid-out figure, not viewport-relative) to a baseline-x. Display-
   *  space chrome (e.g. the minimap) uses this to translate a cursor
   *  position in its own mini-display into the figure's baseline coords
   *  so it can set a new visible window. */
  layoutXToBaseline(layoutX: number): number;
  getViewportInfo(): ViewportInfo;
  /** Subscribe to committed range / mode / width changes. The listener fires
   *  synchronously after every mutation (gesture, imperative, or controlled-
   *  prop sync). Returns an unsubscribe function. Pair with
   *  `useSyncExternalStore` so chrome stays in step with the figure without
   *  polling. Slice 33. */
  subscribe(listener: () => void): () => void;
  /** Serialize the figure SVG to a stand-alone, theme-resolved string. The
   *  returned SVG opens cleanly in Inkscape with no external CSS attached.
   *  Slice 19. */
  exportSVG(args?: ExportArgs): Promise<string>;
  /** Rasterise the figure SVG to a PNG `Blob` at the requested pixel width.
   *  Height is derived from the figure's aspect ratio. Slice 19. */
  exportPNG(args?: ExportArgs & { widthPx: number }): Promise<Blob>;
  /** Fold the group with the given id. No-op for unknown ids. RD-1110. */
  foldGroup(id: string): void;
  /** Unfold the group with the given id. No-op for unknown ids. RD-1110. */
  unfoldGroup(id: string): void;
  /** Toggle the fold state of the group with the given id. RD-1110. */
  toggleGroup(id: string): void;
  /** Snapshot of the currently-folded group ids. RD-1110. */
  getCollapsedGroupIds(): ReadonlySet<string>;
}

function flattenTracks(
  items: TrackOrGroup[],
  collapsedGroupIds: ReadonlySet<string>,
): Track[] {
  const out: Track[] = [];
  const walk = (entries: TrackOrGroup[]) => {
    for (const entry of entries) {
      if (isTrackGroup(entry)) {
        if (collapsedGroupIds.has(entry.id)) {
          if (entry.summaryTrack) out.push(entry.summaryTrack);
          // No summary track → group contributes no leaves; matches
          // today's "remove rows" semantics for folded groups without
          // a summary.
        } else {
          walk(entry.tracks);
        }
      } else {
        out.push(entry);
      }
    }
  };
  walk(items);
  return out;
}

function toReadonlySet(ids: ReadonlySet<string> | Iterable<string> | undefined): ReadonlySet<string> {
  if (!ids) return EMPTY_SET;
  if (ids instanceof Set) return ids;
  return new Set(ids);
}

const EMPTY_SET: ReadonlySet<string> = new Set<string>();

/** Vertical extent used by full-figure overlays (brush, box-zoom preview)
 *  when track content overflows the layout budget. The figure SVG's own
 *  overflow rules clip whatever isn't visible, so a generously tall rect
 *  is safe and guarantees the overlay reaches the edge of any rendered
 *  content regardless of which tracks the host stacks in. */
const OVERFLOW_BRUSH_HEIGHT = 100000;

function findSlot<P>(
  children: ReactNode,
  component: ComponentType<P>,
): ReactElement<P> | null {
  let match: ReactElement<P> | null = null;
  Children.forEach(children, (child) => {
    if (match) return;
    if (!isValidElement(child)) return;
    if (child.type === component) match = child as ReactElement<P>;
  });
  return match;
}

function gutterItemsFor(items: LayoutItem[]): GutterItem[] {
  const out: GutterItem[] = [];
  const walk = (entries: LayoutItem[], depth: number) => {
    for (const item of entries) {
      out.push({
        kind: item.kind,
        id: item.id,
        label: item.label,
        rect: item.rect,
        didTruncate: item.didTruncate,
        droppedCount: item.droppedCount,
        depth,
        headerHeight: item.headerHeight,
      });
      if (item.kind === 'group' && item.children) {
        walk(item.children, depth + 1);
      }
    }
  };
  walk(items, 0);
  return out;
}

function GeneGlyphInner(
  {
    transcript,
    protein,
    tracks,
    width = 1000,
    mode: controlledMode,
    defaultMode,
    onModeChange,
    trackHeightBudget = 200,
    hoveredFeatureId = null,
    selectedFeatureIds,
    brushRange: controlledBrushRange,
    defaultBrushRange,
    onBrushChange,
    onHover,
    onFeatureClick,
    renderTooltip,
    onTrackStateChange,
    loadDebounceMs = typeof globalThis !== 'undefined' && (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process?.env?.NODE_ENV === 'test' ? 0 : 120,
    interactionMode = 'standard',
    viewportRange,
    defaultViewportRange,
    onViewportChange,
    minZoom,
    maxZoom = DEFAULT_MAX_ZOOM,
    collapsedRegions: collapsedRegionsProp,
    collapsedGroupIds: controlledCollapsedGroupIds,
    defaultCollapsedGroupIds,
    onCollapsedGroupChange,
    className,
    children,
  }: GeneGlyphProps,
  forwardedRef: Ref<GeneGlyphRef>,
) {
  const controlled = viewportRange !== undefined;
  const brushControlled = controlledBrushRange !== undefined;
  const [uncontrolledMode] = useState<ViewMode>(
    () => defaultMode ?? 'genome',
  );
  const mode = controlledMode ?? uncontrolledMode;
  const [uncontrolledBrush, setUncontrolledBrush] = useState<
    readonly [number, number] | null
  >(() => defaultBrushRange ?? null);
  const brush: readonly [number, number] | null = brushControlled
    ? controlledBrushRange ?? null
    : uncontrolledBrush;
  const trackList = useMemo<TrackOrGroup[]>(
    () => (tracks && tracks.length > 0 ? tracks : [exonTrack({})]),
    [tracks],
  );

  // Folded-group state machine. Mirrors the brush / viewportRange shape: the
  // controlled prop wins when supplied; otherwise we keep an internal set
  // seeded from `defaultCollapsedGroupIds`. Both branches fire
  // `onCollapsedGroupChange` after every commit so hosts can mirror the set
  // into URL state or persistence.
  const collapsedControlled = controlledCollapsedGroupIds !== undefined;
  const [uncontrolledCollapsed, setUncontrolledCollapsed] = useState<ReadonlySet<string>>(
    () => toReadonlySet(defaultCollapsedGroupIds),
  );
  const collapsedGroupIds: ReadonlySet<string> = collapsedControlled
    ? toReadonlySet(controlledCollapsedGroupIds)
    : uncontrolledCollapsed;
  const collapsedGroupIdsRef = useRef(collapsedGroupIds);
  useEffect(() => {
    collapsedGroupIdsRef.current = collapsedGroupIds;
  }, [collapsedGroupIds]);
  const onCollapsedGroupChangeRef = useRef(onCollapsedGroupChange);
  useEffect(() => {
    onCollapsedGroupChangeRef.current = onCollapsedGroupChange;
  }, [onCollapsedGroupChange]);

  const applyCollapsed = useCallback(
    (next: ReadonlySet<string>) => {
      if (!collapsedControlled) setUncontrolledCollapsed(next);
      onCollapsedGroupChangeRef.current?.(next);
    },
    [collapsedControlled],
  );

  const flatTracks = useMemo(
    () => flattenTracks(trackList, collapsedGroupIds),
    [trackList, collapsedGroupIds],
  );
  const mapper = useMemo(() => createCoordinateMapper(transcript), [transcript]);
  const initialRange = viewportRange ?? defaultViewportRange;
  const collapsedRegions = useMemo(
    () => collapsedRegionsProp ?? defaultCollapsedRegions(transcript),
    [collapsedRegionsProp, transcript],
  );
  // Construct the viewport once per (mapper, width, collapsedRegions). Mode
  // changes are applied via `setMode` on the existing instance so its
  // subscribers see each change as one committed mutation rather than a
  // fresh controller. The soft-collapse spec is also a baseline input
  // (Phase 3) — it drives flank widths and intron-bulk pixel budgets — so
  // the viewport rebuilds when the host hands a new spec.
  const viewport = useMemo(
    () =>
      new ViewportController({
        mapper,
        width,
        mode,
        range: initialRange,
        collapsedRegions,
      }),
    // `mode`, `width`, and `initialRange` only seed construction; later
    // changes reach the viewport via the prop-sync effects below
    // (`setMode`, `setWidth`, controlled-`viewportRange`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mapper, collapsedRegions],
  );
  const painter = useMemo(() => createSvgPainter({ mode: 'screen' }), []);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const figureWrapRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    viewport.attach(el);
    return () => viewport.detach();
  }, [viewport]);

  const containerRef = useRef<HTMLDivElement | null>(null);

  // Subscribe to committed viewport changes so the layout `useMemo` below and
  // any other render-time read of `viewport.range` / `viewport.mode` re-runs
  // on every external mutation. Previously a `tick` counter served this role
  // along with a CSS-transition layer; without animation the subscription is
  // the only signal we need.
  const viewportVersion = useSyncExternalStore(
    useCallback((listener) => viewport.subscribe(listener), [viewport]),
    useCallback(() => {
      const [a, b] = viewport.range;
      return `${viewport.mode}|${a}|${b}`;
    }, [viewport]),
    useCallback(() => {
      const [a, b] = viewport.range;
      return `${viewport.mode}|${a}|${b}`;
    }, [viewport]),
  );

  // Sync the controlled `viewportRange` prop into the viewport during render
  // so the same render pass — including the layout `useMemo` below — sees the
  // new range. The viewport is a mutable external store (CSS-variable
  // publisher); React doesn't observe its state directly, which is why the
  // layout memo also lists `viewportRange` in its dep array further down.
  useLayoutEffect(() => {
    if (!controlled || !viewportRange) return;
    const [a, b] = viewport.range;
    if (a === viewportRange[0] && b === viewportRange[1]) return;
    viewport.setRange(viewportRange);
  }, [controlled, viewportRange, viewport]);

  // Mirror the active mode onto the viewport synchronously — the viewport
  // publishes new CSS variables during this layout effect and fires its own
  // subscription notification so any auxiliary chrome re-renders on the same
  // paint as the figure.
  const previousModeRef = useRef<ViewMode>(mode);
  useLayoutEffect(() => {
    if (previousModeRef.current === mode && viewport.mode === mode) return;
    const isFirstSync = previousModeRef.current === mode;
    previousModeRef.current = mode;
    if (viewport.mode !== mode) viewport.setMode(mode);
    if (isFirstSync) return;
    onModeChange?.(mode);
  }, [mode, viewport, onModeChange]);


  // Per-track data + state. The viewer fans loads out per track (rather than
  // one shared Promise.all) so a slow async source doesn't block fast tracks
  // from rendering. Each track owns its own AbortController so viewport-
  // driven re-loads cancel just that track's in-flight request rather than
  // bouncing the whole stack. Slice 18.
  const [trackData, setTrackData] = useState<Map<string, unknown>>(() => new Map());
  const [trackStates, setTrackStates] = useState<Map<string, TrackLoadState>>(
    () => new Map(),
  );
  const [stale, setStale] = useState(false);
  const trackControllersRef = useRef<Map<string, AbortController>>(new Map());
  const onTrackStateChangeRef = useRef(onTrackStateChange);
  useEffect(() => {
    onTrackStateChangeRef.current = onTrackStateChange;
  }, [onTrackStateChange]);

  const setTrackState = useCallback((id: string, next: TrackLoadState) => {
    setTrackStates((prev) => {
      if (prev.get(id) === next) return prev;
      const m = new Map(prev);
      m.set(id, next);
      return m;
    });
    onTrackStateChangeRef.current?.(id, next);
  }, []);

  // Stable id-signature of the track stack. The `tracks` prop is often an
  // inline array literal (`tracks={[exonTrack({}), ...]}`) on the host
  // side; its reference changes on every parent re-render even when the
  // logical track list is identical. Gating the load / cleanup effects
  // on the id-signature instead of `flatTracks` identity prevents an
  // unbounded re-render loop where every parent re-render aborts and
  // re-fires every track's load, and each load's `setTrackData` triggers
  // another re-render. The actual `flatTracks` array is read through a
  // ref inside the effect so the latest track instances are still in
  // play. (Recently surfaced when modal mode-switches plus a host rAF
  // poll combined to trip React's "Maximum update depth exceeded"
  // safeguard — Slice 26 follow-up.)
  const trackIdsKey = useMemo(
    () => flatTracks.map((t) => `${t.id}@${t.configKey ?? ''}`).join('|'),
    [flatTracks],
  );
  const flatTracksRef = useRef(flatTracks);
  useEffect(() => {
    flatTracksRef.current = flatTracks;
  }, [flatTracks]);

  // Drop state for tracks that were removed from the stack so stale entries
  // don't linger across track-list edits. setState calls are gated by an
  // actual diff so the effect is a no-op when the track list is unchanged
  // (which is the common case and what the lint rule is concerned about).
  useEffect(() => {
    const live = new Set(flatTracksRef.current.map((t) => t.id));
    setTrackData((prev) => {
      let changed = false;
      const m = new Map(prev);
      for (const k of m.keys()) if (!live.has(k)) { m.delete(k); changed = true; }
      return changed ? m : prev;
    });
    setTrackStates((prev) => {
      let changed = false;
      const m = new Map(prev);
      for (const k of m.keys()) if (!live.has(k)) { m.delete(k); changed = true; }
      return changed ? m : prev;
    });
    const controllers = trackControllersRef.current;
    for (const [id, ac] of controllers) {
      if (!live.has(id)) { ac.abort(); controllers.delete(id); }
    }
  }, [trackIdsKey]);

  const loadTrack = useCallback(
    (t: Track) => {
      const controllers = trackControllersRef.current;
      controllers.get(t.id)?.abort();
      const controller = new AbortController();
      controllers.set(t.id, controller);
      setTrackState(t.id, 'loading');
      const proteinArg = protein ?? null;
      Promise.resolve()
        .then(() =>
          t.load({
            viewport,
            mapper,
            signal: controller.signal,
            protein: proteinArg,
          }),
        )
        .then(
          (data) => {
            if (controller.signal.aborted) return;
            if (controllers.get(t.id) !== controller) return;
            setTrackData((prev) => {
              const m = new Map(prev);
              m.set(t.id, data);
              return m;
            });
            setTrackState(t.id, 'ready');
          },
          (err) => {
            if (controller.signal.aborted) return;
            if ((err as { name?: string })?.name === 'AbortError') return;
            if (controllers.get(t.id) !== controller) return;
            setTrackState(t.id, 'error');
          },
        );
    },
    [mapper, protein, setTrackState, viewport],
  );

  // Identity-change loads: when the set of track ids / viewport instance /
  // mapper / protein changes, kick every track immediately (no debounce).
  // This is the "first paint" path and the path used by hosts swapping the
  // transcript. Gated on `trackIdsKey` so inline `tracks` arrays on the host
  // side don't loop the load through every re-render (see the comment on
  // `trackIdsKey` for the surfacing scenario).
  useEffect(() => {
    for (const t of flatTracksRef.current) loadTrack(t);
    const controllers = trackControllersRef.current;
    return () => {
      for (const ac of controllers.values()) ac.abort();
      controllers.clear();
    };
  }, [trackIdsKey, loadTrack]);

  // Range/mode-change debounce. Marks the figure stale (CSS desaturates
  // feature fills) on every change, then once the viewport has been quiet for
  // `loadDebounceMs` re-fires `track.load()` for each track. DataSources whose
  // cacheKey hasn't moved short-circuit through the cache; sources keyed on
  // the visible window genuinely refetch.
  const rangeKey = controlled && viewportRange
    ? `${mode}|${viewportRange[0]}|${viewportRange[1]}`
    : viewportVersion;
  const rangeKeyRef = useRef(rangeKey);
  useEffect(() => {
    if (rangeKeyRef.current === rangeKey) return;
    rangeKeyRef.current = rangeKey;
    setStale(true);
    const timer = setTimeout(() => {
      setStale(false);
      for (const t of flatTracksRef.current) loadTrack(t);
    }, Math.max(0, loadDebounceMs));
    return () => clearTimeout(timer);
  }, [rangeKey, trackIdsKey, loadDebounceMs, loadTrack]);

  const layout = useMemo(
    () =>
      layoutTracks({
        tracks: trackList,
        viewport,
        data: trackData,
        totalHeightBudget: trackHeightBudget,
        collapsedGroupIds,
      }),
    // `viewportVersion` re-runs layout when the viewport's committed range or
    // mode changes (gesture / imperative); `viewportRange` lets controlled
    // hosts drive layout without going through the subscription (the
    // prop-sync useMemo above writes it into `viewport` first).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trackList, viewport, trackData, trackHeightBudget, viewportVersion, viewportRange, collapsedGroupIds],
  );

  const totalHeight = Math.max(1, layout.totalHeight);

  // Drive the viewport width from the figure-wrap's measured CSS width so
  // the figure's horizontal extent is whatever the embedder gives it, not
  // a fixed viewBox-unit constant. Tracks position content in viewport
  // units (1:1 with CSS px); the viewBox is sized to match the measured
  // width + `totalHeight`, so there's no aspect-ratio mismatch and no
  // pillarbox / letterbox. The `width` prop seeds the viewport before the
  // measurement lands (SSR / first paint / jsdom) and remains the fallback
  // when ResizeObserver isn't available.
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const effectiveWidth = measuredWidth ?? width;
  useLayoutEffect(() => {
    const wrap = figureWrapRef.current;
    if (!wrap) return;
    const measure = () => {
      const w = wrap.getBoundingClientRect().width;
      if (w <= 0) return;
      setMeasuredWidth((prev) => (prev !== null && Math.abs(prev - w) <= 0.5 ? prev : w));
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const obs = new ResizeObserver(measure);
      obs.observe(wrap);
      return () => obs.disconnect();
    }
  }, []);
  useLayoutEffect(() => {
    viewport.setWidth(effectiveWidth);
  }, [viewport, effectiveWidth]);
  const renderedHeight = Math.max(1, totalHeight);

  const selectedSet = useMemo(() => toReadonlySet(selectedFeatureIds), [selectedFeatureIds]);
  const interaction = useMemo<InteractionState>(
    () => ({
      hoveredFeatureId,
      selectedFeatureIds: selectedSet,
      brushRange: brush,
    }),
    [hoveredFeatureId, selectedSet, brush],
  );

  const applyBrush = useCallback(
    (next: readonly [number, number] | null) => {
      if (!brushControlled) setUncontrolledBrush(next);
      onBrushChange?.(next);
    },
    [brushControlled, onBrushChange],
  );

  const [tooltipTarget, setTooltipTarget] = useState<{
    trackId: string;
    featureId: string;
  } | null>(null);

  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  // Hover debouncing — see RD-1109. Adjacent variant glyphs separated by a
  // pixel of empty SVG would flicker the tooltip on every cursor jitter: each
  // pointermove crossing a gap fires mouseLeave→mouseEnter, dismissing then
  // re-mounting the tooltip. We coalesce raw enter/leave events through a
  // small state machine:
  //   * Enter delay defers committing a hover until the cursor has stayed on
  //     a feature for ~enterDelayMs — but only when the cursor is moving
  //     fast. A confident, low-velocity hover commits immediately so the
  //     user doesn't pay the delay when they've clearly landed.
  //   * Exit grace keeps the tooltip mounted for ~exitGraceMs after leave so
  //     a quick re-entry (same feature OR an adjacent one) swaps targets in
  //     place rather than unmounting and re-mounting.
  // Pointer-leave from the figure dismisses immediately — debouncing only
  // applies to entry and inter-feature transitions, never to true dismissal.
  const HOVER_ENTER_DELAY_MS = 100;
  const HOVER_EXIT_GRACE_MS = 60;
  const HOVER_FAST_VELOCITY_PX_MS = 0.1;
  const tooltipTargetRef = useRef<{ trackId: string; featureId: string } | null>(null);
  useEffect(() => {
    tooltipTargetRef.current = tooltipTarget;
  }, [tooltipTarget]);
  const enterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingEnterRef = useRef<{ trackId: string; featureId: string } | null>(null);
  const pointerVelocityRef = useRef<{ x: number; y: number; t: number; vel: number } | null>(null);

  const clearEnterTimer = useCallback(() => {
    if (enterTimerRef.current !== null) {
      clearTimeout(enterTimerRef.current);
      enterTimerRef.current = null;
    }
    pendingEnterRef.current = null;
  }, []);
  const clearExitTimer = useCallback(() => {
    if (exitTimerRef.current !== null) {
      clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
  }, []);
  useEffect(() => () => {
    clearEnterTimer();
    clearExitTimer();
  }, [clearEnterTimer, clearExitTimer]);

  const commitHover = useCallback(
    (next: { trackId: string; featureId: string } | null, leavingTrackId?: string) => {
      clearEnterTimer();
      clearExitTimer();
      if (next) {
        setTooltipTarget(next);
        onHover?.(next.featureId, next.trackId);
      } else {
        const tid = leavingTrackId ?? tooltipTargetRef.current?.trackId ?? null;
        setTooltipTarget(null);
        setTooltipPos(null);
        if (tid) onHover?.(null, tid);
      }
    },
    [clearEnterTimer, clearExitTimer, onHover],
  );

  const handleHover = useCallback(
    (trackId: string, featureId: string | null) => {
      if (featureId) {
        const next = { trackId, featureId };
        const current = tooltipTargetRef.current;
        // Re-entering the same feature during exit-grace: just cancel the
        // exit so the existing tooltip stays put.
        if (
          exitTimerRef.current !== null &&
          current &&
          current.trackId === trackId &&
          current.featureId === featureId
        ) {
          clearExitTimer();
          return;
        }
        // If a tooltip is already mounted (or pending dismissal), swap the
        // target in place — no remount, no delay. This is the path that
        // covers gliding across adjacent variants.
        if (current || exitTimerRef.current !== null) {
          commitHover(next);
          return;
        }
        // Cold start: deciding whether to mount a tooltip at all. Skip the
        // enter delay when the cursor isn't moving fast — a low-velocity
        // hover is a confident landing.
        const vel = pointerVelocityRef.current?.vel ?? 0;
        if (vel <= HOVER_FAST_VELOCITY_PX_MS) {
          commitHover(next);
          return;
        }
        clearEnterTimer();
        pendingEnterRef.current = next;
        enterTimerRef.current = setTimeout(() => {
          enterTimerRef.current = null;
          const pending = pendingEnterRef.current;
          pendingEnterRef.current = null;
          if (pending) commitHover(pending);
        }, HOVER_ENTER_DELAY_MS);
      } else {
        // A pending enter was never committed — just drop it. No onHover
        // call either (we never told the host the entry happened).
        if (enterTimerRef.current !== null) {
          clearEnterTimer();
          return;
        }
        if (!tooltipTargetRef.current) return;
        clearExitTimer();
        exitTimerRef.current = setTimeout(() => {
          exitTimerRef.current = null;
          commitHover(null, trackId);
        }, HOVER_EXIT_GRACE_MS);
      }
    },
    [clearEnterTimer, clearExitTimer, commitHover],
  );

  const handleFigurePointerMove = useCallback((e: ReactPointerEvent) => {
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const prev = pointerVelocityRef.current;
    if (!prev) {
      pointerVelocityRef.current = { x: e.clientX, y: e.clientY, t: now, vel: 0 };
      return;
    }
    const dt = Math.max(1, now - prev.t);
    const d = Math.hypot(e.clientX - prev.x, e.clientY - prev.y);
    const inst = d / dt;
    // Light exponential smoothing so a single fast frame doesn't dominate.
    const vel = prev.vel * 0.5 + inst * 0.5;
    pointerVelocityRef.current = { x: e.clientX, y: e.clientY, t: now, vel };
  }, []);

  const handleFigurePointerLeave = useCallback(() => {
    // Real dismissal — flush both timers and tear down the tooltip now. The
    // host hears about it once, with the trackId of the feature that was
    // hovered at the time of leave.
    pointerVelocityRef.current = null;
    if (enterTimerRef.current !== null) {
      clearEnterTimer();
      return;
    }
    if (tooltipTargetRef.current) commitHover(null);
    else clearExitTimer();
  }, [clearEnterTimer, clearExitTimer, commitHover]);

  const handleClick = useCallback(
    (trackId: string, featureId: string) => {
      onFeatureClick?.(featureId, trackId);
    },
    [onFeatureClick],
  );

  const applyImperativeRange = useCallback(
    (range: readonly [number, number]) => {
      viewport.setRange(range);
      onViewportChange?.([range[0], range[1]], 'imperative');
    },
    [viewport, onViewportChange],
  );

  const [boxZoomPreview, setBoxZoomPreview] = useState<
    readonly [number, number] | null
  >(null);

  const interactions = useViewportInteractions({
    viewport,
    svgRef,
    containerRef,
    mode: interactionMode,
    minZoom,
    maxZoom,
    controlled,
    onChange: useCallback(
      (range, reason) => {
        onViewportChange?.(range, reason);
      },
      [onViewportChange],
    ),
    onBrush: applyBrush,
    onBoxZoomPreview: setBoxZoomPreview,
  });

  const fitTo = useCallback(
    (target: FitTarget, _options?: ViewportCommandOptions) => {
      if (target.kind === 'gene') {
        applyImperativeRange(viewport.naturalRange());
        return;
      }
      if (target.kind === 'range' || target.kind === 'selection') {
        const range =
          target.kind === 'range' ? target.range : brush;
        if (!range) return;
        const natural = viewport.naturalRange();
        const lo = Math.max(natural[0], Math.min(range[0], range[1]));
        const hi = Math.min(natural[1], Math.max(range[0], range[1]));
        if (hi <= lo) return;
        applyImperativeRange([lo, hi]);
        return;
      }
      // kind === 'feature'
      const track = flatTracks.find((t) => t.id === target.trackId);
      if (!track || !track.resolveAnchor) return;
      const data = trackData.get(track.id);
      if (data === undefined) return;
      // Resolve through a temporary fit-gene viewport so the feature's anchor
      // is visible regardless of where the viewer is currently parked.
      const tempViewport = new ViewportController({
        mapper,
        width: viewport.width,
        mode: viewport.mode,
      });
      const point = track.resolveAnchor(data, target.featureId, tempViewport);
      if (!point) return;
      const center = tempViewport.rulerAtScreen(point.x);
      if (center === null) return;
      const natural = viewport.naturalRange();
      const naturalLen = natural[1] - natural[0];
      const window = Math.max(1, naturalLen / 10);
      let lo = center - window / 2;
      let hi = center + window / 2;
      if (lo < natural[0]) {
        hi += natural[0] - lo;
        lo = natural[0];
      }
      if (hi > natural[1]) {
        lo -= hi - natural[1];
        hi = natural[1];
      }
      lo = Math.max(natural[0], lo);
      hi = Math.min(natural[1], hi);
      if (hi <= lo) return;
      applyImperativeRange([lo, hi]);
    },
    [applyImperativeRange, viewport, flatTracks, trackData, mapper, brush],
  );

  const zoomBy = useCallback(
    (factor: number, _options?: ViewportCommandOptions) => {
      if (factor <= 0 || !Number.isFinite(factor)) return;
      const [lo, hi] = viewport.range;
      const center = (lo + hi) / 2;
      const natural = viewport.naturalRange();
      const newLen = Math.max(1, (hi - lo) / factor);
      let nlo = center - newLen / 2;
      let nhi = center + newLen / 2;
      if (nlo < natural[0]) {
        nhi += natural[0] - nlo;
        nlo = natural[0];
      }
      if (nhi > natural[1]) {
        nlo -= nhi - natural[1];
        nhi = natural[1];
      }
      nlo = Math.max(natural[0], nlo);
      nhi = Math.min(natural[1], nhi);
      if (nhi <= nlo) return;
      applyImperativeRange([nlo, nhi]);
    },
    [applyImperativeRange, viewport],
  );

  const getViewportInfo = useCallback((): ViewportInfo => {
    const range = viewport.range;
    const natural = viewport.naturalRange();
    const naturalLen = natural[1] - natural[0];
    const rangeLen = range[1] - range[0];
    const zoom = rangeLen > 0 ? naturalLen / rangeLen : 1;
    return {
      mode: viewport.mode,
      range,
      zoom,
      layout: layout.items,
      naturalRange: natural,
      baselineWindow: viewport.baselineWindow(),
      baselineGeometry: viewport.baselineGeometry(),
      zoomScale: viewport.zoomScale(),
      displayOffset: viewport.displayOffset(),
      totalDisplayWidth: viewport.totalFigureDisplayWidth(),
      viewportWidth: viewport.width,
      currentExons: viewport.currentExonLayout(),
      currentGaps: viewport.currentGapLayout(),
      transcript,
    };
  }, [viewport, layout, transcript]);

  const aaLength = Math.floor(transcript.cdsLength / 3);
  const aria = `${transcript.geneSymbol} (${transcript.transcriptId}) — ${aaLength} aa`;
  // The description is `<desc>`-bound — a slightly richer accessibility blurb
  // than the bare title so screen readers and the Inkscape "Object
  // Properties" panel both get useful context.
  const exportDescription = `gene-glyph figure of ${transcript.geneSymbol} (${transcript.transcriptId}); view mode ${mode}.`;

  const exportSVG = useCallback(
    async (args?: ExportArgs): Promise<string> => {
      const svg = svgRef.current;
      if (!svg) throw new Error('exportSVG: figure SVG is not mounted yet.');
      return exportSvgString({
        svg,
        ariaLabel: aria,
        description: exportDescription,
        args,
      });
    },
    [aria, exportDescription],
  );

  const exportPNG = useCallback(
    async (args?: ExportArgs & { widthPx: number }): Promise<Blob> => {
      const svg = svgRef.current;
      if (!svg) throw new Error('exportPNG: figure SVG is not mounted yet.');
      const widthPx = args?.widthPx ?? 1800;
      const { widthPx: _, ...svgArgs } = args ?? {};
      const svgString = exportSvgString({
        svg,
        ariaLabel: aria,
        description: exportDescription,
        args: svgArgs,
      });
      const viewBox = svg.getAttribute('viewBox') ?? `0 0 ${effectiveWidth} ${totalHeight}`;
      const parts = viewBox.split(/[\s,]+/).map(Number);
      const vbW = Number.isFinite(parts[2]) ? (parts[2] as number) : effectiveWidth;
      const vbH = Number.isFinite(parts[3]) ? (parts[3] as number) : totalHeight;
      return exportPngBlob({
        svgString,
        widthPx,
        viewBoxWidth: vbW,
        viewBoxHeight: vbH,
      });
    },
    [aria, exportDescription, effectiveWidth, totalHeight],
  );

  const subscribe = useCallback(
    (listener: () => void) => viewport.subscribe(listener),
    [viewport],
  );

  const panByDisplayPx = useCallback(
    (deltaPx: number) => viewport.panByDisplayPx(deltaPx),
    [viewport],
  );
  const setBaselineWindow = useCallback(
    (window: readonly [number, number]) => viewport.setBaselineWindow(window),
    [viewport],
  );
  const layoutXToBaseline = useCallback(
    (layoutX: number) => viewport.layoutXToBaseline(layoutX),
    [viewport],
  );

  const foldGroup = useCallback(
    (id: string) => {
      const current = collapsedGroupIdsRef.current;
      if (current.has(id)) return;
      const next = new Set(current);
      next.add(id);
      applyCollapsed(next);
    },
    [applyCollapsed],
  );
  const unfoldGroup = useCallback(
    (id: string) => {
      const current = collapsedGroupIdsRef.current;
      if (!current.has(id)) return;
      const next = new Set(current);
      next.delete(id);
      applyCollapsed(next);
    },
    [applyCollapsed],
  );
  const toggleGroup = useCallback(
    (id: string) => {
      const current = collapsedGroupIdsRef.current;
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      applyCollapsed(next);
    },
    [applyCollapsed],
  );
  const getCollapsedGroupIds = useCallback(
    (): ReadonlySet<string> => collapsedGroupIdsRef.current,
    [],
  );

  useImperativeHandle(
    forwardedRef,
    () => ({
      fitTo,
      zoomBy,
      panByDisplayPx,
      setBaselineWindow,
      layoutXToBaseline,
      getViewportInfo,
      subscribe,
      exportSVG,
      exportPNG,
      foldGroup,
      unfoldGroup,
      toggleGroup,
      getCollapsedGroupIds,
    }),
    [
      fitTo,
      zoomBy,
      panByDisplayPx,
      setBaselineWindow,
      layoutXToBaseline,
      getViewportInfo,
      subscribe,
      exportSVG,
      exportPNG,
      foldGroup,
      unfoldGroup,
      toggleGroup,
      getCollapsedGroupIds,
    ],
  );

  // Aggregate hidden-feature counts across tracks once per render so the exon
  // track (and any host-supplied indicator track) sees a single per-gap total
  // rather than each track stacking its own marks. Slice 15 surfaces the
  // totals via `TrackRenderArgs.hiddenByIntron`.
  const hiddenByIntron = useMemo<ReadonlyMap<string, HiddenFeatureBucket>>(() => {
    const merged = new Map<string, HiddenFeatureBucket>();
    for (const t of flatTracks) {
      if (!t.hiddenFeaturesByIntron) continue;
      const data = trackData.get(t.id);
      if (data === undefined) continue;
      const buckets = t.hiddenFeaturesByIntron({ data, viewport, mapper });
      for (const b of buckets) {
        if (b.count <= 0) continue;
        const key = `${b.exonIdxA}:${b.exonIdxB}`;
        const prev = merged.get(key);
        if (prev) {
          const mergedIds = prev.featureIds ?? b.featureIds
            ? [...(prev.featureIds ?? []), ...(b.featureIds ?? [])]
            : undefined;
          merged.set(key, {
            exonIdxA: b.exonIdxA,
            exonIdxB: b.exonIdxB,
            count: prev.count + b.count,
            featureIds: mergedIds,
          });
        } else {
          merged.set(key, { ...b });
        }
      }
    }
    // Read viewportVersion inside the body to make it an explicit dependency
    void viewportVersion;
    return merged;
  }, [flatTracks, trackData, viewport, mapper, viewportVersion]);

  const trackRenderArgsFor = (t: Track) => {
    const rect = layout.trackRects.get(t.id);
    if (!rect) return null;
    const data = trackData.get(t.id);
    if (data === undefined) return null;
    return {
      data,
      rect,
      viewport,
      mapper,
      interaction,
      painter,
      hiddenByIntron,
      onFeatureHover: (featureId: string | null) => handleHover(t.id, featureId),
      onFeatureClick: (featureId: string) => handleClick(t.id, featureId),
    };
  };

  const brushOverlay = useMemo<ReactNode>(() => {
    if (!brush) return null;
    const [a, b] = brush;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (!(hi > lo)) return null;
    // Brush is a single contiguous range in the active ruler. Render it as
    // one viewport-x rect spanning lo→hi, bypassing the per-exon
    // segmentation that used to produce stroke seams between adjacent
    // brushed exons and misaligned inter-exon gap fills under Phase-3
    // soft-collapse layout. `cdsToBaselineX` consumes a cell-edge ruler
    // value (the same convention `rulerAtScreen` returns), so we pass
    // `lo`/`hi` straight through — no extra ±0.5 cell adjustment, which
    // previously shifted the brush half a cell off the user's click
    // position (≈25px at high zoom).
    const baseLo = viewport.cdsToBaselineX(lo);
    const baseHi = viewport.cdsToBaselineX(hi);
    const offset = viewport.displayOffset();
    const xLo = viewport.baselineToLayoutX(baseLo) - offset;
    const xHi = viewport.baselineToLayoutX(baseHi) - offset;
    if (xHi <= 0 || xLo >= viewport.width) return null;
    const clampedLo = Math.max(0, xLo);
    const clampedHi = Math.min(viewport.width, xHi);
    if (!(clampedHi > clampedLo)) return null;
    // Use a height that's guaranteed to span any rendered content — some
    // tracks (data-dependent stacked variants) render glyphs at viewBox y
    // beyond `layout.totalHeight` because the layout engine clamps the
    // declared px to the budget but the track's renderer doesn't clip its
    // rows. The SVG's overflow rules cull anything past the visible
    // figure, so the brush always reaches the on-screen edge regardless.
    const brushHeight = Math.max(totalHeight, OVERFLOW_BRUSH_HEIGHT);
    return (
      <g className="vv-brush-overlay" data-testid="gene-glyph-brush" aria-hidden>
        <rect
          className="vv-brush-rect"
          x={clampedLo}
          y={0}
          width={clampedHi - clampedLo}
          height={brushHeight}
          vectorEffect="non-scaling-stroke"
        />
      </g>
    );
  }, [brush, viewport, totalHeight, viewportVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // One shimmer rect per loading track. Lives inside the figure SVG (so it's
  // included in exportSVG snapshots only when the user explicitly chooses to
  // export mid-load) and sits above feature glyphs to read as an overlay. The
  // animation is gated by CSS — `animation-delay` hides flashes from sub-frame
  // loads, and the reduced-motion override snaps to a static muted fill.
  const loadingShimmer = useMemo<ReactNode>(() => {
    const rects: ReactNode[] = [];
    for (const t of flatTracks) {
      if (trackStates.get(t.id) !== 'loading') continue;
      const rect = layout.trackRects.get(t.id);
      if (!rect) continue;
      const h = Math.max(0, rect.yBottom - rect.yTop);
      if (h <= 0) continue;
      rects.push(
        <rect
          key={t.id}
          className="vv-loading-shimmer"
          data-vv-track-id={t.id}
          data-testid={`gene-glyph-shimmer-${t.id}`}
          x={0}
          y={rect.yTop}
          width={width}
          height={h}
        />,
      );
    }
    if (rects.length === 0) return null;
    return (
      <g className="vv-loading-overlay" aria-hidden>
        {rects}
      </g>
    );
  }, [flatTracks, trackStates, layout.trackRects, width]);

  useLayoutEffect(() => {
    if (!tooltipTarget) return;
    const track = flatTracks.find((t) => t.id === tooltipTarget.trackId);
    const data = track ? trackData.get(track.id) : undefined;
    const svg = svgRef.current;
    const wrap = figureWrapRef.current;
    if (!track || data === undefined || !track.resolveAnchor || !svg || !wrap) return;
    const point = track.resolveAnchor(data, tooltipTarget.featureId, viewport);
    const rect = layout.trackRects.get(track.id);
    if (point && rect) {
      // JSDOM doesn't implement getScreenCTM / createSVGPoint; tests that mount
      // <GeneGlyph> just to assert tracks render shouldn't crash here.
      if (typeof svg.getScreenCTM !== 'function') return;
      const ctm = svg.getScreenCTM();
      if (ctm) {
        const pt = svg.createSVGPoint();
        pt.x = point.x;
        pt.y = (rect.yTop + rect.yBottom) / 2;
        const sp = pt.matrixTransform(ctm);
        const wr = wrap.getBoundingClientRect();
        setTooltipPos({ x: sp.x - wr.left, y: sp.y - wr.top });
      }
    } else {
      setTooltipPos(null);
    }
  }, [tooltipTarget, flatTracks, trackData, viewport, layout.trackRects, viewportVersion]);

  const tooltipNode = useMemo<ReactNode>(() => {
    if (!tooltipTarget || !tooltipPos) return null;
    const track = flatTracks.find((t) => t.id === tooltipTarget.trackId);
    const data = track ? trackData.get(track.id) : undefined;
    if (!track || data === undefined) return null;
    const feature = track.resolveFeature ? track.resolveFeature(data, tooltipTarget.featureId) : undefined;
    let content: ReactNode = null;
    if (renderTooltip) {
      content = renderTooltip({
        trackId: tooltipTarget.trackId,
        featureId: tooltipTarget.featureId,
        feature,
        point: tooltipPos,
      });
    } else if (track.featureLabel) {
      const label = track.featureLabel(data, tooltipTarget.featureId);
      if (label) content = label;
    }
    if (content === null || content === undefined || content === false) return null;
    return (
      <div
        className="vv-tooltip"
        role="tooltip"
        data-testid="gene-glyph-tooltip"
        data-vv-track-id={tooltipTarget.trackId}
        data-vv-feature-id={tooltipTarget.featureId}
        style={{ left: tooltipPos.x, top: tooltipPos.y }}
      >
        {content}
      </div>
    );
  }, [tooltipTarget, tooltipPos, flatTracks, trackData, renderTooltip]);

  const belowNodes: ReactNode[] = [];
  for (const t of flatTracks) {
    if (!t.renderBelow) continue;
    const args = trackRenderArgsFor(t);
    if (!args) continue;
    const node = t.renderBelow(args);
    if (node) belowNodes.push(<div key={t.id}>{node}</div>);
  }

  const leftGutter = findSlot<LeftGutterProps>(children, LeftGutter);
  const rightGutter = findSlot<RightGutterProps>(children, RightGutter);
  const headerSlot = findSlot<HeaderProps>(children, Header);
  const footerSlot = findSlot<FooterProps>(children, Footer);
  const gutterItems = useMemo(() => gutterItemsFor(layout.items), [layout.items]);

  const renderGutter = (
    side: 'left' | 'right',
    gutterWidth: number,
    renderItem: (item: GutterItem) => ReactNode,
  ) => (
    <div
      className={`vv-${side}-gutter`}
      data-testid={`gene-glyph-${side}-gutter`}
      style={{ width: gutterWidth, height: renderedHeight }}
    >
      {gutterItems.map((item) => {
        const node = renderItem(item);
        if (node === null || node === undefined || node === false) return null;
        const fullHeight = Math.max(0, item.rect.yBottom - item.rect.yTop);
        // When a group reserved a header slot via `TrackGroup.headerHeight`,
        // size its gutter cell to that slot — children are laid out below
        // it (their yTops are shifted by the same amount in the layout
        // engine), so the parent chevron + first child no longer share a
        // y range and stop overlapping.
        const h_vbox =
          item.kind === 'group' && item.headerHeight && item.headerHeight > 0
            ? item.headerHeight
            : fullHeight;
        // The SVG renders 1:1 with its viewBox now (viewBox dimensions
        // track the wrap's measured CSS width + `totalHeight`), so
        // gutter items take their `yTop` / `height` straight from the
        // layout result.
        const top = item.rect.yTop;
        const height = h_vbox;
        return (
          <div
            key={`${item.kind}-${item.id}`}
            className={`vv-gutter-item vv-gutter-${item.kind}`}
            data-vv-item-id={item.id}
            data-vv-item-kind={item.kind}
            style={{ top, height }}
          >
            {node}
          </div>
        );
      })}
    </div>
  );

  const figureRow = (
    <div className="vv-figure-row">
      {leftGutter ? renderGutter('left', leftGutter.props.width, leftGutter.props.children) : null}
      <div
        className="vv-figure-wrap"
        ref={figureWrapRef}
        onPointerMove={handleFigurePointerMove}
        onPointerLeave={handleFigurePointerLeave}
      >
        <svg
          ref={svgRef}
          className="vv-figure"
          viewBox={`0 0 ${effectiveWidth} ${totalHeight}`}
          preserveAspectRatio="xMidYMid meet"
          width="100%"
          height={renderedHeight}
          role="img"
          aria-label={aria}
          onPointerDown={interactions.onPointerDown}
          onContextMenu={interactions.onContextMenu}
        >
          <title>{aria}</title>
          {flatTracks.map((t) => {
            const args = trackRenderArgsFor(t);
            if (!args) return null;
            return (
              <g key={t.id} data-vv-track-id={t.id}>
                {t.render(args)}
              </g>
            );
          })}
          {brushOverlay}
          {boxZoomPreview && boxZoomPreview[1] > boxZoomPreview[0] && (
            <rect
              className="vv-box-zoom-rect"
              data-testid="gene-glyph-box-zoom"
              x={boxZoomPreview[0]}
              y={0}
              width={boxZoomPreview[1] - boxZoomPreview[0]}
              height={Math.max(totalHeight, OVERFLOW_BRUSH_HEIGHT)}
              vectorEffect="non-scaling-stroke"
              aria-hidden
            />
          )}
          {loadingShimmer}
        </svg>
        <div
          className="vv-overlay-layer"
          data-testid="gene-glyph-overlay-layer"
          aria-hidden
        >
          {tooltipNode}
        </div>
      </div>
      {rightGutter ? renderGutter('right', rightGutter.props.width, rightGutter.props.children) : null}
    </div>
  );

  const headerNode = headerSlot ? (
    <div
      className="vv-header-slot"
      data-testid="gene-glyph-header-slot"
      style={headerSlot.props.height ? { minHeight: headerSlot.props.height } : undefined}
    >
      {headerSlot.props.children}
    </div>
  ) : (
    <GeneGlyphHeader transcript={transcript} protein={protein ?? null} />
  );

  const footerNode = footerSlot ? (
    <div
      className="vv-footer-slot"
      data-testid="gene-glyph-footer-slot"
      style={footerSlot.props.height ? { minHeight: footerSlot.props.height } : undefined}
    >
      {footerSlot.props.children}
    </div>
  ) : null;

  return (
    <div
      ref={containerRef}
      className={['gene-glyph', tooltipTarget ? 'vv-hover-active' : null, className]
        .filter(Boolean)
        .join(' ')}
      data-testid="gene-glyph"
      data-vv-mode={mode}
      data-vv-interaction-mode={interactionMode}
      data-vv-stale={stale ? '' : undefined}
      tabIndex={0}
      onKeyDown={interactions.onKeyDown}
    >
      {headerNode}
      {figureRow}
      {belowNodes.length > 0 && (
        <div className="vv-below" data-testid="gene-glyph-below">
          {belowNodes}
        </div>
      )}
      {footerNode}
    </div>
  );
}

export const GeneGlyph = forwardRef<GeneGlyphRef, GeneGlyphProps>(GeneGlyphInner) as
  ForwardRefExoticComponent<GeneGlyphProps & RefAttributes<GeneGlyphRef>> & {
    LeftGutter: typeof LeftGutter;
    RightGutter: typeof RightGutter;
    Header: typeof Header;
    Footer: typeof Footer;
  };
GeneGlyph.displayName = 'GeneGlyph';
GeneGlyph.LeftGutter = LeftGutter;
GeneGlyph.RightGutter = RightGutter;
GeneGlyph.Header = Header;
GeneGlyph.Footer = Footer;

interface DefaultHeaderProps {
  transcript: Transcript;
  protein: ProteinAnnotations | null;
}

function GeneGlyphHeader({ transcript, protein }: DefaultHeaderProps) {
  const cdsLen = Math.max(1, transcript.cdsLength);
  return (
    <div className="vv-header" data-testid="gene-glyph-header">
      <span className="vv-header-left">
        <span className="vv-gene-symbol">{transcript.geneSymbol}</span>
        <span className="vv-sep"> · </span>
        <span className="vv-transcript-id">{transcript.transcriptId}</span>
        {transcript.isManeSelect && (
          <>
            <span className="vv-sep"> · </span>
            <span className="vv-mane-badge" title="MANE Select transcript">
              MANE Select
            </span>
          </>
        )}
        {protein?.alphafoldId && (
          <>
            <span className="vv-sep"> · </span>
            <a
              className="vv-alphafold-link"
              href={`https://alphafold.ebi.ac.uk/entry/${protein.alphafoldId}`}
              target="_blank"
              rel="noopener noreferrer"
              title="Open AlphaFold structure"
            >
              AlphaFold ↗
            </a>
          </>
        )}
      </span>
      <span className="vv-header-right">
        <span className="vv-strand">{transcript.strand === '+' ? "5' →" : "← 5'"}</span>
        <span className="vv-sep"> · </span>
        <span className="vv-cds-length">{cdsLen.toLocaleString()} nt CDS</span>
      </span>
    </div>
  );
}
