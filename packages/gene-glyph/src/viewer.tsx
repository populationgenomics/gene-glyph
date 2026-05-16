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
  type HiddenFeatureBucket,
  type InteractionMode,
  type InteractionState,
  type ProteinAnnotations,
  type Track,
  type TooltipRenderArgs,
  type TrackOrGroup,
  type TrackRect,
  type Transcript,
  type ViewMode,
  type ViewportChangeReason,
} from './types.js';
import {
  DEFAULT_MAX_ZOOM,
  DEFAULT_TRANSITION_MS,
  MODE_TRANSITION_MS,
  ViewportController,
  type TransitionOptions,
  type TransitionTarget,
} from './viewport.js';
import { useViewportInteractions } from './use-viewport-interactions.js';

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
   *  `cds-with-introns`. */
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
 *  interpolated through any in-flight programmatic transition; `zoom` is
 *  derived from it. */
export interface ViewportInfo {
  mode: ViewMode;
  range: readonly [number, number];
  zoom: number;
  layout: ReadonlyArray<LayoutItem>;
}

/** Imperative-ref API surface exposed by `<GeneGlyph>`. Slice 8 ships the
 *  first three methods; `exportSVG` and `exportPNG` land in Slice 17. */
export interface GeneGlyphRef {
  fitTo(target: FitTarget): void;
  zoomBy(factor: number): void;
  getViewportInfo(): ViewportInfo;
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
    interactionMode = 'standard',
    viewportRange,
    defaultViewportRange,
    onViewportChange,
    minZoom,
    maxZoom = DEFAULT_MAX_ZOOM,
    className,
    children,
  }: GeneGlyphProps,
  ref: Ref<GeneGlyphRef>,
) {
  const controlled = viewportRange !== undefined;
  const brushControlled = controlledBrushRange !== undefined;
  const [uncontrolledMode] = useState<ViewMode>(
    () => defaultMode ?? 'cds-with-introns',
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
  // Construct the viewport once per (mapper, width). Mode changes are applied
  // via `setMode` on the existing instance so CSS transitions on the
  // viewport-published variables can interpolate exon-x and intron-scale
  // between modes — recreating the controller on every mode change would
  // snap geometry, killing the animation.
  const viewport = useMemo(
    () =>
      new ViewportController({
        mapper,
        width,
        mode,
        range: initialRange,
      }),
    // `mode` and `initialRange` only seed construction; later changes reach
    // the viewport via the prop-sync effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mapper, width],
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

  // `tick` bumps whenever the viewer mutates viewport state imperatively
  // (fitTo/zoomBy). It feeds into the layout `useMemo` dep list so tracks
  // re-render against the new range; visual interpolation between the old
  // and new geometry is provided by CSS transitions on `.vv-exon-group`
  // and `.vv-intron-decoration` per design §8.
  const [tick, setTick] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  const [modeTransitioning, setModeTransitioning] = useState(false);
  const [noTransition, setNoTransition] = useState(false);
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modeTransitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const bumpTick = useCallback(() => setTick((t) => t + 1), []);

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

  // Mirror the active mode onto the viewport. Two coupled updates need to
  // land in the same paint:
  //   (a) the viewport publishes new exon-x / intron-scale CSS variables
  //       (so transforms recompute), and
  //   (b) `.vv-mode-transitioning` activates the 450ms ease-in-out-quart
  //       curve override (so the transition uses the mode-change curve
  //       instead of the always-on 350ms pan/zoom curve).
  // Doing (a) in render and (b) in a `useEffect` splits them across two
  // paints — the var change fires the transition with the old curve before
  // the class lands. Defer the viewport update to the same `useLayoutEffect`
  // that toggles the class so the browser sees both at once.
  const previousModeRef = useRef<ViewMode>(mode);
  useLayoutEffect(() => {
    if (previousModeRef.current === mode && viewport.mode === mode) return;
    const isFirstSync = previousModeRef.current === mode;
    previousModeRef.current = mode;
    if (viewport.mode !== mode) viewport.setMode(mode);
    bumpTick();
    if (isFirstSync) return;
    setModeTransitioning(true);
    if (modeTransitionTimerRef.current !== null)
      clearTimeout(modeTransitionTimerRef.current);
    modeTransitionTimerRef.current = setTimeout(() => {
      setModeTransitioning(false);
      modeTransitionTimerRef.current = null;
    }, MODE_TRANSITION_MS + 16);
    onModeChange?.(mode);
  }, [mode, viewport, onModeChange, bumpTick]);

  const cancelTransition = useCallback(() => {
    if (transitionTimerRef.current !== null) {
      clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }
    if (transitioning) setTransitioning(false);
  }, [transitioning]);

  useEffect(
    () => () => {
      if (transitionTimerRef.current !== null) clearTimeout(transitionTimerRef.current);
      if (modeTransitionTimerRef.current !== null)
        clearTimeout(modeTransitionTimerRef.current);
    },
    [],
  );


  const [trackData, setTrackData] = useState<Map<string, unknown>>(() => new Map());
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    const proteinArg = protein ?? null;
    void Promise.all(
      flatTracks.map(async (t) => {
        const data = await t.load({
          viewport,
          mapper,
          signal: controller.signal,
          protein: proteinArg,
        });
        return [t.id, data] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      setTrackData(new Map(entries));
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [flatTracks, viewport, mapper, protein]);

  const layout = useMemo(
    () =>
      layoutTracks({
        tracks: trackList,
        viewport,
        data: trackData,
        totalHeightBudget: trackHeightBudget,
      }),
    // `tick` forces recompute after gestures / imperative viewport mutations;
    // `viewportRange` lets controlled hosts drive layout without going via
    // tick (the prop-sync useMemo above writes it into `viewport` first).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trackList, viewport, trackData, trackHeightBudget, tick, viewportRange],
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
        // Clear the stale position so a subsequent hover doesn't briefly
        // render the new tooltip at the old anchor before the rAF tick lands.
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

  const beginTransition = useCallback(
    (target: TransitionTarget, options?: TransitionOptions) => {
      const duration = options?.duration ?? DEFAULT_TRANSITION_MS;
      setNoTransition(false);
      viewport.transitionTo(target, options);
      bumpTick();
      setTransitioning(true);
      if (transitionTimerRef.current !== null) clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = setTimeout(() => {
        setTransitioning(false);
        transitionTimerRef.current = null;
      }, duration + 16);
      if (target.range) onViewportChange?.([target.range[0], target.range[1]], 'imperative');
    },
    [viewport, onViewportChange, bumpTick],
  );

  const interactions = useViewportInteractions({
    viewport,
    svgRef,
    containerRef,
    mode: interactionMode,
    minZoom,
    maxZoom,
    controlled,
    bumpTick,
    onChange: useCallback(
      (range, reason) => {
        onViewportChange?.(range, reason);
      },
      [onViewportChange],
    ),
    onBrush: applyBrush,
    cancelTransition,
    setNoTransition,
  });

  const fitTo = useCallback(
    (target: FitTarget) => {
      if (target.kind === 'gene') {
        beginTransition({ range: viewport.naturalRange() });
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
        beginTransition({ range: [lo, hi] });
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
      const cds = tempViewport.screenToCds(point.x);
      if (!cds) return;
      const natural = viewport.naturalRange();
      const naturalLen = natural[1] - natural[0];
      const window = Math.max(1, naturalLen / 10);
      let center: number;
      if (viewport.mode === 'protein') {
        const aa = mapper.cdsToProtein(cds.cPos);
        if (aa === null) return;
        center = aa;
      } else {
        center = cds.cPos;
      }
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
      beginTransition({ range: [lo, hi] });
    },
    [beginTransition, viewport, flatTracks, trackData, mapper, brush],
  );

  const zoomBy = useCallback(
    (factor: number) => {
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
      beginTransition({ range: [nlo, nhi] });
    },
    [beginTransition, viewport],
  );

  const getViewportInfo = useCallback((): ViewportInfo => {
    const range = viewport.getInterpolatedRange();
    const natural = viewport.naturalRange();
    const naturalLen = natural[1] - natural[0];
    const rangeLen = range[1] - range[0];
    const zoom = rangeLen > 0 ? naturalLen / rangeLen : 1;
    return {
      mode: viewport.mode,
      range,
      zoom,
      layout: layout.items,
    };
  }, [viewport, layout]);

  useImperativeHandle(
    ref,
    () => ({ fitTo, zoomBy, getViewportInfo }),
    [fitTo, zoomBy, getViewportInfo],
  );

  const aaLength = Math.floor(transcript.cdsLength / 3);
  const aria = `${transcript.geneSymbol} (${transcript.transcriptId}) — ${aaLength} aa`;

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
  }, [flatTracks, trackData, viewport, mapper, tick]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // Fill inter-exon gaps in cds-with-introns mode so the brush reads as a
    // single continuous strip across adjacent touched exons. In spliced /
    // protein modes the gap collapses (intronScale=0) so the gap rect is
    // invisible there anyway; rendering it is still cheap and keeps the
    // mode-transition cross-fade aligned with the exon decoration.
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
  }, [brush, viewport, painter, totalHeight, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!tooltipTarget) return undefined;
    let raf = 0;
    const tick = () => {
      const track = flatTracks.find((t) => t.id === tooltipTarget.trackId);
      const data = track ? trackData.get(track.id) : undefined;
      const svg = svgRef.current;
      const wrap = figureWrapRef.current;
      if (track && data !== undefined && track.resolveAnchor && svg && wrap) {
        const point = track.resolveAnchor(data, tooltipTarget.featureId, viewport);
        const rect = layout.trackRects.get(track.id);
        if (point && rect) {
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
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [tooltipTarget, flatTracks, trackData, viewport, layout.trackRects]);

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
      className={[
        'gene-glyph',
        transitioning && 'vv-transitioning',
        modeTransitioning && 'vv-mode-transitioning',
        noTransition && 'vv-no-transition',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      data-testid="gene-glyph"
      data-vv-transitioning={transitioning ? '' : undefined}
      data-vv-mode-transitioning={modeTransitioning ? '' : undefined}
      data-vv-mode={mode}
      data-vv-interaction-mode={interactionMode}
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
