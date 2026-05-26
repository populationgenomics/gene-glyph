import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Slice 37 — variant-entry modal driven by the V hotkey + toolbar `+`
 * button. Submit rewrites the `?variants=` URL and the figure picks
 * up the change via the existing URL→state pipeline.
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

test.describe('Slice 37 — variant-entry modal', () => {
  test('pressing V opens the modal pre-populated with the current variants; Escape closes', async ({
    page,
  }) => {
    await stubEmbedNetwork(page);
    await page.goto('/embed.html?transcript=ENST_TEST&variants=17:7674210C>T');
    await expect(page.locator('svg.vv-figure')).toBeVisible();
    // Make sure focus is on the document body, not a chip / input.
    await page.locator('svg.vv-figure').click({ position: { x: 1, y: 1 } });
    await page.keyboard.press('v');
    const textarea = page.getByTestId('embed-variants-modal-textarea');
    await expect(textarea).toBeVisible();
    // Pre-populated with the URL contents, newline-separated.
    await expect(textarea).toHaveValue('17:7674210C>T');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('embed-variants-modal')).toHaveCount(0);
  });

  test('Cmd-Enter submits; URL + figure update', async ({ page }) => {
    await stubEmbedNetwork(page);
    await page.goto('/embed.html?transcript=ENST_TEST');
    await page.locator('svg.vv-figure').click({ position: { x: 1, y: 1 } });
    await page.keyboard.press('v');
    const textarea = page.getByTestId('embed-variants-modal-textarea');
    await textarea.fill('17:7674215C>T\n17-7674225-G-A');
    await page.keyboard.press('Meta+Enter');
    await expect(page.getByTestId('embed-variants-modal')).toHaveCount(0);
    const marks = page.locator('[data-vv-track-id="user-variants"] .vv-clinvar-mark');
    await expect(marks).toHaveCount(2);
    const url = page.url();
    expect(url).toContain('variants=');
    expect(decodeURIComponent(url)).toContain('17:7674215C>T');
  });

  test('clicking the backdrop closes without applying', async ({ page }) => {
    await stubEmbedNetwork(page);
    await page.goto('/embed.html?transcript=ENST_TEST&variants=17:7674210C>T');
    await page.locator('svg.vv-figure').click({ position: { x: 1, y: 1 } });
    await page.keyboard.press('v');
    const textarea = page.getByTestId('embed-variants-modal-textarea');
    await textarea.fill('17:7674299C>T');
    // Click the backdrop (outside the modal card).
    await page.getByTestId('embed-variants-modal-backdrop').click({ position: { x: 10, y: 10 } });
    await expect(page.getByTestId('embed-variants-modal')).toHaveCount(0);
    // Figure still shows the original variant.
    const marks = page.locator('[data-vv-track-id="user-variants"] .vv-clinvar-mark');
    await expect(marks).toHaveCount(1);
    const url = page.url();
    expect(decodeURIComponent(url)).toContain('17:7674210C>T');
  });

  test('inline modal-footer errors show unparseable entries; user can fix without retyping', async ({
    page,
  }) => {
    await stubEmbedNetwork(page);
    await page.goto('/embed.html?transcript=ENST_TEST');
    await page.locator('svg.vv-figure').click({ position: { x: 1, y: 1 } });
    await page.keyboard.press('v');
    const textarea = page.getByTestId('embed-variants-modal-textarea');
    await textarea.fill('17:7674215C>T\n9:abc');
    const errs = page.getByTestId('embed-variants-modal-errors');
    await expect(errs).toBeVisible();
    await expect(errs).toContainText('9:abc');
    // Fix the typo and submit.
    await textarea.fill('17:7674215C>T\n17:7674225G>A');
    await expect(errs).toHaveCount(0);
    await page.getByTestId('embed-variants-modal-submit').click();
    await expect(
      page.locator('[data-vv-track-id="user-variants"] .vv-clinvar-mark'),
    ).toHaveCount(2);
  });

  test('Clear button empties the textarea but figure / URL stay intact until submit', async ({
    page,
  }) => {
    await stubEmbedNetwork(page);
    await page.goto('/embed.html?transcript=ENST_TEST&variants=17:7674210C>T');
    await page.locator('svg.vv-figure').click({ position: { x: 1, y: 1 } });
    await page.keyboard.press('v');
    await page.getByTestId('embed-variants-modal-clear').click();
    await expect(page.getByTestId('embed-variants-modal-textarea')).toHaveValue('');
    // Figure is untouched while the modal is open.
    await expect(
      page.locator('[data-vv-track-id="user-variants"] .vv-clinvar-mark'),
    ).toHaveCount(1);
    // Submitting the empty value drops the variants track entirely.
    await page.getByTestId('embed-variants-modal-submit').click();
    await expect(
      page.locator('[data-vv-track-id="user-variants"] .vv-clinvar-mark'),
    ).toHaveCount(0);
    await expect(page.url()).not.toContain('variants=');
  });

  test('toolbar `+` button opens the same modal', async ({ page }) => {
    await stubEmbedNetwork(page);
    await page.goto('/embed.html?transcript=ENST_TEST');
    await page.getByTestId('embed-open-variants').click();
    await expect(page.getByTestId('embed-variants-modal')).toBeVisible();
  });

  test('V hotkey is suppressed when an input is focused', async ({ page }) => {
    await stubEmbedNetwork(page);
    await page.goto('/embed.html?transcript=ENST_TEST&variants=17:7674210C>T');
    await page.getByTestId('embed-open-variants').click();
    const textarea = page.getByTestId('embed-variants-modal-textarea');
    await textarea.focus();
    // Typing "v" into the textarea must NOT close the modal — the
    // hotkey listener should bail on editable elements.
    await page.keyboard.type('v');
    await expect(page.getByTestId('embed-variants-modal')).toBeVisible();
    // The "v" character should appear in the textarea (literal text
    // insertion), confirming the global hotkey didn't intercept it.
    await expect(textarea).toHaveValue(/v.*17:7674210C>T|17:7674210C>T.*v/);
  });
});
