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
}

function flattenTracks(items: TrackOrGroup[]): Track[] {
  const out: Track[] = [];
  for (const item of items) {
    if (isTrackGroup(item)) {
      for (const t of item.tracks) out.push(t);
    } else {
      out.push(item);
    }
  }
  return out;
}

function toReadonlySet(ids: ReadonlySet<string> | Iterable<string> | undefined): ReadonlySet<string> {
  if (!ids) return EMPTY_SET;
  if (ids instanceof Set) return ids;
  return new Set(ids);
}

const EMPTY_SET: ReadonlySet<string> = new Set<string>();

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
  for (const item of items) {
    out.push({
      kind: item.kind,
      id: item.id,
      label: item.label,
      rect: item.rect,
      didTruncate: item.didTruncate,
      droppedCount: item.droppedCount,
    });
    if (item.kind === 'group' && item.children) {
      for (const child of item.children) {
        out.push({
          kind: child.kind,
          id: child.id,
          label: child.label,
          rect: child.rect,
          didTruncate: child.didTruncate,
          droppedCount: child.droppedCount,
        });
      }
    }
  }
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
    loadDebounceMs = 120,
    interactionMode = 'standard',
    viewportRange,
    defaultViewportRange,
    onViewportChange,
    minZoom,
    maxZoom = DEFAULT_MAX_ZOOM,
    collapsedRegions: collapsedRegionsProp,
    className,
    children,
  }: GeneGlyphProps,
  ref: Ref<GeneGlyphRef>,
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
  const flatTracks = useMemo(() => flattenTracks(trackList), [trackList]);
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
    // `mode` and `initialRange` only seed construction; later changes reach
    // the viewport via the prop-sync effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mapper, width, collapsedRegions],
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
  useMemo(() => {
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
    () => flatTracks.map((t) => t.id).join('|'),
    [flatTracks],
  );
  const flatTracksRef = useRef(flatTracks);
  flatTracksRef.current = flatTracks;

  // Drop state for tracks that were removed from the stack so stale entries
  // don't linger across track-list edits. setState calls are gated by an
  // actual diff so the effect is a no-op when the track list is unchanged
  // (which is the common case and what the lint rule is concerned about).
  useEffect(() => {
    const live = new Set(flatTracksRef.current.map((t) => t.id));
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
      }),
    // `viewportVersion` re-runs layout when the viewport's committed range or
    // mode changes (gesture / imperative); `viewportRange` lets controlled
    // hosts drive layout without going through the subscription (the
    // prop-sync useMemo above writes it into `viewport` first).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trackList, viewport, trackData, trackHeightBudget, viewportVersion, viewportRange],
  );

  const totalHeight = Math.max(1, layout.totalHeight);

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

  const handleHover = useCallback(
    (trackId: string, featureId: string | null) => {
      onHover?.(featureId, trackId);
      if (featureId) {
        setTooltipTarget({ trackId, featureId });
      } else {
        setTooltipTarget(null);
        setTooltipPos(null);
      }
    },
    [onHover],
  );

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
      const viewBox = svg.getAttribute('viewBox') ?? `0 0 ${width} ${totalHeight}`;
      const parts = viewBox.split(/[\s,]+/).map(Number);
      const vbW = Number.isFinite(parts[2]) ? (parts[2] as number) : width;
      const vbH = Number.isFinite(parts[3]) ? (parts[3] as number) : totalHeight;
      return exportPngBlob({
        svgString,
        widthPx,
        viewBoxWidth: vbW,
        viewBoxHeight: vbH,
      });
    },
    [aria, exportDescription, width, totalHeight],
  );

  const subscribe = useCallback(
    (listener: () => void) => viewport.subscribe(listener),
    [viewport],
  );

  useImperativeHandle(
    ref,
    () => ({ fitTo, zoomBy, getViewportInfo, subscribe, exportSVG, exportPNG }),
    [fitTo, zoomBy, getViewportInfo, subscribe, exportSVG, exportPNG],
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
    return merged;
  }, [flatTracks, trackData, viewport, mapper, viewportVersion]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const projection =
      viewport.mode === 'protein'
        ? viewport.projectProteinRange(lo, hi)
        : viewport.projectCdsRange(lo, hi);
    if (projection.segments.length === 0) return null;
    const geom = viewport.baselineGeometry();
    const cellsByExon = new Map<number, { xStart: number; xEnd: number }>();
    for (const seg of projection.segments) {
      const eb = geom.exons[seg.exonIdx];
      if (!eb) continue;
      const xStart = Math.max(0, seg.xStart - eb.xStart);
      const xEnd = Math.min(eb.width, seg.xEnd - eb.xStart);
      if (!(xEnd > xStart)) continue;
      cellsByExon.set(seg.exonIdx, { xStart, xEnd });
    }
    const parts: ReactNode[] = [];
    const sortedIdx = [...cellsByExon.keys()].sort((p, q) => p - q);
    for (const i of sortedIdx) {
      const c = cellsByExon.get(i)!;
      parts.push(
        painter.placeInExonGroup(
          i,
          <rect
            key={`brush-exon-${i}`}
            className="vv-brush-rect"
            x={c.xStart}
            y={0}
            width={c.xEnd - c.xStart}
            height={totalHeight}
            vectorEffect="non-scaling-stroke"
          />,
        ),
      );
    }
    // Fill inter-exon gaps in genome mode so the brush reads as a
    // single continuous strip across adjacent touched exons. In spliced /
    // protein modes the gap collapses (intronScale=0) so the gap rect is
    // invisible there anyway.
    for (let k = 0; k < sortedIdx.length - 1; k++) {
      const a0 = sortedIdx[k]!;
      const b0 = sortedIdx[k + 1]!;
      if (b0 !== a0 + 1) continue;
      const gap = geom.gaps[a0];
      if (!gap || gap.width <= 0) continue;
      parts.push(
        painter.placeInInterExon(
          a0,
          b0,
          <rect
            key={`brush-gap-${a0}-${b0}`}
            className="vv-brush-rect vv-brush-rect-gap"
            x={0}
            y={0}
            width={gap.width}
            height={totalHeight}
            vectorEffect="non-scaling-stroke"
          />,
        ),
      );
    }
    return (
      <g className="vv-brush-overlay" data-testid="gene-glyph-brush" aria-hidden>
        {parts}
      </g>
    );
  }, [brush, viewport, painter, totalHeight, viewportVersion]); // eslint-disable-line react-hooks/exhaustive-deps

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
      style={{ width: gutterWidth, height: totalHeight }}
    >
      {gutterItems.map((item) => {
        const node = renderItem(item);
        if (node === null || node === undefined || node === false) return null;
        const h = Math.max(0, item.rect.yBottom - item.rect.yTop);
        return (
          <div
            key={`${item.kind}-${item.id}`}
            className={`vv-gutter-item vv-gutter-${item.kind}`}
            data-vv-item-id={item.id}
            data-vv-item-kind={item.kind}
            style={{ top: item.rect.yTop, height: h }}
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
      <div className="vv-figure-wrap" ref={figureWrapRef}>
        <svg
          ref={svgRef}
          className="vv-figure"
          viewBox={`0 0 ${width} ${totalHeight}`}
          preserveAspectRatio="xMidYMid meet"
          width="100%"
          height={totalHeight}
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
      className={['gene-glyph', className].filter(Boolean).join(' ')}
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
