import { expect, test, type Route } from '@playwright/test';

/**
 * Slice 34 — `?variants=` URL parameter renders user-supplied variants
 * as purple crosses alongside the curated ClinVar calls.
 *
 * The embed view talks to three external services (gnomAD GraphQL,
 * Ensembl REST for sequence + protein); the tests below stub them with
 * a small minus-strand fixture so the render path doesn't depend on
 * the live network. The fixture exposes one short CDS exon over
 * `chr17:7674200-7674250` so any `?variants=17:7674210C>T`-shaped URL
 * lands inside the figure.
 */

const TX_FIXTURE = {
  transcript_id: 'ENST_TEST',
  chrom: '17',
  strand: '-',
  gene_id: 'GENE_TEST',
  gene: {
    symbol: 'TESTGENE',
    canonical_transcript_id: 'ENST_TEST',
  },
  exons: [
    { feature_type: 'CDS', start: 7674200, stop: 7674300 },
  ],
  clinvar_variants: [],
} as const;

async function stubEmbedNetwork(page: import('@playwright/test').Page) {
  // gnomAD GraphQL — one POST per transcript fetch.
  await page.route('https://gnomad.broadinstitute.org/api', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { transcript: TX_FIXTURE } }),
    });
  });
  // Ensembl REST — sequence + protein endpoints. Return empty payloads
  // so the embed renders without the nucleotide / aa / interpro tracks
  // doing real work. The fixture's exon is short enough that the
  // figure still has somewhere to project user variants.
  await page.route(/rest\.ensembl\.org/, async (route: Route) => {
    const url = route.request().url();
    if (url.includes('/sequence/')) {
      return route.fulfill({
        status: 200,
        contentType: 'text/plain',
        body: 'A'.repeat(101),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{}',
    });
  });
}

test.describe('Slice 34 — user-supplied variants from `?variants=`', () => {
  test('renders the user-variant track when the URL carries valid variants', async ({ page }) => {
    await stubEmbedNetwork(page);
    await page.goto(
      '/embed.html?transcript=ENST_TEST&variants=17:7674210C>T,17-7674220-G-A',
    );
    const figure = page.locator('svg.vv-figure');
    await expect(figure).toBeVisible();
    // The user-variant track sits in its own track row, with marks
    // carrying the canonical id (chr stripped from the prefix).
    const marks = page.locator('[data-vv-track-id="user-variants"] .vv-clinvar-mark');
    await expect(marks).toHaveCount(2);
    const ids = await marks.evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute('data-vv-feature-id')),
    );
    expect(ids).toEqual(expect.arrayContaining(['17-7674210-C-T', '17-7674220-G-A']));
  });

  test('keeps the track visible across view-mode switches', async ({ page }) => {
    await stubEmbedNetwork(page);
    await page.goto('/embed.html?transcript=ENST_TEST&variants=17:7674210C>T');
    const marks = page.locator('[data-vv-track-id="user-variants"] .vv-clinvar-mark');
    await expect(marks).toHaveCount(1);
    // Genome / transcript / protein round-trip — the track must
    // survive every mode change.
    for (const mode of ['genome', 'protein', 'transcript'] as const) {
      await page.getByTestId(`embed-mode-${mode}`).click();
      await expect(marks).toHaveCount(1);
    }
  });

  test('surfaces parse errors in the footer; valid variants still render', async ({ page }) => {
    await stubEmbedNetwork(page);
    await page.goto(
      '/embed.html?transcript=ENST_TEST&variants=17:7674210C>T,9:abc,1:12345X',
    );
    const footer = page.getByTestId('embed-user-variant-footer');
    await expect(footer).toBeVisible();
    const errors = page.getByTestId('embed-user-variant-error');
    await expect(errors).toHaveCount(2);
    const errorTexts = await errors.allTextContents();
    expect(errorTexts.sort()).toEqual(['1:12345X', '9:abc']);
    // Valid variant still renders.
    const marks = page.locator('[data-vv-track-id="user-variants"] .vv-clinvar-mark');
    await expect(marks).toHaveCount(1);
  });

  test('omits the track row entirely when `?variants=` is empty', async ({ page }) => {
    await stubEmbedNetwork(page);
    await page.goto('/embed.html?transcript=ENST_TEST');
    await expect(page.locator('svg.vv-figure')).toBeVisible();
    await expect(page.locator('[data-vv-track-id="user-variants"]')).toHaveCount(0);
    await expect(page.getByTestId('embed-user-variant-footer')).toHaveCount(0);
  });
});
