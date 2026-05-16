import { useEffect, useMemo, useRef, useState } from 'react';
import {
  GeneGlyph,
  createCachedDataSource,
  exonTrack,
  variantTrack,
} from '@populationgenomics/gene-glyph';
import type {
  DataSource,
  TrackLoadState,
  ViewerVariant,
  ViewportQuery,
} from '@populationgenomics/gene-glyph';
import { TP53_TRANSCRIPT, TP53_VARIANTS } from '../fixtures/tp53.js';

/**
 * Slice 18 — async data sources with debounced re-loads, per-track loading
 * affordance, stale desaturation, and shared-source caching.
 *
 * The mock adapter returns the bundled TP53 variant fixture but waits a
 * configurable delay first, simulating a real upstream (gnomAD/ClinVar). Two
 * variant tracks share the same source instance so the second track's load
 * resolves from cache without re-running `query`. A query counter on the
 * scenario surface makes the cache hit visible at a glance.
 */
export function AsyncDataSourceScenario() {
  const [delayMs, setDelayMs] = useState(800);
  const [queryCount, setQueryCount] = useState(0);
  const [states, setStates] = useState<Record<string, TrackLoadState>>({});
  const queryCountRef = useRef(0);
  const delayRef = useRef(delayMs);
  useEffect(() => {
    delayRef.current = delayMs;
  }, [delayMs]);

  // Build the cached source once. The closure reads `delayRef` so the
  // playground slider takes effect on the *next* query without throwing away
  // the existing cache. The cacheKey factors mode + range so a true viewport
  // change refetches but mode-only swaps within the same range reuse data.
  const source = useMemo<DataSource<ViewportQuery, ViewerVariant[]>>(
    () =>
      // The closure body reads `queryCountRef.current` / `delayRef.current`
      // when the query fires (not during render), so the react-hooks/refs
      // ban on render-time ref access is a false positive here.
      // eslint-disable-next-line react-hooks/refs
      createCachedDataSource<ViewportQuery, ViewerVariant[]>({
        id: 'mock-variant-source',
        cacheKey: (q) => `${q.mode}|${q.range[0]}|${q.range[1]}`,
        query: async (_q, signal) => {
          queryCountRef.current += 1;
          setQueryCount(queryCountRef.current);
          await sleep(delayRef.current, signal);
          return TP53_VARIANTS.slice();
        },
      }),
    [],
  );

  const handleTrackState = (id: string, state: TrackLoadState) => {
    setStates((prev) => ({ ...prev, [id]: state }));
  };

  // Stable track list — re-creating it on every render would re-fire the
  // viewer's load effect and abort the in-flight async query mid-flight,
  // which is exactly the wedge Slice 18 is meant to handle. Memoising once
  // is the canonical host pattern documented for async-data hosts.
  const tracks = useMemo(
    () => [
      exonTrack({}),
      variantTrack({ id: 'variants-a', source }),
      variantTrack({ id: 'variants-b', source }),
    ],
    [source],
  );

  return (
    <section className="scenario" aria-labelledby="scenario-async">
      <h2 id="scenario-async">Async data source — shared cache</h2>
      <p className="scenario-blurb">
        Two variant tracks share one <code>DataSource</code> instance with a
        simulated network delay. Pan or zoom the figure to trigger a
        debounced re-fetch — the shimmer marks loading tracks, existing
        features desaturate during the debounce, and only one query fires
        per unique viewport window thanks to <code>createCachedDataSource</code>.
      </p>
      <div
        style={{
          display: 'flex',
          gap: 16,
          flexWrap: 'wrap',
          alignItems: 'center',
          marginBottom: 8,
          fontSize: '0.85rem',
          color: '#475569',
        }}
      >
        <label>
          Network delay{' '}
          <input
            data-testid="async-delay-input"
            type="number"
            min={0}
            step={100}
            value={delayMs}
            onChange={(e) => setDelayMs(Math.max(0, Number(e.target.value) || 0))}
            style={{ width: 80 }}
          />{' '}
          ms
        </label>
        <span data-testid="async-query-count" style={{ fontVariantNumeric: 'tabular-nums' }}>
          queries fired: <strong>{queryCount}</strong>
        </span>
        <span data-testid="async-state-primary" style={{ fontVariantNumeric: 'tabular-nums' }}>
          variants-a: <strong>{states['variants-a'] ?? 'idle'}</strong>
        </span>
        <span data-testid="async-state-secondary" style={{ fontVariantNumeric: 'tabular-nums' }}>
          variants-b: <strong>{states['variants-b'] ?? 'idle'}</strong>
        </span>
      </div>
      <GeneGlyph
        transcript={TP53_TRANSCRIPT}
        tracks={tracks}
        trackHeightBudget={220}
        onTrackStateChange={handleTrackState}
      />
    </section>
  );
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      signal.removeEventListener('abort', onAbort);
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort);
  });
}

function abortError(): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('Aborted', 'AbortError');
  }
  const err = new Error('Aborted');
  err.name = 'AbortError';
  return err;
}
