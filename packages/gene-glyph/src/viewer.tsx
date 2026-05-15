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
  type InteractionState,
  type ProteinAnnotations,
  type Track,
  type TrackOrGroup,
  type TrackRect,
  type Transcript,
  type ViewMode,
} from './types.js';
import {
  DEFAULT_TRANSITION_MS,
  ViewportController,
  type TransitionOptions,
  type TransitionTarget,
} from './viewport.js';

export interface GeneGlyphProps {
  transcript: Transcript;
  protein?: ProteinAnnotations | null;
  /** Track list, ordered top to bottom. Defaults to a single `exonTrack`. */
  tracks?: TrackOrGroup[];
  /** Logical width of the figure SVG in viewBox units. Default 1000. */
  width?: number;
  /** Initial view mode. Default `cds-with-introns`. */
  mode?: ViewMode;
  /** Maximum vertical height budget for the track stack. Default 200. */
  trackHeightBudget?: number;
  /** Controlled-prop: feature id currently hovered by the host (e.g., from a
   *  table row). Tracks render the matching feature with a hover lift. */
  hoveredFeatureId?: string | null;
  /** Controlled-prop: feature ids currently selected by the host. Tracks
   *  render the matching features with a selection ring. Accepts a Set or any
   *  iterable for ergonomic callers. */
  selectedFeatureIds?: ReadonlySet<string> | Iterable<string>;
  /** Fires when the cursor enters a feature (with featureId) or leaves all
   *  features (`null`). The originating track id is passed for hosts that
   *  multiplex over tracks. */
  onHover?: (featureId: string | null, trackId: string) => void;
  /** Fires when a feature is clicked. */
  onFeatureClick?: (featureId: string, trackId: string) => void;
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
 *  `range`; `selection` arrives with brush in Slice 14. */
export type FitTarget =
  | { kind: 'gene' }
  | { kind: 'feature'; trackId: string; featureId: string }
  | { kind: 'range'; range: readonly [number, number] };

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
    mode = 'cds-with-introns',
    trackHeightBudget = 200,
    hoveredFeatureId = null,
    selectedFeatureIds,
    onHover,
    onFeatureClick,
    className,
    children,
  }: GeneGlyphProps,
  ref: Ref<GeneGlyphRef>,
) {
  const trackList = useMemo<TrackOrGroup[]>(
    () => (tracks && tracks.length > 0 ? tracks : [exonTrack({})]),
    [tracks],
  );
  const flatTracks = useMemo(() => flattenTracks(trackList), [trackList]);
  const mapper = useMemo(() => createCoordinateMapper(transcript), [transcript]);
  const viewport = useMemo(
    () => new ViewportController({ mapper, width, mode }),
    [mapper, width, mode],
  );
  const painter = useMemo(() => createSvgPainter({ mode: 'screen' }), []);

  const svgRef = useRef<SVGSVGElement | null>(null);
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
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (transitionTimerRef.current !== null) clearTimeout(transitionTimerRef.current);
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
    // `tick` forces recompute after imperative viewport mutations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trackList, viewport, trackData, trackHeightBudget, tick],
  );

  const totalHeight = Math.max(1, layout.totalHeight);

  const selectedSet = useMemo(() => toReadonlySet(selectedFeatureIds), [selectedFeatureIds]);
  const interaction = useMemo<InteractionState>(
    () => ({
      hoveredFeatureId,
      selectedFeatureIds: selectedSet,
      brushRange: null,
    }),
    [hoveredFeatureId, selectedSet],
  );

  const handleHover = useCallback(
    (trackId: string, featureId: string | null) => {
      onHover?.(featureId, trackId);
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
      viewport.transitionTo(target, options);
      setTick((t) => t + 1);
      setTransitioning(true);
      if (transitionTimerRef.current !== null) clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = setTimeout(() => {
        setTransitioning(false);
        transitionTimerRef.current = null;
      }, duration + 16);
    },
    [viewport],
  );

  const fitTo = useCallback(
    (target: FitTarget) => {
      if (target.kind === 'gene') {
        beginTransition({ range: viewport.naturalRange() });
        return;
      }
      if (target.kind === 'range') {
        const natural = viewport.naturalRange();
        const lo = Math.max(natural[0], Math.min(target.range[0], target.range[1]));
        const hi = Math.min(natural[1], Math.max(target.range[0], target.range[1]));
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
    [beginTransition, viewport, flatTracks, trackData, mapper],
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
      onFeatureHover: (featureId: string | null) => handleHover(t.id, featureId),
      onFeatureClick: (featureId: string) => handleClick(t.id, featureId),
    };
  };

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
      <svg
        ref={svgRef}
        className="vv-figure"
        viewBox={`0 0 ${width} ${totalHeight}`}
        preserveAspectRatio="xMidYMid meet"
        width="100%"
        height={totalHeight}
        role="img"
        aria-label={aria}
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
      </svg>
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
      className={['gene-glyph', transitioning && 'vv-transitioning', className]
        .filter(Boolean)
        .join(' ')}
      data-testid="gene-glyph"
      data-vv-transitioning={transitioning ? '' : undefined}
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
