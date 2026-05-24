import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import type { GeneGlyphRef, ViewportInfo } from '../viewer.js';

/** Smallest visible-window span permitted by handle drag, as a fraction
 *  of the natural baseline width. Caps "max zoom in" via minimap to
 *  something readable (currently 1% of the gene). */
const MIN_VISIBLE_FRACTION = 0.01;

/** Clamp a requested displayOffset so the brush rectangle stays flush
 *  inside the minimap. The minimap renders the laid-out figure `[0,
 *  totalDisplayWidth]`, so we keep the viewport slice `[offset, offset
 *  + W]` within that. This is tighter than the figure's own pan clamp
 *  (which allows ~5% padding overshoot); panning further past the gene
 *  ends needs the main-figure drag, not the minimap. */
function clampDisplayOffsetForPan(
  info: ViewportInfo,
  requested: number,
): number {
  const minOffset = 0;
  const maxOffset = info.totalDisplayWidth - info.viewportWidth;
  if (maxOffset <= minOffset) {
    // Whole gene fits inside the viewport — centre.
    return (info.totalDisplayWidth - info.viewportWidth) / 2;
  }
  if (requested < minOffset) return minOffset;
  if (requested > maxOffset) return maxOffset;
  return requested;
}

/** Clamp the new baseline window from a handle-resize gesture. Holds
 *  the anchored side fixed (the non-dragged endpoint) and clamps the
 *  dragged side to the gene's baseline bounds and the min-span cap.
 *  `which` names the side being dragged. */
function clampResizeWindow(
  info: ViewportInfo,
  window: readonly [number, number],
  minSpan: number,
  which: 'left' | 'right',
): [number, number] {
  const total = info.baselineGeometry.totalWidth;
  let [lo, hi] = window;
  if (which === 'left') {
    // The RIGHT edge is anchored; clamp LEFT.
    const minLo = 0;
    const maxLo = hi - minSpan;
    if (lo < minLo) lo = minLo;
    if (lo > maxLo) lo = maxLo;
  } else {
    // The LEFT edge is anchored; clamp RIGHT.
    const minHi = lo + minSpan;
    const maxHi = total;
    if (hi < minHi) hi = minHi;
    if (hi > maxHi) hi = maxHi;
  }
  return [lo, hi];
}

export interface DefaultMinimapProps {
  /** Ref handed to `<GeneGlyph>`. The minimap subscribes to viewer changes
   *  and writes pan / zoom back via `panByDisplayPx` and `fitTo`. */
  viewerRef: RefObject<GeneGlyphRef | null>;
  /** Pixel width of the thumbnail SVG. Default 480. */
  width?: number;
  /** Pixel height of the thumbnail SVG. Default 28. */
  height?: number;
  /** Optional className appended to the root container. */
  className?: string;
}

interface DragState {
  kind: 'pan' | 'resize-left' | 'resize-right';
  pointerId: number;
  startClientX: number;
  /** Display offset of the viewport at the start of the drag (used by
   *  pan to compute the delta to apply via `panByDisplayPx`). */
  startDisplayOffset: number;
  /** Layout total display width at drag start. The mini-x → layout-x
   *  ratio is anchored to the drag's starting layout so the brush /
   *  handle tracks the cursor 1:1 even though zoom may change mid-drag. */
  startTotalDisplay: number;
  /** Zoom scale at drag start. Resize uses this to convert layout-px
   *  deltas to baseline-px deltas (flex regions: dBase = dLayout /
   *  zoom). Constant across the drag; not re-read from the live state. */
  startZoomScale: number;
  /** Baseline window at drag start. Resize keeps one endpoint fixed and
   *  moves the other. */
  startBaselineWindow: readonly [number, number];
}

const HANDLE_PX = 6;

/**
 * Display-space minimap. Renders the figure in the **current** static
 * layout (scaled to the minimap's width), so the brush rectangle
 * represents exactly what the viewport sees in display pixels. Under
 * pure pan the brush slides uniformly with no scale change in either
 * view; under handle drag the zoom changes smoothly.
 *
 * Built on the viewer's public API: `subscribe()` for state changes,
 * `panByDisplayPx()` for the pan gesture, and `fitTo({range})` for
 * resize-induced zoom.
 */
export function DefaultMinimap({
  viewerRef,
  width = 480,
  height = 28,
  className,
}: DefaultMinimapProps) {
  const dragRef = useRef<DragState | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Mirror the viewer's current state. Re-fires on every committed
  // mutation — pan, zoom, mode, width changes.
  const [info, setInfo] = useState<ViewportInfo | null>(null);
  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    setInfo(v.getViewportInfo());
    return v.subscribe(() => {
      const live = viewerRef.current;
      if (live) setInfo(live.getViewportInfo());
    });
  }, [viewerRef]);

  /** Mini-x → layout display-x. */
  const miniToLayout = useCallback(
    (miniX: number, totalDisplay: number): number => {
      return (miniX / Math.max(1, width)) * Math.max(1, totalDisplay);
    },
    [width],
  );

  /** Client-x → mini-x. */
  const clientToMiniX = useCallback(
    (clientX: number): number => {
      const svg = svgRef.current;
      if (!svg) return 0;
      const rect = svg.getBoundingClientRect();
      const css = clientX - rect.left;
      const ratio = rect.width > 0 ? css / rect.width : 0;
      return ratio * width;
    },
    [width],
  );

  const onPointerDown = useCallback(
    (kind: DragState['kind']) =>
      (e: ReactPointerEvent<SVGRectElement>) => {
        if (!info) return;
        e.preventDefault();
        const svg = svgRef.current;
        svg?.setPointerCapture(e.pointerId);
        dragRef.current = {
          kind,
          pointerId: e.pointerId,
          startClientX: e.clientX,
          startDisplayOffset: info.displayOffset,
          startTotalDisplay: info.totalDisplayWidth,
          startZoomScale: info.zoomScale,
          startBaselineWindow: [info.baselineWindow[0], info.baselineWindow[1]],
        };
      },
    [info],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      const v = viewerRef.current;
      if (!v || !info) return;

      const dxClient = e.clientX - drag.startClientX;
      // CSS-pixel → mini-pixel conversion (the SVG may be rendered at a
      // different size than its viewBox).
      const svgRect = svgRef.current?.getBoundingClientRect();
      const cssToMini = svgRect && svgRect.width > 0 ? width / svgRect.width : 1;
      const dxMini = dxClient * cssToMini;

      // The mini renders the figure's STATIC layout scaled to the
      // minimap width. mini-x → layout-x is `miniX × (totalDisplay /
      // miniWidth)`. We anchor against the START layout (frozen at drag
      // start) so the handle / brush tracks the cursor 1:1 even though
      // zoom may change mid-drag during resize.
      const dxLayout = miniToLayout(dxMini, drag.startTotalDisplay);
      const startOffset = drag.startDisplayOffset;

      if (drag.kind === 'pan') {
        // Pure display-pan: shift offset by the cursor-equivalent layout
        // delta. Recompute the absolute target each tick from drag-start +
        // cumulative dxMini so missed pointer events don't drift. Clamp
        // to padded gene bounds so the brush bites at the minimap edges.
        const targetOffsetRaw = startOffset + dxLayout;
        const targetOffset = clampDisplayOffsetForPan(info, targetOffsetRaw);
        const currentOffset = v.getViewportInfo().displayOffset;
        const applied = targetOffset - currentOffset;
        if (applied !== 0) v.panByDisplayPx(applied);
        return;
      }

      // Resize: translate the dragged handle's layout-px delta into a
      // baseline-px delta using the START zoom, then commit a new
      // baseline window through setBaselineWindow. Anchoring on
      // startZoom (not the live layout) keeps the math stable across
      // the zoom changes the gesture causes — one cursor pixel always
      // maps to the same baseline-px shift for the dragged endpoint.
      const dxBase = drag.startZoomScale > 0 ? dxLayout / drag.startZoomScale : 0;
      const minBaselineSpan = Math.max(
        1,
        info.baselineGeometry.totalWidth * MIN_VISIBLE_FRACTION,
      );
      if (drag.kind === 'resize-left') {
        const rightBase = drag.startBaselineWindow[1];
        const newLeftBase = drag.startBaselineWindow[0] + dxBase;
        const next = clampResizeWindow(info, [newLeftBase, rightBase], minBaselineSpan, 'left');
        v.setBaselineWindow(next);
        return;
      }
      if (drag.kind === 'resize-right') {
        const leftBase = drag.startBaselineWindow[0];
        const newRightBase = drag.startBaselineWindow[1] + dxBase;
        const next = clampResizeWindow(info, [leftBase, newRightBase], minBaselineSpan, 'right');
        v.setBaselineWindow(next);
        return;
      }
    },
    [viewerRef, info, miniToLayout],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<SVGSVGElement>) => {
    if (dragRef.current?.pointerId === e.pointerId) {
      dragRef.current = null;
    }
  }, []);

  // Background click: jump to that location, keeping zoom unchanged.
  const onBackgroundPointerDown = useCallback(
    (e: ReactPointerEvent<SVGRectElement>) => {
      if (!info) return;
      if (e.button !== 0) return;
      e.preventDefault();
      const v = viewerRef.current;
      if (!v) return;
      const miniX = clientToMiniX(e.clientX);
      const targetLayoutX = miniToLayout(miniX, info.totalDisplayWidth);
      const targetOffset = targetLayoutX - info.viewportWidth / 2;
      const dx = targetOffset - info.displayOffset;
      if (dx !== 0) v.panByDisplayPx(dx);
    },
    [info, viewerRef, clientToMiniX, miniToLayout],
  );

  if (!info) {
    return (
      <div
        className={['vv-default-minimap', className].filter(Boolean).join(' ')}
        data-testid="gene-glyph-minimap"
        style={{ width, height }}
      />
    );
  }

  // Rendering: scale the figure's CURRENT layout to fit minimap width.
  const total = Math.max(1, info.totalDisplayWidth);
  const scale = width / total;
  const exonH = Math.max(4, height - 8);
  const exonY = (height - exonH) / 2;

  // Brush rect = viewport's slice of the layout, scaled to minimap-x.
  const brushX = info.displayOffset * scale;
  const brushW = Math.max(2, info.viewportWidth * scale);
  const handleLeft = { x: brushX - HANDLE_PX / 2, w: HANDLE_PX };
  const handleRight = { x: brushX + brushW - HANDLE_PX / 2, w: HANDLE_PX };

  return (
    <div
      className={['vv-default-minimap', className].filter(Boolean).join(' ')}
      data-testid="gene-glyph-minimap"
      style={{ width, height }}
    >
      <svg
        ref={svgRef}
        className="vv-default-minimap-svg"
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role="img"
        aria-label={`Minimap for ${info.transcript.geneSymbol}`}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <rect
          className="vv-default-minimap-bg"
          data-testid="gene-glyph-minimap-bg"
          x={0}
          y={0}
          width={width}
          height={height}
          onPointerDown={onBackgroundPointerDown}
        />
        {info.currentGaps.map((g) =>
          g.xEnd > g.xStart ? (
            <line
              key={`gap-${g.exonIdxA}-${g.exonIdxB}`}
              className="vv-default-minimap-intron"
              x1={g.xStart * scale}
              x2={g.xEnd * scale}
              y1={height / 2}
              y2={height / 2}
            />
          ) : null,
        )}
        {info.currentExons.map((e) => (
          <rect
            key={`exon-${e.exonIdx}`}
            className="vv-default-minimap-exon"
            x={e.xStart * scale}
            y={exonY}
            width={Math.max(1, (e.xEnd - e.xStart) * scale)}
            height={exonH}
          />
        ))}
        <rect
          className="vv-default-minimap-window"
          data-testid="gene-glyph-minimap-window"
          x={brushX}
          y={0}
          width={brushW}
          height={height}
          onPointerDown={onPointerDown('pan')}
        />
        <rect
          className="vv-default-minimap-handle vv-default-minimap-handle-left"
          data-testid="gene-glyph-minimap-handle-left"
          x={handleLeft.x}
          y={0}
          width={handleLeft.w}
          height={height}
          onPointerDown={onPointerDown('resize-left')}
        />
        <rect
          className="vv-default-minimap-handle vv-default-minimap-handle-right"
          data-testid="gene-glyph-minimap-handle-right"
          x={handleRight.x}
          y={0}
          width={handleRight.w}
          height={height}
          onPointerDown={onPointerDown('resize-right')}
        />
      </svg>
    </div>
  );
}

