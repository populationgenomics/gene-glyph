import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Slice 35 — variant selection draws a full-figure drop-line range
 * overlay; `?selected=<hash>` round-trips with FNV-1a backward compat.
 *
 * The embed view talks to gnomAD/Ensembl; we stub both with a small
 * fixture so the render path doesn't depend on the live network.
 */

const TX_FIXTURE = {
  transcript_id: 'ENST_TEST',
  chrom: '17',
  strand: '+',
  gene_id: 'GENE_TEST',
  gene: {
    symbol: 'TESTGENE',
    canonical_transcript_id: 'ENST_TEST',
  },
  exons: [
    { feature_type: 'CDS', start: 7674200, stop: 7674300 },
  ],
  clinvar_variants: [],
};

async function stubEmbedNetwork(page: Page) {
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

// FNV-1a 32-bit — mirrors the library helper so the spec can assert
// exact URL hashes without an import dance through the package
// boundary.
function fnv1a32Hex(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

test.describe('Slice 35 — variant selection + drop-line range overlay', () => {
  test('clicking a user-variants mark draws the SNV drop-line; clicking again dismisses', async ({ page }) => {
    await stubEmbedNetwork(page);
    await page.goto('/embed.html?transcript=ENST_TEST&variants=17:7674210C>T');
    const mark = page.locator('[data-vv-track-id="user-variants"] .vv-clinvar-mark').first();
    await expect(mark).toBeVisible();
    await mark.click();
    const overlay = page.getByTestId('gene-glyph-selection-range');
    await expect(overlay).toBeAttached();
    await expect(overlay.locator('.vv-selection-range-line')).toHaveCount(1);
    // Detail card appears for user variants.
    await expect(page.getByTestId('embed-selected-user-variant')).toBeVisible();
    // Click the same mark again — toggles the selection off.
    await mark.click();
    await expect(page.getByTestId('gene-glyph-selection-range')).toHaveCount(0);
  });

  test('multi-bp variant selection renders a translucent rect, not a line', async ({ page }) => {
    await stubEmbedNetwork(page);
    await page.goto('/embed.html?transcript=ENST_TEST&variants=17-7674210-ACGT-A');
    const mark = page.locator('[data-vv-track-id="user-variants"] .vv-clinvar-mark').first();
    await mark.click();
    const overlay = page.getByTestId('gene-glyph-selection-range');
    await expect(overlay.locator('.vv-selection-range')).toHaveCount(1);
    await expect(overlay.locator('.vv-selection-range-line')).toHaveCount(0);
  });

  test('`?selected=<hash>` survives reload', async ({ page }) => {
    await stubEmbedNetwork(page);
    const variant = '17-7674210-C-T';
    const hash = fnv1a32Hex(variant);
    await page.goto(`/embed.html?transcript=ENST_TEST&variants=17:7674210C>T&selected=${hash}`);
    await expect(page.getByTestId('embed-selected-user-variant')).toBeVisible();
    await expect(page.getByTestId('gene-glyph-selection-range')).toBeAttached();
  });

  test('pre-hash `?selected=<canonical>` still resolves (backward compat)', async ({ page }) => {
    await stubEmbedNetwork(page);
    const variant = '17-7674210-C-T';
    await page.goto(
      `/embed.html?transcript=ENST_TEST&variants=17:7674210C>T&selected=${variant}`,
    );
    await expect(page.getByTestId('embed-selected-user-variant')).toBeVisible();
    // After load the URL should be rewritten to the hash form.
    await page.waitForTimeout(150);
    const url = page.url();
    const hash = fnv1a32Hex(variant);
    expect(url).toContain(`selected=${hash}`);
  });
});
