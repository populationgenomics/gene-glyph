/**
 * Dev-only "loop leash" + structured logs for the rAF pollers and any other
 * tight-loop call sites. The pollers (overview-track, default-minimap, viewer
 * tooltip-anchor, playground scenarios) drive ~60 fps work to keep auxiliary
 * widgets in sync with the figure's animated viewport — but if their work
 * itself trips a re-render of the polling component (state-in-effect, dep
 * churn, etc.), the poll can pile work onto an already-overloaded event loop
 * and tank the page. The leash watches each loop for:
 *
 *   1. Total frame count crossing a hard cap (default 600 000 ticks ≈ 167
 *      minutes at 60 fps). Past that we cancel the loop and console.error
 *      so the page recovers instead of dragging on indefinitely.
 *   2. Frame-time runaway — a single tick taking longer than the runaway
 *      budget (default 250 ms) means the work itself, not the loop, is
 *      pathological; emit a warning and a stack hint.
 *   3. Periodic heartbeat (default every 600 ticks) so a developer watching
 *      DevTools can see whether a poller is still alive without staring at
 *      the profiler.
 *
 * Disabled by default in production builds (`import.meta.env.PROD`); enabled
 * automatically in dev. Hosts can override at runtime via
 * `window.__GENE_GLYPH_DEBUG_LEASH__`.
 */

declare global {
  interface Window {
    __GENE_GLYPH_DEBUG_LEASH__?: boolean | Partial<LeashedRafOptions>;
  }
}

export interface LeashedRafOptions {
  /** Cancel + error after this many total ticks. */
  maxTicks: number;
  /** Per-tick work exceeding this (ms) emits a warning. */
  runawayMs: number;
  /** Heartbeat every N ticks (0 = never). */
  heartbeatEvery: number;
}

const DEFAULT_OPTS: LeashedRafOptions = {
  maxTicks: 600_000,
  runawayMs: 250,
  heartbeatEvery: 600,
};

function debugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  const override = window.__GENE_GLYPH_DEBUG_LEASH__;
  if (typeof override === 'boolean') return override;
  if (typeof override === 'object' && override !== null) return true;
  // Default: disabled. The leash is opt-in — quiet for normal use, flip on
  // by setting `window.__GENE_GLYPH_DEBUG_LEASH__ = true` (or a partial
  // options object like `{ heartbeatEvery: 60 }`) before the viewer
  // mounts, then reload the page.
  return false;
}

function resolveOpts(): LeashedRafOptions {
  if (typeof window !== 'undefined') {
    const o = window.__GENE_GLYPH_DEBUG_LEASH__;
    if (typeof o === 'object' && o !== null) {
      return { ...DEFAULT_OPTS, ...o };
    }
  }
  return DEFAULT_OPTS;
}

/**
 * Drop-in replacement for the typical rAF-loop pattern:
 *
 *     let raf = 0;
 *     const tick = () => {
 *       // …work…
 *       raf = requestAnimationFrame(tick);
 *     };
 *     raf = requestAnimationFrame(tick);
 *     return () => cancelAnimationFrame(raf);
 *
 * becomes
 *
 *     const leash = leashedRaf('overview-poll', () => { …work… });
 *     return () => leash.cancel();
 *
 * The leash logs ticks, work duration, and runaway / max-tick events with
 * a stable label so multiple pollers stay distinguishable in the console.
 */
export function leashedRaf(label: string, work: () => void): { cancel: () => void } {
  let rafId = 0;
  let ticks = 0;
  let cancelled = false;
  const enabled = debugEnabled();
  const opts = resolveOpts();
  const startedAt = performance.now();

  if (enabled) {
    // eslint-disable-next-line no-console
    console.log(
      `[gene-glyph leash] '${label}' started ` +
        `(maxTicks=${opts.maxTicks}, runawayMs=${opts.runawayMs}, ` +
        `heartbeatEvery=${opts.heartbeatEvery}).`,
    );
  }

  const tick = () => {
    if (cancelled) return;
    ticks += 1;
    if (enabled && ticks > opts.maxTicks) {
      // eslint-disable-next-line no-console
      console.error(
        `[gene-glyph leash] '${label}' exceeded ${opts.maxTicks} ticks ` +
          `(${(performance.now() - startedAt).toFixed(0)} ms elapsed) — cancelling. ` +
          `If this isn't intended, file a bug.`,
      );
      cancelled = true;
      return;
    }
    const t0 = enabled ? performance.now() : 0;
    try {
      work();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[gene-glyph leash] '${label}' threw on tick #${ticks}:`, err);
      // Re-arm so a one-off exception doesn't kill the whole poller, but
      // emit so the developer sees it.
    }
    if (enabled) {
      const dt = performance.now() - t0;
      if (dt > opts.runawayMs) {
        // eslint-disable-next-line no-console
        console.warn(
          `[gene-glyph leash] '${label}' tick #${ticks} took ${dt.toFixed(1)} ms ` +
            `(threshold ${opts.runawayMs} ms). Likely a runaway re-render — ` +
            `check whether the polled state is changing on every frame.`,
        );
      }
      if (opts.heartbeatEvery > 0 && ticks % opts.heartbeatEvery === 0) {
        // `console.log` (not `console.debug`) so the heartbeat shows in the
        // default DevTools log filter; debug-level lines are hidden unless
        // the user explicitly enables "Verbose".
        // eslint-disable-next-line no-console
        console.log(
          `[gene-glyph leash] '${label}' alive at tick #${ticks} ` +
            `(${(performance.now() - startedAt).toFixed(0)} ms elapsed).`,
        );
      }
    }
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);

  return {
    cancel(): void {
      cancelled = true;
      if (rafId !== 0) cancelAnimationFrame(rafId);
    },
  };
}

/**
 * Guarded counter for any non-rAF tight loop that could spin (CSS-variable
 * publish reentries, layout recomputes triggered from render, etc.). Wrap a
 * function with a recursion budget; each entry decrements the budget, and
 * exceeding it logs + throws so the developer sees the call stack instead
 * of the page hanging.
 */
export function leashedRecursion<TArgs extends readonly unknown[], TRet>(
  label: string,
  fn: (...args: TArgs) => TRet,
  maxDepth = 64,
): (...args: TArgs) => TRet {
  let depth = 0;
  return (...args: TArgs): TRet => {
    if (depth > maxDepth) {
      const err = new Error(
        `[gene-glyph leash] '${label}' exceeded recursion depth ${maxDepth}. ` +
          `Likely an effect or callback is calling itself transitively.`,
      );
      // eslint-disable-next-line no-console
      console.error(err);
      throw err;
    }
    depth += 1;
    try {
      return fn(...args);
    } finally {
      depth -= 1;
    }
  };
}

/**
 * Detects setState storms: if the same callsite calls `notify` more than
 * `maxPerWindow` times within `windowMs`, emit one warning per window so
 * the developer notices without flooding the console.
 */
export function createStormDetector(
  label: string,
  maxPerWindow = 120,
  windowMs = 1_000,
): () => void {
  let windowStart = 0;
  let count = 0;
  let warned = false;
  return () => {
    if (!debugEnabled()) return;
    const now = performance.now();
    if (now - windowStart > windowMs) {
      windowStart = now;
      count = 0;
      warned = false;
    }
    count += 1;
    if (count > maxPerWindow && !warned) {
      // eslint-disable-next-line no-console
      console.warn(
        `[gene-glyph leash] '${label}' fired ${count} times in ${windowMs} ms — ` +
          `looks like a re-render storm. Check the callsite's deps.`,
      );
      warned = true;
    }
  };
}
