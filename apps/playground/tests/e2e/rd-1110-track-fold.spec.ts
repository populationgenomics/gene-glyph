import { test, expect, type Locator, type Page } from '@playwright/test';

async function liveDataScenario(page: Page): Promise<Locator> {
  await page.goto('/');
  const s = page.locator('section[aria-labelledby="scenario-live-data"]');
  await s.scrollIntoViewIfNeeded();
  return s;
}

async function waitForReady(s: Locator, gene: string): Promise<void> {
  // The live-data scenario fetches gnomAD and reports the ClinVar variant
  // count once the transcript + records arrive.
  await s.locator('[data-testid="live-data-gene-picker"]').selectOption(gene);
  await expect(s.locator('[data-testid="live-data-status"]')).toContainText(
    /ClinVar variants/,
    { timeout: 20_000 },
  );
}

test.describe('RD-1110 — fold/unfold contract on the live-data ClinVar group', () => {
  test('fold renders the summary track, unfold restores the stacked detail track', async ({ page }) => {
    const s = await liveDataScenario(page);
    await waitForReady(s, 'BRCA1');

    // The live-data scenario starts with the ClinVar group folded so dense
    // genes (~12k records for BRCA1) land at one row by default.
    const chevron = s.locator('[data-testid="gene-glyph-chevron-clinvar-group"]');
    await expect(chevron).toBeVisible();
    await expect(chevron).toHaveAttribute('aria-expanded', 'false');

    // Folded state: the summary heat-strip is in the figure; the stacked
    // detail track is not.
    const summary = s.locator('[data-testid="gene-glyph-track-clinvar-summary"]');
    const stacked = s.locator('[data-vv-track-id="clinvar"].vv-clinvar-track-stacked');
    await expect(summary).toBeAttached();
    await expect(stacked).toHaveCount(0);

    // Summary is a thin one-row strip; the stacked detail of BRCA1
    // packs hundreds of rows. Compare figure heights bracketed around
    // the chevron toggle to pin "summary's height replaces the detail's
    // height in the budget".
    const figure = s.locator('svg.vv-figure');
    const collapsedHeight = await figure.evaluate(
      (el) => (el as SVGSVGElement).getBoundingClientRect().height,
    );

    // Unfold — the stacked track mounts and the figure grows.
    await chevron.click();
    await expect(chevron).toHaveAttribute('aria-expanded', 'true');
    await expect(stacked).toBeAttached();
    await expect(summary).toHaveCount(0);
    const expandedHeight = await figure.evaluate(
      (el) => (el as SVGSVGElement).getBoundingClientRect().height,
    );
    expect(expandedHeight).toBeGreaterThan(collapsedHeight);

    // Re-fold — back to the summary row, figure shrinks again.
    await chevron.click();
    await expect(chevron).toHaveAttribute('aria-expanded', 'false');
    await expect(summary).toBeAttached();
    await expect(stacked).toHaveCount(0);
    const refoldedHeight = await figure.evaluate(
      (el) => (el as SVGSVGElement).getBoundingClientRect().height,
    );
    expect(refoldedHeight).toBeLessThan(expandedHeight);
  });

  test('summary track shows density-coloured cells while folded', async ({ page }) => {
    const s = await liveDataScenario(page);
    await waitForReady(s, 'BRCA1');
    const cells = s.locator('.vv-clinvar-summary-cell');
    // BRCA1 has dense pathogenic + VUS clusters; the summary should
    // populate at least a handful of bins.
    expect(await cells.count()).toBeGreaterThan(4);
    const significances = new Set(
      await cells.evaluateAll((els) =>
        els.map((e) => e.getAttribute('data-vv-significance')),
      ),
    );
    expect(significances.size).toBeGreaterThan(1);
  });
});
