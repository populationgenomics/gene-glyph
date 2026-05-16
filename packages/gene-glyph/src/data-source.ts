import type { DataSource, DataSourceFreshness } from './types.js';

export interface CachedDataSourceOptions<TQuery, TResult> {
  readonly id: string;
  cacheKey(query: TQuery): string;
  query(query: TQuery, signal: AbortSignal): Promise<TResult>;
  freshness?: DataSourceFreshness;
  /** Soft cap on retained cache entries. LRU eviction keeps the in-memory
   *  cache bounded for sources whose queries vary across many windows (e.g.
   *  ClinVar pan/zoom workflows). Default 64; pass `Infinity` to disable. */
  maxEntries?: number;
}

const DEFAULT_MAX_ENTRIES = 64;

/** Wrap a user `query` function with in-memory caching keyed by `cacheKey`.
 *  Two tracks given the same returned `DataSource` instance auto-share fetched
 *  data — the second call resolves from cache without re-running `query`.
 *  The per-call `signal` is honoured for the *caller* (their wait aborts) but
 *  doesn't cancel the underlying fetch, since other waiters may still need
 *  the result. Failures are not cached: a rejected lookup is evicted so a
 *  subsequent caller can retry. Slice 18. */
export function createCachedDataSource<TQuery, TResult>(
  opts: CachedDataSourceOptions<TQuery, TResult>,
): DataSource<TQuery, TResult> {
  const maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const cache = new Map<string, Promise<TResult>>();

  const touch = (key: string, promise: Promise<TResult>) => {
    cache.delete(key);
    cache.set(key, promise);
    while (cache.size > maxEntries) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  };

  return {
    id: opts.id,
    freshness: opts.freshness,
    cacheKey: opts.cacheKey,
    query(query: TQuery, signal: AbortSignal): Promise<TResult> {
      const key = opts.cacheKey(query);
      let shared = cache.get(key);
      if (!shared) {
        shared = opts.query(query, neverAbort).catch((err) => {
          if (cache.get(key) === shared) cache.delete(key);
          throw err;
        });
        touch(key, shared);
      } else {
        touch(key, shared);
      }
      return waitFor(shared, signal);
    },
  };
}

const neverAbort = new AbortController().signal;

function waitFor<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort);
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        if (!signal.aborted) resolve(value);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        if (!signal.aborted) reject(err);
      },
    );
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
