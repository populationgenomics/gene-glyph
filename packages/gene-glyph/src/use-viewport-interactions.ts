import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { InteractionMode, ViewportChangeReason } from './types.js';
import type { ViewportController } from './viewport.js';

/** Scroll-line height assumed when the browser reports `deltaMode === 1`. */
const LINE_HEIGHT_PX = 16;
/** Page height assumed when the browser reports `deltaMode === 2`. */
const PAGE_HEIGHT_PX = 600;
/** Sensitivity for Cmd/Ctrl + wheel zoom. A delta of 100 px (one wheel notch)
 *  yields a zoom factor of `exp(100 / 200) ≈ 1.65` per notch in either
 *  direction; tuned so a single notch feels like a meaningful step without
 *  zooming through the whole gene. */
const WHEEL_ZOOM_DIVISOR = 200;
/** Fraction of the current visible range each arrow-key press pans by. */
const KEYBOARD_PAN_STEP = 0.1;

export interface UseViewportInteractionsArgs {
  viewport: ViewportController;
  /** The figure SVG. The hook attaches native event listeners here so it can
   *  call `preventDefault()` on wheel events (React's synthetic wheel handler
   *  is passive in modern React). */
  svgRef: { current: SVGSVGElement | null };
  /** Container div carrying the `.vv-no-transition` class flag and consuming
   *  keyboard events. */
  containerRef: { current: HTMLElement | null };
  mode: InteractionMode;
  /** Min/max zoom scalars relative to fit-gene. */
  minZoom: number | undefined;
  maxZoom: number;
  /** True when `viewportRange` is supplied by the host. In that case we don't
   *  mutate `viewport` — we only fire `onChange` and let the host re-render
   *  with the new prop. */
  controlled: boolean;
  /** Bumped after every committed range mutation in uncontrolled mode so the
   *  React tree re-runs layout against the new range. */
  bumpTick: () => void;
  /** Called for every committed range mutation. In uncontrolled mode the
   *  viewport has already been updated; in controlled mode the callback is
   *  the only effect of the gesture. */
  onChange: (
    range: readonly [number, number],
    reason: ViewportChangeReason,
  ) => void;
  /** Called when a shift+drag (or right-button drag) brush gesture starts,
   *  updates, or ends. `null` clears the brush (a shift-click with no drag).
   *  Slice 16: viewers wire this onto their brush state (controlled or local)
   *  and pass the result back via `interaction.brushRange`. */
  onBrush: (range: readonly [number, number] | null) => void;
  /** Cancel any in-flight programmatic transition before applying a gesture
   *  update — direct manipulation supersedes a transition immediately. */
  cancelTransition: () => void;
  /** Toggle the `.vv-no-transition` class on the root so per-exon transforms
   *  follow the gesture without CSS easing. */
  setNoTransition: (value: boolean) => void;
}

interface PointerInfo {
  id: number;
  clientX: number;
}

interface DragState {
  pointerId: number;
  lastClientX: number;
}

interface PinchState {
  pointers: Map<number, PointerInfo>;
  startDist: number;
  startMidClientX: number;
  startMidLocalX: number;
  startRange: [number, number];
}

interface BrushState {
  pointerId: number;
  /** Ruler position (CDS bp or aa) at the pointer's down location. */
  anchorRuler: number;
  /** Client-px x at pointer-down; movement is judged against this so the
   *  threshold doesn't change with zoom. */
  startClientX: number;
  /** True once the cursor has moved beyond {@link BRUSH_MIN_PX} client px.
   *  Pointer-up before this clears the brush instead of emitting a zero-width
   *  range. */
  moved: boolean;
}

/** Minimum px movement before a shift-drag becomes a brush (anything less
 *  registers as a click, which clears the brush). */
const BRUSH_MIN_PX = 2;

/**
 * Wires the default interaction bindings — drag/wheel/pinch/keyboard — onto
 * the figure SVG. The hook owns gesture-local refs (no React state during a
 * gesture per design §8) and emits a single `onChange` per event after
 * mutating the viewport.
 */
export function useViewportInteractions(args: UseViewportInteractionsArgs): {
  onPointerDown: (e: React.PointerEvent<SVGSVGElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onContextMenu: (e: React.MouseEvent<SVGSVGElement>) => void;
} {
  const {
    viewport,
    svgRef,
    containerRef,
    mode,
    minZoom,
    maxZoom,
    controlled,
    bumpTick,
    onChange,
    onBrush,
    cancelTransition,
    setNoTransition,
  } = args;

  const dragRef = useRef<DragState | null>(null);
  const pinchRef = useRef<PinchState | null>(null);
  const brushRef = useRef<BrushState | null>(null);

  // Stable clamp helper bound to current opts.
  const clampOpts = useMemo(() => ({ minZoom, maxZoom }), [minZoom, maxZoom]);

  const applyRange = useCallback(
    (next: readonly [number, number], reason: ViewportChangeReason) => {
      const clamped = viewport.clampRange(next, clampOpts);
      cancelTransition();
      if (!controlled) {
        viewport.setRange(clamped);
        bumpTick();
      }
      onChange(clamped, reason);
    },
    [viewport, clampOpts, cancelTransition, controlled, bumpTick, onChange],
  );

  const panByPx = useCallback(
    (deltaViewboxPx: number, reason: ViewportChangeReason) => {
      if (deltaViewboxPx === 0 || !Number.isFinite(deltaViewboxPx)) return;
      const [lo, hi] = viewport.range;
      if (viewport.width <= 0) return;
      // Pan in baseline screen-x space, not CDS-bp space. The baseline
      // mapping is non-uniform: inter-exon gaps occupy ~24 px each (per
      // Slice 10's fixed-gap layout), so a uniform CDS-bp shift would move
      // the visible content faster when an endpoint sits inside a gap than
      // when it sits inside an exon, producing a "sticky" pan feel. Shifting
      // both endpoints by the same baseline-x delta keeps visual motion
      // uniform regardless of where lo / hi land in the gene.
      const sLo = viewport.cdsToBaselineX(lo);
      const sHi = viewport.cdsToBaselineX(hi);
      const newLo = viewport.baselineXToRuler(sLo + deltaViewboxPx);
      const newHi = viewport.baselineXToRuler(sHi + deltaViewboxPx);
      applyRange([newLo, newHi], reason);
    },
    [viewport, applyRange],
  );

  /** Scale a `clientX`-delta in CSS pixels onto viewBox-pixel units. The
   *  viewer's figure SVG is rendered at `width="100%"` so its on-screen size
   *  is decoupled from `viewport.width`; without this conversion drag and
   *  wheel pan move the gene at the wrong speed on non-square viewports. */
  const cssDxToViewbox = useCallback(
    (cssDx: number): number => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0) return cssDx;
      return cssDx * (viewport.width / rect.width);
    },
    [svgRef, viewport],
  );

  /** Convert a client-space clientX to a ruler coordinate (CDS bp or aa,
   *  per current mode). Clamps the input to the figure's visible width so
   *  brush dragging past the figure edge pegs at the edge rather than
   *  returning null. */
  const clientXToRuler = useCallback(
    (clientX: number): number | null => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0) return null;
      const raw = ((clientX - rect.left) / rect.width) * viewport.width;
      const clamped = Math.max(0, Math.min(viewport.width, raw));
      return viewport.rulerAtScreen(clamped);
    },
    [svgRef, viewport],
  );

  const zoomAtX = useCallback(
    (factor: number, cursorX: number, reason: ViewportChangeReason) => {
      if (!Number.isFinite(factor) || factor <= 0) return;
      const [lo, hi] = viewport.range;
      const oldLen = hi - lo;
      if (oldLen <= 0 || viewport.width <= 0) return;
      const anchor = viewport.rulerAtScreen(cursorX);
      const t = Math.max(0, Math.min(1, cursorX / viewport.width));
      const newLen = oldLen / factor;
      let nlo: number;
      let nhi: number;
      if (anchor === null) {
        // Cursor isn't over a visible feature — fall back to centre-anchored.
        const centre = (lo + hi) / 2;
        nlo = centre - newLen / 2;
        nhi = centre + newLen / 2;
      } else {
        nlo = anchor - t * newLen;
        nhi = anchor + (1 - t) * newLen;
      }
      applyRange([nlo, nhi], reason);
    },
    [viewport, applyRange],
  );

  // Native wheel listener: React's synthetic wheel handler is passive in
  // React 18+, so we attach our own non-passive listener to be allowed to
  // preventDefault().
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      const wantsZoom = ev.ctrlKey || ev.metaKey;
      if (wantsZoom) {
        if (mode === 'embed') return; // host page keeps wheel
        ev.preventDefault();
        setNoTransition(true);
        const rect = el.getBoundingClientRect();
        const cursorX =
          rect.width > 0 ? ((ev.clientX - rect.left) / rect.width) * viewport.width : 0;
        const dy = normaliseWheelDelta(ev.deltaY, ev.deltaMode);
        const factor = Math.exp(-dy / WHEEL_ZOOM_DIVISOR);
        zoomAtX(factor, cursorX, 'wheel-zoom');
        return;
      }
      // Plain wheel = pan horizontally. Use whichever axis the trackpad sent.
      const dxCss =
        normaliseWheelDelta(ev.deltaX, ev.deltaMode) ||
        normaliseWheelDelta(ev.deltaY, ev.deltaMode);
      if (dxCss === 0) return;
      // Detect whether we're already at the pan limit. If so, let the page
      // scroll instead of trapping the gesture.
      const [lo, hi] = viewport.range;
      const [pLo, pHi] = viewport.paddedBounds();
      const atLeftLimit = dxCss < 0 && lo <= pLo + 1e-6;
      const atRightLimit = dxCss > 0 && hi >= pHi - 1e-6;
      if (atLeftLimit || atRightLimit) return;
      ev.preventDefault();
      setNoTransition(true);
      panByPx(cssDxToViewbox(dxCss), 'wheel');
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [svgRef, viewport, mode, panByPx, zoomAtX, setNoTransition, cssDxToViewbox]);

  const endDrag = useCallback(() => {
    dragRef.current = null;
    setNoTransition(false);
    const c = containerRef.current;
    if (c) c.classList.remove('vv-dragging');
  }, [containerRef, setNoTransition]);

  const endPinch = useCallback(() => {
    pinchRef.current = null;
    setNoTransition(false);
  }, [setNoTransition]);

  const endBrush = useCallback(() => {
    brushRef.current = null;
    const c = containerRef.current;
    if (c) c.classList.remove('vv-brushing');
  }, [containerRef]);

  // Pointer move / up listeners attach to the window once a pointer is down
  // so the gesture continues even if the cursor leaves the SVG.
  useEffect(() => {
    const onMove = (ev: PointerEvent) => {
      // Brush takes priority over drag/pinch — once a brush gesture is
      // active, single-pointer move updates the brush range.
      const brushSt = brushRef.current;
      if (brushSt && brushSt.pointerId === ev.pointerId) {
        if (!brushSt.moved && Math.abs(ev.clientX - brushSt.startClientX) < BRUSH_MIN_PX) {
          return;
        }
        const r = clientXToRuler(ev.clientX);
        if (r === null) return;
        brushSt.moved = true;
        const lo = Math.min(brushSt.anchorRuler, r);
        const hi = Math.max(brushSt.anchorRuler, r);
        onBrush([lo, hi]);
        bumpTick();
        return;
      }
      // Pinch next — two pointers always overrides drag.
      const pinch = pinchRef.current;
      if (pinch) {
        if (pinch.pointers.has(ev.pointerId)) {
          pinch.pointers.set(ev.pointerId, { id: ev.pointerId, clientX: ev.clientX });
        }
        if (pinch.pointers.size >= 2) {
          updatePinch(pinch, applyRange, svgRef.current, viewport);
        }
        return;
      }
      const drag = dragRef.current;
      if (drag && drag.pointerId === ev.pointerId) {
        const dxCss = ev.clientX - drag.lastClientX;
        drag.lastClientX = ev.clientX;
        // Drag-to-pan moves in the opposite direction of the cursor: as the
        // user pulls right, the gene under their finger should follow, which
        // means the range slides left.
        panByPx(-cssDxToViewbox(dxCss), 'drag');
      }
    };
    const onUp = (ev: PointerEvent) => {
      const brushSt = brushRef.current;
      if (brushSt && brushSt.pointerId === ev.pointerId) {
        // Shift-click with no drag clears the brush; a real drag leaves the
        // last emitted range in place.
        if (!brushSt.moved) onBrush(null);
        endBrush();
        return;
      }
      const pinch = pinchRef.current;
      if (pinch && pinch.pointers.has(ev.pointerId)) {
        pinch.pointers.delete(ev.pointerId);
        if (pinch.pointers.size < 2) {
          endPinch();
          // Remaining pointer (if any) seeds a new single-pointer drag from
          // the current position so the gesture stays continuous.
          const remaining = [...pinch.pointers.values()][0];
          if (remaining) {
            dragRef.current = { pointerId: remaining.id, lastClientX: remaining.clientX };
            setNoTransition(true);
          }
        }
        return;
      }
      const drag = dragRef.current;
      if (drag && drag.pointerId === ev.pointerId) endDrag();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [
    applyRange,
    panByPx,
    cssDxToViewbox,
    clientXToRuler,
    endDrag,
    endPinch,
    endBrush,
    onBrush,
    bumpTick,
    setNoTransition,
    svgRef,
    viewport,
  ]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      // Brush gesture: shift+drag (mouse or pen/touch) or secondary-button
      // drag. Branches above the drag/pinch handling so a shift-down on top
      // of an in-flight drag doesn't promote into a pinch by mistake.
      const isBrushButton = e.button === 2;
      const isBrushModifier = e.shiftKey;
      if (isBrushButton || isBrushModifier) {
        const r = clientXToRuler(e.clientX);
        if (r === null) return;
        // Drop any in-flight drag so we don't pan and brush simultaneously.
        if (dragRef.current) endDrag();
        brushRef.current = {
          pointerId: e.pointerId,
          anchorRuler: r,
          startClientX: e.clientX,
          moved: false,
        };
        const c = containerRef.current;
        if (c) c.classList.add('vv-brushing');
        // Mouse-button-2 needs preventDefault to suppress the context menu;
        // the contextmenu handler on the SVG also suppresses it but stopping
        // here means we don't have to round-trip.
        if (isBrushButton) e.preventDefault();
        return;
      }
      if (e.button !== 0 && e.pointerType === 'mouse') return; // left-click only
      const drag = dragRef.current;
      if (drag) {
        // Promote single-pointer drag into a pinch when a second pointer arrives.
        const startRange = [...viewport.range] as [number, number];
        const rect = svgRef.current?.getBoundingClientRect();
        const a: PointerInfo = { id: drag.pointerId, clientX: drag.lastClientX };
        const b: PointerInfo = { id: e.pointerId, clientX: e.clientX };
        const startDist = Math.abs(b.clientX - a.clientX) || 1;
        const startMidClientX = (a.clientX + b.clientX) / 2;
        const startMidLocalX = rect
          ? ((startMidClientX - rect.left) / Math.max(1, rect.width)) * viewport.width
          : 0;
        pinchRef.current = {
          pointers: new Map([
            [a.id, a],
            [b.id, b],
          ]),
          startDist,
          startMidClientX,
          startMidLocalX,
          startRange,
        };
        dragRef.current = null;
        return;
      }
      dragRef.current = { pointerId: e.pointerId, lastClientX: e.clientX };
      setNoTransition(true);
      const c = containerRef.current;
      if (c) c.classList.add('vv-dragging');
    },
    [viewport, svgRef, containerRef, setNoTransition, clientXToRuler, endDrag],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const key = e.key;
      const [lo, hi] = viewport.range;
      const len = hi - lo;
      // Slice 10: with baseline geometry, exon `<g>` children no longer
      // re-render at new local coords mid-animation — only the wrapping
      // group's translate + scale change. That means keyboard pan / zoom can
      // ride the same CSS transition as `fitTo`, no `vv-no-transition`
      // override needed.
      switch (key) {
        case '+':
        case '=':
          e.preventDefault();
          setNoTransition(false);
          zoomAtX(2, viewport.width / 2, 'keyboard');
          return;
        case '-':
        case '_':
          e.preventDefault();
          setNoTransition(false);
          zoomAtX(0.5, viewport.width / 2, 'keyboard');
          return;
        case 'ArrowLeft':
          e.preventDefault();
          setNoTransition(false);
          applyRange([lo - len * KEYBOARD_PAN_STEP, hi - len * KEYBOARD_PAN_STEP], 'keyboard');
          return;
        case 'ArrowRight':
          e.preventDefault();
          setNoTransition(false);
          applyRange([lo + len * KEYBOARD_PAN_STEP, hi + len * KEYBOARD_PAN_STEP], 'keyboard');
          return;
        case '1':
          e.preventDefault();
          setNoTransition(false);
          applyRange(viewport.naturalRange(), 'keyboard');
          return;
        case 'f':
        case 'F': {
          // `f` fits the feature under the cursor. We don't have a cursor
          // tracker here in Slice 9; fall back to fit-gene rather than crash,
          // and let hosts wire a richer binding via their own keyboard.
          e.preventDefault();
          setNoTransition(false);
          applyRange(viewport.naturalRange(), 'keyboard');
          return;
        }
        default:
          return;
      }
    },
    [viewport, applyRange, zoomAtX, setNoTransition],
  );

  const onContextMenu = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      // Suppress the native context menu so right-button-drag is usable as
      // a brush gesture. Shift+right-click still opens the menu in browsers
      // that bypass contextmenu (rare); shift+drag is the documented binding.
      if (brushRef.current) e.preventDefault();
    },
    [],
  );

  return { onPointerDown, onKeyDown, onContextMenu };
}

function normaliseWheelDelta(delta: number, deltaMode: number): number {
  switch (deltaMode) {
    case 1:
      return delta * LINE_HEIGHT_PX;
    case 2:
      return delta * PAGE_HEIGHT_PX;
    default:
      return delta;
  }
}

function updatePinch(
  pinch: PinchState,
  apply: (range: readonly [number, number], reason: ViewportChangeReason) => void,
  svg: SVGSVGElement | null,
  viewport: ViewportController,
): void {
  const pts = [...pinch.pointers.values()];
  if (pts.length < 2) return;
  const dist = Math.abs(pts[0]!.clientX - pts[1]!.clientX) || 1;
  const midClientX = (pts[0]!.clientX + pts[1]!.clientX) / 2;
  const rect = svg?.getBoundingClientRect();
  if (!rect || rect.width <= 0) return;
  const cssToViewbox = viewport.width / rect.width;
  const scale = dist / pinch.startDist;
  const [lo0, hi0] = pinch.startRange;
  const oldLen = hi0 - lo0;
  const newLen = oldLen / scale;
  const t = pinch.startMidLocalX / Math.max(1, viewport.width);
  const anchor = lo0 + t * oldLen;
  const nlo = anchor - t * newLen;
  const nhi = anchor + (1 - t) * newLen;
  // Compensate for the midpoint translating during the pinch.
  const dxViewbox = (midClientX - pinch.startMidClientX) * cssToViewbox;
  const dxRuler = (dxViewbox / Math.max(1, viewport.width)) * newLen;
  apply([nlo - dxRuler, nhi - dxRuler], 'pinch');
}
