import { describe, expect, it, vi } from 'vitest';
import { createCachedDataSource } from './data-source.js';

interface Q { window: string }

describe('createCachedDataSource', () => {
  it('shares fetched values across callers with the same cacheKey', async () => {
    const query = vi.fn(async (q: Q) => `value-${q.window}`);
    const source = createCachedDataSource<Q, string>({
      id: 'shared',
      cacheKey: (q) => q.window,
      query,
    });
    const ac = new AbortController();
    const a = await source.query({ window: 'A' }, ac.signal);
    const b = await source.query({ window: 'A' }, ac.signal);
    expect(a).toBe('value-A');
    expect(b).toBe('value-A');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('runs query again for a different cacheKey', async () => {
    const query = vi.fn(async (q: Q) => `value-${q.window}`);
    const source = createCachedDataSource<Q, string>({
      id: 's',
      cacheKey: (q) => q.window,
      query,
    });
    await source.query({ window: 'A' }, new AbortController().signal);
    await source.query({ window: 'B' }, new AbortController().signal);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('does not cache rejections', async () => {
    let attempts = 0;
    const source = createCachedDataSource<Q, string>({
      id: 's',
      cacheKey: (q) => q.window,
      query: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('boom');
        return 'ok';
      },
    });
    await expect(source.query({ window: 'A' }, new AbortController().signal)).rejects.toThrow('boom');
    await expect(source.query({ window: 'A' }, new AbortController().signal)).resolves.toBe('ok');
    expect(attempts).toBe(2);
  });

  it('aborting one caller does not cancel a peer waiter sharing the same key', async () => {
    let resolveInner: ((v: string) => void) | null = null;
    const source = createCachedDataSource<Q, string>({
      id: 's',
      cacheKey: (q) => q.window,
      query: () => new Promise<string>((res) => { resolveInner = res; }),
    });
    const ac1 = new AbortController();
    const ac2 = new AbortController();
    const p1 = source.query({ window: 'A' }, ac1.signal);
    const p2 = source.query({ window: 'A' }, ac2.signal);
    ac1.abort();
    await expect(p1).rejects.toMatchObject({ name: 'AbortError' });
    resolveInner!('done');
    await expect(p2).resolves.toBe('done');
  });

  it('evicts least-recently-used entries past maxEntries', async () => {
    const query = vi.fn(async (q: Q) => `value-${q.window}`);
    const source = createCachedDataSource<Q, string>({
      id: 's',
      cacheKey: (q) => q.window,
      query,
      maxEntries: 2,
    });
    const sig = new AbortController().signal;
    await source.query({ window: 'A' }, sig);
    await source.query({ window: 'B' }, sig);
    await source.query({ window: 'A' }, sig);   // touches A → B is now LRU
    await source.query({ window: 'C' }, sig);   // evicts B
    await source.query({ window: 'B' }, sig);   // re-fetches B
    expect(query).toHaveBeenCalledTimes(4);     // A, B, C, B-again
  });
});
