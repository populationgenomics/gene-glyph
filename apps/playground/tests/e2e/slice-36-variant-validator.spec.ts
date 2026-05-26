import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Slice 36 — VariantValidator integration for HGVS variants.
 *
 * The embed parses canonical genomic forms locally (Slice 34) and
 * routes anything starting with `c.` / `p.` / `g.` / `n.` through
 * VariantValidator. We stub the VV endpoint per-test so the spec
 * doesn't depend on the live service.
 */

const TX_FIXTURE = {
  transcript_id: 'ENST_TEST',
  chrom: '17',
  strand: '+',
  gene_id: 'GENE_TEST',
  gene: { symbol: 'TESTGENE', canonical_transcript_id: 'ENST_TEST' },
  exons: [{ feature_type: 'CDS', start: 7674200, stop: 7674300 }],
  clinvar_variants: [],
};

async function stubBaseNetwork(page: Page) {
  await page.route('https://gnomad.broadinstitute.org/api', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { transcript: TX_FIXTURE } }),
    });
  });
  await page.route(/rest\.ensembl\.org/, async (route: Route) => {
    const url = route.request().url();
    if (url.includes('/sequence/')) {
      return route.fulfill({ status: 200, contentType: 'text/plain', body: 'A'.repeat(101) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

function vvResponse(chr: string, pos: number, ref: string, alt: string) {
  return {
    'NM_TEST:result': {
      primary_assembly_loci: {
        grch38: {
          vcf: { chr, pos: String(pos), ref, alt },
        },
      },
    },
    flag: 'gene_variant',
  };
}

test.describe('Slice 36 — VariantValidator HGVS resolution', () => {
  test('resolves HGVS via VV and renders alongside locally-parsed entries', async ({ page }) => {
    await stubBaseNetwork(page);
    const vvCalls: string[] = [];
    await page.route(/rest\.variantvalidator\.org/, async (route: Route) => {
      const url = route.request().url();
      vvCalls.push(url);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(vvResponse('17', 7674215, 'G', 'A')),
      });
    });
    await page.goto(
      '/embed.html?transcript=ENST_TEST&variants=17:7674210C>T,c.524G%3EA',
    );
    const marks = page.locator('[data-vv-track-id="user-variants"] .vv-clinvar-mark');
    await expect(marks).toHaveCount(2);
    const ids = await marks.evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute('data-vv-feature-id')),
    );
    expect(ids).toEqual(expect.arrayContaining(['17-7674210-C-T', '17-7674215-G-A']));
    // Exactly one VV call for the one HGVS token.
    expect(vvCalls.length).toBe(1);
  });

  test('VV failure falls into the parse-error footer; canonical entries still render', async ({
    page,
  }) => {
    await stubBaseNetwork(page);
    await page.route(/rest\.variantvalidator\.org/, async (route: Route) => {
      await route.fulfill({ status: 500, contentType: 'text/plain', body: 'down' });
    });
    await page.goto(
      '/embed.html?transcript=ENST_TEST&variants=17:7674210C>T,c.524G%3EA',
    );
    // Canonical entry renders.
    await expect(
      page.locator('[data-vv-track-id="user-variants"] .vv-clinvar-mark'),
    ).toHaveCount(1);
    // The HGVS surfaces as an error.
    const footer = page.getByTestId('embed-user-variant-footer');
    await expect(footer).toBeVisible();
    await expect(page.getByTestId('embed-user-variant-error')).toHaveCount(1);
  });

  test('StrictMode double-mount only fires one VV call per HGVS token (in-flight dedup)', async ({
    page,
  }) => {
    await stubBaseNetwork(page);
    let vvHits = 0;
    await page.route(/rest\.variantvalidator\.org/, async (route: Route) => {
      vvHits += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(vvResponse('17', 7674215, 'G', 'A')),
      });
    });
    await page.goto('/embed.html?transcript=ENST_TEST&variants=c.524G%3EA');
    await expect(
      page.locator('[data-vv-track-id="user-variants"] .vv-clinvar-mark'),
    ).toHaveCount(1);
    // React.StrictMode would otherwise double-mount the effect and
    // fire two VV calls; the resolver's in-flight dedup collapses
    // those into one network round-trip.
    expect(vvHits).toBe(1);
  });

  test('mixed-canonical / HGVS URL fires zero VV calls for the canonical entries', async ({
    page,
  }) => {
    await stubBaseNetwork(page);
    const vvUrls: string[] = [];
    await page.route(/rest\.variantvalidator\.org/, async (route: Route) => {
      vvUrls.push(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(vvResponse('17', 7674215, 'G', 'A')),
      });
    });
    await page.goto(
      '/embed.html?transcript=ENST_TEST&variants=17-7674210-C-T,c.524G%3EA',
    );
    await expect(
      page.locator('[data-vv-track-id="user-variants"] .vv-clinvar-mark'),
    ).toHaveCount(2);
    // Only the HGVS goes through VV.
    expect(vvUrls.length).toBe(1);
    expect(vvUrls[0]).toContain(encodeURIComponent('c.524G>A'));
  });
});
