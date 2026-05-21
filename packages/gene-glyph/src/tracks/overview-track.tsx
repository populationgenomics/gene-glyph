import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createSvgPainter } from '../painter/svg-painter.js';
import { ProjectionFrame } from '../projection-frame.js';
import { ViewportController } from '../viewport.js';
import type {
  BaselineGeometry,
  CoordinateMapper,
  ExonBaseline,
  GapBaseline,
  Track,
  TrackHeightArgs,
  TrackHeightResult,
  TrackLoadArgs,
  TrackRenderArgs,
  Viewport,
} from '../types.js';
import type { GeneGlyphRef } from '../viewer.js';

export interface OverviewTrackConfig {
  id?: string;
  /** Ref handed to `<GeneGlyph>`. The overview polls the live viewport
   *  via `getViewportInfo()` for the bounds rectangle, and writes pan /
   *  zoom back via `fitTo`. */
  viewerRef: RefObject<GeneGlyphRef | null>;
  /** Tracks whose `renderMinimap` outputs should appear inside the
   *  overview, stacked vertically. The host typically passes the same
   *  list it threads into `<GeneGlyph tracks={…}>` (or a subset). Tracks
   *  without a `renderMinimap` hook are skipped silently. */
  tracks?: Track[];
  /** Per-track minimap row height in pixels. Default 16. The overview's
   *  total height is `tracks.length × rowHeight + 2 × verticalPadding`,
   *  or {@link OverviewTrackConfig.height} when supplied. */
  rowHeight?: number;
  /** Vertical breathing room above + below the stacked rows. Default 4. */
  verticalPadding?: number;
  /** Override the auto-computed track height. When omitted, the height
   *  is derived from the number of rows + padding. */
  height?: number;
  /** Half-width of the draggable edge handles. Default 6. */
  handlePx?: number;
}

interface OverviewTrackData {
  ready: true;
}

const DEFAULT_ROW_HEIGHT = 16;
const DEFAULT_VERTICAL_PADDING = 4;
const DEFAULT_HANDLE_PX = 6;

/**
 * Slice 26 — overview track. A wholly display-space minimap rendered
 * inside the figure SVG. Operates on its own mini-viewport pinned to
 * fit-gene at the figure's width; the live figure viewport is consulted
 * only to read the current visible CDS range for the bounds rectangle
 * and to write pan/zoom commands back via the imperative ref.
 *
 * Each upstream track passed via {@link OverviewTrackConfig.tracks} that
 * implements `Track.renderMinimap` contributes one row of content inside
 * the overview. Tracks without the hook (overlay-only, the overview
 * itself) are skipped. The bounds rectangle overlays every row so the
 * user can see which slice of the gene is currently in view across the
 * whole stack at a glance.
 *
 * Trade-off vs. {@link DefaultMinimap}: the overview lives inside the
 * figure SVG and therefore rides along on `exportSVG()` / `exportPNG()`;
 * the default minimap is React DOM chrome that's dropped on export.
 */
export function overviewTrack(
  config: OverviewTrackConfig,
): Track<OverviewTrackConfig, OverviewTrackData> {
  const id = config.id ?? 'overview-track';
  const rowHeight = config.rowHeight ?? DEFAULT_ROW_HEIGHT;
  const verticalPadding = config.verticalPadding ?? DEFAULT_VERTICAL_PADDING;
  const handlePx = config.handlePx ?? DEFAULT_HANDLE_PX;
  const upstreamTracks = config.tracks ?? [];
  const viewerRef = config.viewerRef;

  const autoHeight = upstreamTracks.length * rowHeight + 2 * verticalPadding;
  const trackHeight = config.height ?? Math.max(autoHeight, rowHeight + 2 * verticalPadding);

  return {
    id,
    coordSystem: 'cds',
    heightPolicy: 'fixed',

    async load(_args: TrackLoadArgs): Promise<OverviewTrackData> {
      return { ready: true };
    },

    height(_args: TrackHeightArgs<OverviewTrackData>): TrackHeightResult {
      return { px: trackHeight, didTruncate: false };
    },

    render(args: TrackRenderArgs<OverviewTrackData>): ReactNode {
      return (
        <OverviewTrackImpl
          key={id}
          trackId={id}
          viewerRef={viewerRef}
          viewport={args.viewport}
          mapper={args.mapper}
          rect={args.rect}
          tracks={upstreamTracks}
          rowHeight={rowHeight}
          verticalPadding={verticalPadding}
          handlePx={handlePx}
        />
      );
    },

    toJSON() {
      return {
        id,
        viewerRef,
        height: trackHeight,
        rowHeight,
        verticalPadding,
        handlePx,
      };
    },
  };
}

interface OverviewTrackImplProps {
  trackId: string;
  viewerRef: RefObject<GeneGlyphRef | null>;
  /** Live figure viewport — only consulted for the visible CDS range and
   *  natural range. The overview never reads its CSS-variable transforms
   *  or geometry. */
  viewport: Viewport;
  mapper: CoordinateMapper;
  rect: { yTop: number; yBottom: number };
  tracks: Track[];
  rowHeight: number;
  verticalPadding: number;
  handlePx: number;
}

interface DragState {
  kind: 'pan' | 'resize-left' | 'resize-right';
  pointerId: number;
  startClientX: number;
  startRange: readonly [number, number];
  svg: SVGSVGElement | null;
}

function OverviewTrackImpl({
  trackId,
  viewerRef,
  viewport,
  mapper,
  rect,
  tracks,
  rowHeight,
  verticalPadding,
  handlePx,
}: OverviewTrackImplProps) {
  const width = viewport.width;
  const trackTop = rect.yTop;
  const trackHeight = rect.yBottom - rect.yTop;

  // Mirror the live viewer's committed range / natural range into state via
  // the imperative subscribe() hook. Re-fires on every committed mutation so
  // the bounds rectangle stays in step with whatever the figure shows.
  const [liveRange, setLiveRange] = useState<readonly [number, number]>(
    () => viewport.range,
  );
  const [naturalRange, setNaturalRange] = useState<readonly [number, number]>(
    () => viewport.naturalRange?.() ?? viewport.range,
  );
  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    const sync = () => {
      const live = viewerRef.current;
      if (!live) return;
      const info = live.getViewportInfo();
      setLiveRange((prev) =>
        prev[0] === info.range[0] && prev[1] === info.range[1]
          ? prev
          : [info.range[0], info.range[1]],
      );
      setNaturalRange((prev) =>
        prev[0] === info.naturalRange[0] && prev[1] === info.naturalRange[1]
          ? prev
          : [info.naturalRange[0], info.naturalRange[1]],
      );
    };
    sync();
    return v.subscribe(sync);
  }, [viewerRef]);

  const dragRef = useRef<DragState | null>(null);

  // Mini-viewport pinned to fit-gene at the figure's width. This is the
  // overview's "display space" — exons land at their baseline positions
  // here regardless of how the live figure is zoomed or panned. The
  // miniViewport is recreated when the transcript or mode changes; this
  // matches DefaultMinimap's approach. The Viewport interface is enough
  // for `Track.renderMinimap` to read baseline geometry.
  const transcriptId = mapper.transcript.transcriptId;
  const mode = viewport.mode;
  const miniViewport = useMemo(() => {
    return new ViewportController({
      mapper,
      width,
      mode,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapper, width, mode, transcriptId]);

  // Painter shared between rows. The mini-viewport doesn't publish CSS
  // variables, so `placeInExonGroup` outputs work in baseline frame
  // (translate(0) scale(1)) — that's exactly what minimap rendering wants.
  const minimapPainter = useMemo(() => createSvgPainter({ mode: 'screen' }), []);

  // Compose the per-track minimap rows. Each track that opts into
  // `renderMinimap` gets one row of `rowHeight` pixels inside the
  // overview's vertical band. Tracks without the hook are skipped (they
  // contribute nothing visually and don't take up vertical space).
  const minimapTracks = useMemo(
    () => tracks.filter((t) => typeof t.renderMinimap === 'function'),
    [tracks],
  );

  // Mirror the figure's gap-fix scaling in the minimap. The figure
  // renders exon content at `figureZoom` (live zoom factor — exon
  // content stretches with zoom, gaps stay at their baseline pixel
  // width). To keep the minimap's coordinates a linear scaling of the
  // figure's screen coordinates, compute "what the gene would look
  // like at this zoom if it spanned the figure's whole width" and
  // compress that to the minimap's width.
  const figureBaseGeom = viewport.baselineGeometry();
  const figureBaselineSpan = Math.max(
    1e-6,
    viewport.cdsToBaselineX(liveRange[1]) -
      viewport.cdsToBaselineX(liveRange[0]),
  );
  const figureZoom = viewport.width / figureBaselineSpan;
  const sumExonBaselineWidth = figureBaseGeom.exons.reduce(
    (s, e) => s + e.width,
    0,
  );
  const nGaps = Math.max(0, figureBaseGeom.exons.length - 1);
  const fullWidthAtZoom =
    sumExonBaselineWidth * figureZoom + nGaps * figureBaseGeom.gapPx;
  const compress = fullWidthAtZoom > 0 ? width / fullWidthAtZoom : 1;
  const scaledGapPx = figureBaseGeom.gapPx * compress;
  const scaledPxPerBp = figureBaseGeom.pxPerBp * figureZoom * compress;

  const scaledExons: ExonBaseline[] = [];
  const scaledGaps: GapBaseline[] = [];
  {
    let cursor = 0;
    for (let i = 0; i < figureBaseGeom.exons.length; i++) {
      const e = figureBaseGeom.exons[i]!;
      const newWidth = e.width * figureZoom * compress;
      scaledExons.push({
        exonIdx: i,
        xStart: cursor,
        xEnd: cursor + newWidth,
        width: newWidth,
      });
      cursor += newWidth;
      if (i < figureBaseGeom.exons.length - 1) {
        scaledGaps.push({
          exonIdxA: i,
          exonIdxB: i + 1,
          xStart: cursor,
          xEnd: cursor + scaledGapPx,
          width: scaledGapPx,
        });
        cursor += scaledGapPx;
      }
    }
  }
  const scaledGeom: BaselineGeometry = {
    exons: scaledExons,
    gaps: scaledGaps,
    pxPerBp: scaledPxPerBp,
    gapPx: scaledGapPx,
    totalWidth: width,
  };

  // The minimap's coord conversion is the same ruler / baseline math the
  // figure uses, just driven by the rescaled-to-minimap-width baseline.
  // Reusing `ProjectionFrame` keeps the per-exon walk, gap interpolation,
  // and protein-mode ruler semantics in one place — the live figure and
  // the minimap stay numerically aligned without parallel implementations.
  // ProjectionFrame's primary state is the baseline window — supply the
  // full scaled-geometry width so the minimap's mapping covers the whole
  // gene regardless of where the live figure is parked.
  const minimapFrame = new ProjectionFrame({
    baseline: scaledGeom,
    baselineWindow: [0, scaledGeom.totalWidth],
    width,
    mode: viewport.mode,
    exons: mapper.transcript.exons,
  });
  const cdsToMinimapX = (cPos: number): number => minimapFrame.rulerToBaselineX(cPos);
  const minimapXToCds = (x: number): number => minimapFrame.baselineXToRuler(x);

  // Bounds rectangle: project the figure's canonical baseline window
  // directly through the minimap's scaled-segment geometry — no ruler
  // round-trip. Inside a fixed-budget gap the synthetic ruler has zero
  // span, so the old `baselineXToRuler ∘ screenToBaselineX` route
  // collapsed any S_lo / S_hi inside a gap to the gap's boundary
  // ruler and made the bounds rectangle jump across the gap instead of
  // moving smoothly. Direct baseline-to-baseline mapping preserves
  // smooth motion across gaps.
  const figureToMinimap = (figureP: number): number => {
    const figureExons = figureBaseGeom.exons;
    const figureGaps = figureBaseGeom.gaps;
    if (figureExons.length === 0) return 0;
    const firstFigureExon = figureExons[0]!;
    if (figureP < firstFigureExon.xStart) {
      // Padding before the gene: 1:1 in figure baseline; compresses by
      // `compress` into minimap baseline.
      return scaledExons[0]!.xStart - (firstFigureExon.xStart - figureP) * compress;
    }
    for (let i = 0; i < figureExons.length; i++) {
      const fe = figureExons[i]!;
      if (figureP <= fe.xEnd) {
        const t = (figureP - fe.xStart) / Math.max(1e-9, fe.width);
        const se = scaledExons[i]!;
        return se.xStart + t * se.width;
      }
      if (i < figureGaps.length) {
        const fg = figureGaps[i]!;
        if (figureP <= fg.xEnd) {
          const t = (figureP - fg.xStart) / Math.max(1e-9, fg.width);
          const sg = scaledGaps[i]!;
          return sg.xStart + t * sg.width;
        }
      }
    }
    const lastFigureExon = figureExons[figureExons.length - 1]!;
    const lastScaledExon = scaledExons[scaledExons.length - 1]!;
    return lastScaledExon.xEnd + (figureP - lastFigureExon.xEnd) * compress;
  };
  const [figureSLo, figureSHi] = viewport.baselineWindow();
  const xLoRaw = figureToMinimap(figureSLo);
  const xHiRaw = figureToMinimap(figureSHi);
  const xLo = Math.max(0, Math.min(width, Math.min(xLoRaw, xHiRaw)));
  const xHi = Math.max(0, Math.min(width, Math.max(xLoRaw, xHiRaw)));
  const windowX = xLo;
  const windowW = Math.max(2, xHi - xLo);

  const clamp = useCallback(
    (range: readonly [number, number]): [number, number] => {
      const [nLo, nHi] = naturalRange;
      const len = Math.max(1e-3, range[1] - range[0]);
      let lo = range[0];
      let hi = range[1];
      if (lo < nLo) {
        lo = nLo;
        hi = lo + len;
      }
      if (hi > nHi) {
        hi = nHi;
        lo = hi - len;
      }
      lo = Math.max(nLo, lo);
      hi = Math.min(nHi, hi);
      return [lo, hi];
    },
    [naturalRange],
  );

  const clientToFigureX = useCallback(
    (clientX: number, svg: SVGSVGElement | null): number => {
      if (!svg) return 0;
      try {
        if (typeof svg.getScreenCTM === 'function') {
          const ctm = svg.getScreenCTM();
          if (ctm && typeof svg.createSVGPoint === 'function') {
            const pt = svg.createSVGPoint();
            pt.x = clientX;
            pt.y = 0;
            const local = pt.matrixTransform(ctm.inverse());
            return local.x;
          }
        }
      } catch {
        // fall through to ratio fallback
      }
      const rectBox = svg.getBoundingClientRect();
      const ratio = rectBox.width > 0 ? (clientX - rectBox.left) / rectBox.width : 0;
      return ratio * width;
    },
    [width],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      const v = viewerRef.current;
      if (!v) return;
      const baselineStart = clientToFigureX(drag.startClientX, drag.svg);
      const baselineNow = clientToFigureX(e.clientX, drag.svg);
      // Drag math runs in the *scaled* minimap frame. Each figure-svg
      // pixel of cursor movement maps 1:1 to the minimap's px (both
      // share the figure's width), and `minimapXToCds` reverses the
      // gap-fix scaling that the geometry uses.
      const xLoStart = cdsToMinimapX(drag.startRange[0]);
      const xHiStart = cdsToMinimapX(drag.startRange[1]);
      const dx = baselineNow - baselineStart;

      if (drag.kind === 'pan') {
        const newLo = minimapXToCds(xLoStart + dx);
        const newHi = minimapXToCds(xHiStart + dx);
        v.fitTo({ kind: 'range', range: clamp([newLo, newHi]) }, { animate: false });
        return;
      }
      if (drag.kind === 'resize-left') {
        const xLoNew = Math.min(xHiStart - 4, xLoStart + dx);
        const newLo = minimapXToCds(xLoNew);
        const newHi = drag.startRange[1];
        v.fitTo(
          { kind: 'range', range: clamp([Math.min(newLo, newHi - 1), newHi]) },
          { animate: false },
        );
        return;
      }
      if (drag.kind === 'resize-right') {
        const xHiNew = Math.max(xLoStart + 4, xHiStart + dx);
        const newHi = minimapXToCds(xHiNew);
        const newLo = drag.startRange[0];
        v.fitTo(
          { kind: 'range', range: clamp([newLo, Math.max(newHi, newLo + 1)]) },
          { animate: false },
        );
        return;
      }
    },
    [viewerRef, cdsToMinimapX, minimapXToCds, clientToFigureX, clamp],
  );

  const onPointerUp = useCallback((e: PointerEvent) => {
    if (dragRef.current?.pointerId === e.pointerId) {
      dragRef.current = null;
    }
  }, []);

  useEffect(() => {
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [onPointerMove, onPointerUp]);

  const beginDrag = useCallback(
    (kind: DragState['kind']) =>
      (e: ReactPointerEvent<SVGRectElement>) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        e.preventDefault();
        e.stopPropagation();
        const svg = e.currentTarget.ownerSVGElement as SVGSVGElement | null;
        dragRef.current = {
          kind,
          pointerId: e.pointerId,
          startClientX: e.clientX,
          startRange: viewport.range,
          svg,
        };
      },
    [viewport],
  );

  const onBackgroundPointerDown = useCallback(
    (e: ReactPointerEvent<SVGRectElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const v = viewerRef.current;
      if (!v) return;
      const svg = (e.currentTarget.ownerSVGElement ?? null) as SVGSVGElement | null;
      const x = clientToFigureX(e.clientX, svg);
      const ruler = minimapXToCds(x);
      const [lo, hi] = viewport.range;
      const len = hi - lo;
      v.fitTo({ kind: 'range', range: clamp([ruler - len / 2, ruler + len / 2]) });
    },
    [viewerRef, viewport, minimapXToCds, clientToFigureX, clamp],
  );

  // Hand renderMinimap consumers a viewport whose `baselineGeometry()`
  // returns the *scaled* (zoom-tracking) geometry, not the fit-gene
  // baseline. exonTrack.renderMinimap reads only `baselineGeometry()`
  // off the viewport; the Proxy delegates everything else to the
  // original mini-viewport. (The scaled geometry's totalWidth is
  // already the minimap's `width`, so width = miniViewport.width.)
  const scaledMinimapViewport = useMemo<Viewport>(() => {
    return new Proxy(miniViewport, {
      get(target, prop, receiver) {
        if (prop === 'baselineGeometry') return () => scaledGeom;
        return Reflect.get(target, prop, receiver);
      },
    });
  }, [miniViewport, scaledGeom]);

  // Lay rows out top-to-bottom inside the overview's vertical band.
  const contentTop = trackTop + verticalPadding;
  const rows = minimapTracks.map((t, i) => {
    const y = contentTop + i * rowHeight;
    // Each row is rendered in the row-local frame [0, width] × [0, rowHeight].
    // The wrapping <g> places it at y inside the overview's band.
    const node = t.renderMinimap?.({
      data: { ready: true } as unknown,
      width,
      height: rowHeight,
      viewport: scaledMinimapViewport,
      mapper,
      painter: minimapPainter,
    });
    return (
      <g
        key={`overview-row-${t.id}`}
        className="vv-overview-row"
        data-vv-row-track-id={t.id}
        transform={`translate(0, ${y})`}
      >
        {node}
      </g>
    );
  });

  const handleLeftX = windowX - handlePx / 2;
  const handleRightX = windowX + windowW - handlePx / 2;
  const bgFill = 'var(--vv-color-overview-bg, transparent)';
  const bgStroke = 'var(--vv-color-overview-border, #e2e8f0)';
  const windowFill = 'var(--vv-color-overview-window-fill, rgba(37, 99, 235, 0.18))';
  const windowStroke = 'var(--vv-color-overview-window-stroke, #2563eb)';
  const handleFill = 'var(--vv-color-overview-handle, #2563eb)';

  return (
    <g
      className="vv-overview-track"
      data-vv-track-id={trackId}
      data-testid="gene-glyph-overview-track"
      style={{ touchAction: 'none' }}
    >
      <rect
        className="vv-overview-bg"
        data-testid="gene-glyph-overview-bg"
        x={0}
        y={trackTop}
        width={width}
        height={trackHeight}
        fill={bgFill}
        stroke={bgStroke}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
        onPointerDown={onBackgroundPointerDown}
      />
      {rows}
      <rect
        className="vv-overview-window"
        data-testid="gene-glyph-overview-window"
        x={windowX}
        y={trackTop}
        width={windowW}
        height={trackHeight}
        fill={windowFill}
        stroke={windowStroke}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
        style={{ cursor: 'grab' }}
        onPointerDown={beginDrag('pan')}
      />
      <rect
        className="vv-overview-handle vv-overview-handle-left"
        data-testid="gene-glyph-overview-handle-left"
        x={handleLeftX}
        y={trackTop}
        width={handlePx}
        height={trackHeight}
        fill={handleFill}
        opacity={0.5}
        style={{ cursor: 'ew-resize' }}
        onPointerDown={beginDrag('resize-left')}
      />
      <rect
        className="vv-overview-handle vv-overview-handle-right"
        data-testid="gene-glyph-overview-handle-right"
        x={handleRightX}
        y={trackTop}
        width={handlePx}
        height={trackHeight}
        fill={handleFill}
        opacity={0.5}
        style={{ cursor: 'ew-resize' }}
        onPointerDown={beginDrag('resize-right')}
      />
    </g>
  );
}
