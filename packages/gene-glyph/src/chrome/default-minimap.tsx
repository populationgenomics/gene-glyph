import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { createCoordinateMapper } from '../coordinate-mapper.js';
import { ViewportController } from '../viewport.js';
import type { GeneGlyphRef, ViewportInfo } from '../viewer.js';

export interface DefaultMinimapProps {
  /** Ref handed to `<GeneGlyph>`. The minimap subscribes to viewer changes
   *  and writes pan / zoom back via `fitTo`. */
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
  startRange: readonly [number, number];
  natural: readonly [number, number];
}

const HANDLE_PX = 6;

/**
 * Slice 20 — chrome convenience component for the Footer slot. Renders a
 * full-gene thumbnail (exons drawn at the active mode's baseline) with a
 * draggable window rectangle. Dragging the window pans the viewer; the
 * two edge handles resize the window, which zooms. Clicking outside the
 * window jumps the viewer to that point.
 *
 * Subscribes to the viewer's committed range / mode changes via
 * `viewerRef.current.subscribe()` (Slice 33 retired the rAF poll).
 *
 * Built using only the public API.
 */
export function DefaultMinimap({
  viewerRef,
  width = 480,
  height = 28,
  className,
}: DefaultMinimapProps) {
  const dragRef = useRef<DragState | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Mirror the viewer's committed range / mode into local state via the
  // imperative subscribe() hook. Re-fires on every committed mutation so the
  // window rectangle stays locked to whatever the figure is showing without
  // polling.
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

  // Mini viewport for coordinate mapping. Re-created when the transcript or
  // mode changes; widths are minimap-local so baseline-x lands in
  // `[0, width]`. The mapper memoises baseline geometry internally so this
  // is cheap to keep around.
  const mini = useMemo(() => {
    if (!info) return null;
    const mapper = createCoordinateMapper(info.transcript);
    return new ViewportController({ mapper, width, mode: info.mode });
  }, [info?.transcript, info?.mode, width]); // eslint-disable-line react-hooks/exhaustive-deps

  const baseline = useMemo(() => (mini ? mini.baselineGeometry() : null), [mini]);

  const rulerToX = useCallback(
    (ruler: number): number => {
      if (!mini) return 0;
      return mini.cdsToBaselineX(ruler);
    },
    [mini],
  );

  const xToRuler = useCallback(
    (x: number): number => {
      if (!mini) return 0;
      return mini.baselineXToRuler(x);
    },
    [mini],
  );

  const windowRect = useMemo(() => {
    if (!info || !mini) return null;
    const xa = rulerToX(info.range[0]);
    const xb = rulerToX(info.range[1]);
    const x = Math.min(xa, xb);
    const w = Math.max(2, Math.abs(xb - xa));
    return { x, w };
  }, [info, mini, rulerToX]);

  const clamp = useCallback(
    (range: readonly [number, number]): [number, number] => {
      if (!info) return [range[0], range[1]];
      const [nLo, nHi] = info.naturalRange;
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
    [info],
  );

  const onPointerDown = useCallback(
    (kind: DragState['kind']) =>
      (e: ReactPointerEvent<SVGRectElement>) => {
        if (!info || !mini) return;
        e.preventDefault();
        // Capture on the SVG root rather than the handle/window rect: the
        // SVG carries the pointermove/up handlers, and capturing on a child
        // would redirect pointer events to that child (which has none),
        // freezing the drag the moment the cursor left the child's box.
        const svg = svgRef.current;
        svg?.setPointerCapture(e.pointerId);
        dragRef.current = {
          kind,
          pointerId: e.pointerId,
          startClientX: e.clientX,
          startRange: [info.range[0], info.range[1]],
          natural: [info.naturalRange[0], info.naturalRange[1]],
        };
      },
    [info, mini],
  );

  const clientToBaselineX = useCallback(
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

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      const v = viewerRef.current;
      if (!v || !mini) return;
      // Convert both the original drag-anchor and the current cursor into
      // baseline-x, then convert the resulting baseline-x deltas back through
      // the mini-viewport so the figure tracks the cursor across non-linear
      // gap regions (genome) consistently.
      const baselineStart = clientToBaselineX(drag.startClientX);
      const baselineNow = clientToBaselineX(e.clientX);
      if (drag.kind === 'pan') {
        const xLo = rulerToX(drag.startRange[0]);
        const xHi = rulerToX(drag.startRange[1]);
        const dx = baselineNow - baselineStart;
        const newLo = xToRuler(xLo + dx);
        const newHi = xToRuler(xHi + dx);
        const next = clamp([newLo, newHi]);
        v.fitTo({ kind: 'range', range: next });
        return;
      }
      if (drag.kind === 'resize-left') {
        const xHi = rulerToX(drag.startRange[1]);
        const xLoStart = rulerToX(drag.startRange[0]);
        const dx = baselineNow - baselineStart;
        const xLoNew = Math.min(xHi - 4, xLoStart + dx);
        const newLo = xToRuler(xLoNew);
        const newHi = drag.startRange[1];
        const next = clamp([Math.min(newLo, newHi - 1), newHi]);
        v.fitTo({ kind: 'range', range: next });
        return;
      }
      if (drag.kind === 'resize-right') {
        const xLo = rulerToX(drag.startRange[0]);
        const xHiStart = rulerToX(drag.startRange[1]);
        const dx = baselineNow - baselineStart;
        const xHiNew = Math.max(xLo + 4, xHiStart + dx);
        const newHi = xToRuler(xHiNew);
        const newLo = drag.startRange[0];
        const next = clamp([newLo, Math.max(newHi, newLo + 1)]);
        v.fitTo({ kind: 'range', range: next });
        return;
      }
    },
    [viewerRef, mini, clientToBaselineX, rulerToX, xToRuler, clamp],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<SVGSVGElement>) => {
    if (dragRef.current?.pointerId === e.pointerId) {
      dragRef.current = null;
    }
  }, []);

  // Background click: jump to that location, centred on the click.
  const onBackgroundPointerDown = useCallback(
    (e: ReactPointerEvent<SVGRectElement>) => {
      if (!info || !mini) return;
      // Ignore non-primary buttons — keeps right-click free for any host
      // context menu the minimap might be embedded under.
      if (e.button !== 0) return;
      e.preventDefault();
      const x = clientToBaselineX(e.clientX);
      const ruler = xToRuler(x);
      const [lo, hi] = info.range;
      const len = hi - lo;
      const next = clamp([ruler - len / 2, ruler + len / 2]);
      viewerRef.current?.fitTo({ kind: 'range', range: next });
    },
    [info, mini, clientToBaselineX, xToRuler, clamp, viewerRef],
  );

  if (!info || !baseline || !windowRect) {
    return (
      <div
        className={['vv-default-minimap', className].filter(Boolean).join(' ')}
        data-testid="gene-glyph-minimap"
        style={{ width, height }}
      />
    );
  }

  const exonH = Math.max(4, height - 8);
  const exonY = (height - exonH) / 2;
  const handleLeft = { x: windowRect.x - HANDLE_PX / 2, w: HANDLE_PX };
  const handleRight = { x: windowRect.x + windowRect.w - HANDLE_PX / 2, w: HANDLE_PX };

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
        {baseline.gaps.map((g) =>
          g.width > 0 ? (
            <line
              key={`gap-${g.exonIdxA}-${g.exonIdxB}`}
              className="vv-default-minimap-intron"
              x1={g.xStart}
              x2={g.xEnd}
              y1={height / 2}
              y2={height / 2}
            />
          ) : null,
        )}
        {baseline.exons.map((e) => (
          <rect
            key={`exon-${e.exonIdx}`}
            className="vv-default-minimap-exon"
            x={e.xStart}
            y={exonY}
            width={Math.max(1, e.width)}
            height={exonH}
          />
        ))}
        <rect
          className="vv-default-minimap-window"
          data-testid="gene-glyph-minimap-window"
          x={windowRect.x}
          y={0}
          width={windowRect.w}
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
