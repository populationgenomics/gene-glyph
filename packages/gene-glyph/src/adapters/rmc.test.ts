import { describe, expect, it } from 'vitest';
import { parseAaStart, rmcCategoryFor, type RmcCategory } from './rmc.js';

describe('parseAaStart', () => {
  it('parses every canonical three-letter amino-acid code', () => {
    const codes = [
      'Ala', 'Arg', 'Asn', 'Asp', 'Cys',
      'Glu', 'Gln', 'Gly', 'His', 'Ile',
      'Leu', 'Lys', 'Met', 'Phe', 'Pro',
      'Ser', 'Thr', 'Trp', 'Tyr', 'Val',
    ];
    for (const c of codes) {
      expect(parseAaStart(`${c}42`)).toBe(42);
    }
  });

  it('parses Ter / Sec / Pyl special codes', () => {
    expect(parseAaStart('Ter393')).toBe(393);
    expect(parseAaStart('Sec196')).toBe(196);
    expect(parseAaStart('Pyl12')).toBe(12);
  });

  it('is case-tolerant on the prefix', () => {
    expect(parseAaStart('lys2009')).toBe(2009);
    expect(parseAaStart('LYS2009')).toBe(2009);
    expect(parseAaStart('lYs2009')).toBe(2009);
  });

  it('returns null for malformed input', () => {
    expect(parseAaStart('')).toBeNull();
    expect(parseAaStart('Lys')).toBeNull();
    expect(parseAaStart('2009')).toBeNull();
    expect(parseAaStart('Xyz123')).toBeNull(); // unknown code
    expect(parseAaStart('Lysine2009')).toBeNull(); // wrong code length
    expect(parseAaStart('Lys 2009')).toBeNull();
  });
});

describe('rmcCategoryFor', () => {
  it('bins obs/exp into the five intolerance tiers when p_value ≤ 0.001', () => {
    const cases: Array<[number, RmcCategory]> = [
      [0.0, 'intol-1'],
      [0.1, 'intol-1'],
      [0.2, 'intol-1'],
      [0.2001, 'intol-2'],
      [0.3, 'intol-2'],
      [0.4, 'intol-2'],
      [0.41, 'intol-3'],
      [0.6, 'intol-3'],
      [0.7, 'intol-4'],
      [0.8, 'intol-4'],
      [0.9, 'intol-5'],
      [1.5, 'intol-5'],
    ];
    for (const [obsExp, expected] of cases) {
      expect(rmcCategoryFor(obsExp, 0.0001)).toBe(expected);
    }
  });

  it('returns "not-significant" when p_value > 0.001 regardless of obs/exp', () => {
    expect(rmcCategoryFor(0.0, 0.01)).toBe('not-significant');
    expect(rmcCategoryFor(0.5, 0.05)).toBe('not-significant');
    expect(rmcCategoryFor(1.0, 0.5)).toBe('not-significant');
    // boundary: just over 0.001 → not significant
    expect(rmcCategoryFor(0.5, 0.0011)).toBe('not-significant');
  });

  it('p_value = 0.001 is significant (≤ boundary)', () => {
    expect(rmcCategoryFor(0.5, 0.001)).toBe('intol-3');
  });

  it('treats non-finite inputs as not-significant', () => {
    expect(rmcCategoryFor(0.5, Number.NaN)).toBe('not-significant');
    expect(rmcCategoryFor(Number.NaN, 0.0001)).toBe('not-significant');
    expect(rmcCategoryFor(0.5, Number.POSITIVE_INFINITY)).toBe('not-significant');
  });
});
