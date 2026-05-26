import { describe, expect, it } from 'vitest';
import { parseUserVariant, parseUserVariants } from './parse-user-variants.js';

describe('parseUserVariant — accepted forms', () => {
  it('parses gnomAD canonical `chr-pos-REF-ALT` unchanged', () => {
    const r = parseUserVariant('17-7674212-C-A');
    expect(r).toMatchObject({
      id: '17-7674212-C-A',
      chr: 'chr17',
      pos: 7674212,
      ref: 'C',
      alt: 'A',
    });
  });

  it('parses `chr:posREF>ALT` and normalises to canonical', () => {
    expect(parseUserVariant('17:7674212C>T')?.id).toBe('17-7674212-C-T');
  });

  it('parses `chr:pos-REF-ALT`', () => {
    expect(parseUserVariant('17:7674212-C-T')?.id).toBe('17-7674212-C-T');
  });

  it('accepts the optional `chr` prefix', () => {
    expect(parseUserVariant('chr1-12345-C-T')?.chr).toBe('chr1');
    expect(parseUserVariant('chr1:12345C>T')?.chr).toBe('chr1');
  });

  it('strips the `chr` prefix from the canonical id', () => {
    expect(parseUserVariant('chr1-12345-C-T')?.id).toBe('1-12345-C-T');
  });

  it('uppercases REF / ALT', () => {
    const r = parseUserVariant('1-12345-c-t');
    expect(r?.ref).toBe('C');
    expect(r?.alt).toBe('T');
    expect(r?.id).toBe('1-12345-C-T');
  });

  it('tolerates leading / trailing whitespace', () => {
    expect(parseUserVariant('   17-7674212-C-A   ')?.id).toBe('17-7674212-C-A');
  });

  it('tolerates internal whitespace (stray paste spaces)', () => {
    expect(parseUserVariant('chr1:12345C >T')?.id).toBe('1-12345-C-T');
    expect(parseUserVariant('chr1 : 12345 - C - T')?.id).toBe('1-12345-C-T');
  });

  it('keeps multi-bp REF / ALT (deletions, insertions, MNVs)', () => {
    const del = parseUserVariant('17-7675236-ACTG-A');
    expect(del?.ref).toBe('ACTG');
    expect(del?.alt).toBe('A');
    const ins = parseUserVariant('17:7675236A>ACTG');
    expect(ins?.ref).toBe('A');
    expect(ins?.alt).toBe('ACTG');
  });

  it('accepts X / Y / MT chromosomes', () => {
    expect(parseUserVariant('X-12345-C-T')?.chr).toBe('chrX');
    expect(parseUserVariant('chrY:12345C>T')?.chr).toBe('chrY');
    expect(parseUserVariant('MT-100-A-G')?.chr).toBe('chrMT');
  });

  it('preserves the raw input string', () => {
    const raw = '  chr1:12345 C>T  ';
    expect(parseUserVariant(raw)?.raw).toBe(raw);
  });
});

describe('parseUserVariant — rejected forms', () => {
  it('parseUserVariant returns null for HGVS forms (parseUserVariants routes them to hgvsTokens instead)', () => {
    expect(parseUserVariant('c.93G>A')).toBeNull();
    expect(parseUserVariant('p.Val123Met')).toBeNull();
    expect(parseUserVariant('g.74642513C>G')).toBeNull();
    expect(parseUserVariant('n.42A>G')).toBeNull();
  });

  it('rejects partial / malformed pastes', () => {
    expect(parseUserVariant('9:abc')).toBeNull();
    expect(parseUserVariant('1:12345')).toBeNull();
    expect(parseUserVariant('1-12345-C')).toBeNull();
    expect(parseUserVariant('-12345-C-T')).toBeNull();
    expect(parseUserVariant('1:0C>T')).toBeNull();
  });

  it('rejects empty / whitespace-only input', () => {
    expect(parseUserVariant('')).toBeNull();
    expect(parseUserVariant('   ')).toBeNull();
  });
});

describe('parseUserVariants — list input', () => {
  it('parses a comma-separated list', () => {
    const r = parseUserVariants('17-7674212-C-A,17:7674220C>T');
    expect(r.parsed.map((p) => p.id)).toEqual([
      '17-7674212-C-A',
      '17-7674220-C-T',
    ]);
    expect(r.errors).toEqual([]);
  });

  it('parses a newline-separated list', () => {
    const r = parseUserVariants('17-7674212-C-A\n17-7674220-C-T');
    expect(r.parsed).toHaveLength(2);
  });

  it('collects unparseable entries into errors', () => {
    const r = parseUserVariants('17-7674212-C-A,9:abc,1:12345X');
    expect(r.parsed.map((p) => p.id)).toEqual(['17-7674212-C-A']);
    expect(r.errors).toEqual(['9:abc', '1:12345X']);
  });

  it('deduplicates by canonical id', () => {
    const r = parseUserVariants('17-7674212-C-A,chr17-7674212-C-A,17:7674212C>A');
    expect(r.parsed).toHaveLength(1);
    expect(r.parsed[0]!.id).toBe('17-7674212-C-A');
  });

  it('ignores empty tokens', () => {
    const r = parseUserVariants(',,17-7674212-C-A,,\n,');
    expect(r.parsed).toHaveLength(1);
    expect(r.errors).toEqual([]);
  });

  it('routes HGVS-shaped tokens into hgvsTokens, not errors (Slice 36)', () => {
    const r = parseUserVariants('17-7674212-C-A,c.524G>A,p.Arg175His,g.7674212C>T');
    expect(r.parsed.map((p) => p.id)).toEqual(['17-7674212-C-A']);
    expect(r.hgvsTokens.sort()).toEqual(['c.524G>A', 'g.7674212C>T', 'p.Arg175His']);
    expect(r.errors).toEqual([]);
  });

  it('deduplicates HGVS tokens case-insensitively', () => {
    const r = parseUserVariants('c.524G>A,C.524G>A,c.524g>a');
    expect(r.hgvsTokens).toEqual(['c.524G>A']);
  });
});
