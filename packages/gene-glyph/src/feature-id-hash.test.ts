import { describe, expect, it } from 'vitest';
import {
  buildFeatureIdHashMap,
  fnv1a32Hex,
  resolveSelectedId,
} from './feature-id-hash.js';

describe('fnv1a32Hex', () => {
  it('is deterministic — same input maps to same 8-hex digest', () => {
    expect(fnv1a32Hex('17-7674212-C-T')).toBe(fnv1a32Hex('17-7674212-C-T'));
    expect(fnv1a32Hex('17-7674212-C-T')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('differentiates distinct ids', () => {
    expect(fnv1a32Hex('17-7674212-C-T')).not.toBe(fnv1a32Hex('17-7674212-C-A'));
    expect(fnv1a32Hex('17-7674212-C-T')).not.toBe(fnv1a32Hex('17-7674213-C-T'));
  });

  it('handles long ids without overflow (large indel)', () => {
    const longRef = 'A'.repeat(500);
    const id = `11-5226947-${longRef}-A`;
    expect(fnv1a32Hex(id)).toMatch(/^[0-9a-f]{8}$/);
  });

  it('handles the empty string', () => {
    expect(fnv1a32Hex('')).toBe('811c9dc5');
  });
});

describe('buildFeatureIdHashMap', () => {
  it('keys by hash, values are the canonical ids', () => {
    const ids = ['17-7674212-C-T', '17-7674212-C-A'];
    const map = buildFeatureIdHashMap(ids);
    expect(map.get(fnv1a32Hex('17-7674212-C-T'))).toBe('17-7674212-C-T');
    expect(map.get(fnv1a32Hex('17-7674212-C-A'))).toBe('17-7674212-C-A');
  });
});

describe('resolveSelectedId', () => {
  const ids = ['17-7674212-C-T', '17-7674220-G-A'];

  it('returns the raw id when it matches a known feature (backward compat)', () => {
    expect(resolveSelectedId('17-7674212-C-T', ids)).toBe('17-7674212-C-T');
  });

  it('returns the canonical id when the URL value is its hash', () => {
    const hash = fnv1a32Hex('17-7674212-C-T');
    expect(resolveSelectedId(hash, ids)).toBe('17-7674212-C-T');
  });

  it('returns null when neither raw nor hash matches', () => {
    expect(resolveSelectedId('deadbeef', ids)).toBeNull();
    expect(resolveSelectedId('17-9999-C-T', ids)).toBeNull();
  });

  it('tolerates leading / trailing whitespace', () => {
    expect(resolveSelectedId('  17-7674212-C-T  ', ids)).toBe('17-7674212-C-T');
  });

  it('returns null for empty / whitespace input', () => {
    expect(resolveSelectedId('', ids)).toBeNull();
    expect(resolveSelectedId('   ', ids)).toBeNull();
  });
});
