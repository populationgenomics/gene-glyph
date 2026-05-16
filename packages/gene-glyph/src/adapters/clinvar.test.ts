import { describe, expect, it, vi } from 'vitest';
import { createClinVarDataSource } from './clinvar.js';
import type { Transcript } from '../types.js';

const transcript: Transcript = {
  geneSymbol: 'TP53',
  transcriptId: 'NM_000546.6',
  cdsLength: 1182,
  strand: '-',
  exons: [
    { number: 2, cdsStart: 1, cdsEnd: 140, genomicStart: 7676521, genomicEnd: 7676660, chr: 'chr17' },
  ],
};

interface FakeFetchOptions {
  pages: Array<{ ids: string[]; total: number }>;
  summaries: Record<string, unknown>;
}

function makeFakeFetch(opts: FakeFetchOptions): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  let esearchCall = 0;
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('esearch.fcgi')) {
      const page = opts.pages[esearchCall] ?? { ids: [], total: 0 };
      esearchCall += 1;
      return new Response(
        JSON.stringify({
          esearchresult: { count: String(page.total), idlist: page.ids },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (url.includes('esummary.fcgi')) {
      const idMatch = url.match(/id=([^&]+)/);
      const ids = idMatch ? idMatch[1]!.split(',') : [];
      const result: Record<string, unknown> = { uids: ids };
      for (const id of ids) {
        result[id] = opts.summaries[id] ?? null;
      }
      return new Response(JSON.stringify({ result }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, calls };
}

describe('createClinVarDataSource', () => {
  it('pages through esearch results and parses esummary into ClinVarRecord[]', async () => {
    const summaries = {
      '111': {
        accession: 'VCV000111',
        title: 'NM_000546.6(TP53):c.524G>A',
        germline_classification: { description: 'Pathogenic' },
        trait_set: [{ trait_name: 'Li-Fraumeni syndrome' }],
        variation_set: [
          {
            cdna_change: 'c.524G>A',
            variation_loc: [
              { assembly_name: 'GRCh38', chr: '17', start: '7674220', stop: '7674220' },
            ],
          },
        ],
      },
      '222': {
        accession: 'VCV000222',
        title: 'NM_000546.6(TP53):c.747G>T',
        germline_classification: { description: 'Conflicting interpretations of pathogenicity' },
        variation_set: [
          {
            cdna_change: 'c.747G>T',
            variation_loc: [
              { assembly_name: 'GRCh38', chr: 'chr17', start: '7673803', stop: '7673803' },
            ],
          },
        ],
      },
    };
    const { fetch, calls } = makeFakeFetch({
      pages: [
        { ids: ['111'], total: 2 },
        { ids: ['222'], total: 2 },
        { ids: [], total: 2 },
      ],
      summaries,
    });
    const ds = createClinVarDataSource({
      transcript,
      fetchImpl: fetch,
      pageSize: 1,
    });
    const records = await ds.query(
      { mode: 'cds-with-introns', range: [1, transcript.cdsLength] },
      new AbortController().signal,
    );
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      id: 'VCV000111',
      chr: 'chr17',
      pos: 7674220,
      significance: 'pathogenic',
      condition: 'Li-Fraumeni syndrome',
    });
    expect(records[1]).toMatchObject({
      id: 'VCV000222',
      chr: 'chr17',
      pos: 7673803,
      significance: 'conflicting',
    });
    // Two esearch pages exhaust the result set; we expect either 2 or 3
    // esearch calls (the implementation may stop on an empty page either way).
    const esearchCalls = calls.filter((u) => u.includes('esearch.fcgi'));
    expect(esearchCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('reuses the cached result on a second query', async () => {
    const summaries = {
      '111': {
        accession: 'VCV000111',
        title: 'c.524G>A',
        germline_classification: { description: 'Pathogenic' },
        variation_set: [
          {
            cdna_change: 'c.524G>A',
            variation_loc: [
              { assembly_name: 'GRCh38', chr: '17', start: '7674220', stop: '7674220' },
            ],
          },
        ],
      },
    };
    const { fetch } = makeFakeFetch({
      pages: [{ ids: ['111'], total: 1 }, { ids: [], total: 1 }],
      summaries,
    });
    const spy = vi.fn(fetch);
    const ds = createClinVarDataSource({
      transcript,
      fetchImpl: spy as unknown as typeof globalThis.fetch,
      pageSize: 200,
    });
    await ds.query(
      { mode: 'cds-with-introns', range: [1, transcript.cdsLength] },
      new AbortController().signal,
    );
    const callCount = spy.mock.calls.length;
    await ds.query(
      { mode: 'cds-with-introns', range: [1, transcript.cdsLength] },
      new AbortController().signal,
    );
    // Range / mode change shouldn't refetch because cacheKey is the
    // transcript id — ClinVar data is gene-scoped, not viewport-scoped.
    expect(spy.mock.calls.length).toBe(callCount);
  });

  it('drops records whose chromosome doesnt match the transcript', async () => {
    const summaries = {
      '111': {
        accession: 'VCV000111',
        title: 'wrong contig',
        germline_classification: { description: 'Pathogenic' },
        variation_set: [
          {
            cdna_change: 'c.1G>A',
            variation_loc: [{ assembly_name: 'GRCh38', chr: '5', start: '1', stop: '1' }],
          },
        ],
      },
    };
    const { fetch } = makeFakeFetch({
      pages: [{ ids: ['111'], total: 1 }, { ids: [], total: 1 }],
      summaries,
    });
    const ds = createClinVarDataSource({
      transcript,
      fetchImpl: fetch,
      pageSize: 200,
    });
    const records = await ds.query(
      { mode: 'cds-with-introns', range: [1, 100] },
      new AbortController().signal,
    );
    expect(records).toHaveLength(0);
  });
});
