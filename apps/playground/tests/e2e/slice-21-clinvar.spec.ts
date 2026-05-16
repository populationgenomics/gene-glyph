import { test, expect, type Locator, type Page } from '@playwright/test';

async function scenario(page: Page): Promise<Locator> {
  await page.goto('/');
  const s = page.locator('section[aria-labelledby="scenario-clinvar"]');
  await s.scrollIntoViewIfNeeded();
  return s;
}

test.describe('Slice 21 — ClinVar density-clustered track', () => {
  test('clusters render at fit-gene zoom with significance-coloured marks', async ({ page }) => {
    const s = await scenario(page);
    const marks = s.locator('.vv-clinvar-mark');
    await expect(marks.first()).toBeAttached();
    const clusters = s.locator('.vv-clinvar-mark.is-cluster');
    // At fit-gene, the R175H + R248Q + R273H + R282W hotspots collapse to
    // a small number of cluster diamonds.
    const clusterCount = await clusters.count();
    expect(clusterCount).toBeGreaterThan(0);
    // Cluster significance attribute should always be pathogenic for these
    // fixtures (R-codon hotspots dominate the cluster colour).
    const sig = await clusters.first().getAttribute('data-vv-significance');
    expect(sig).toBe('pathogenic');
  });

  test('clicking a cluster opens a popover listing its members', async ({ page }) => {
    const s = await scenario(page);
    const cluster = s.locator('.vv-clinvar-mark.is-cluster').first();
    await cluster.click();
    const popover = s.locator('[data-testid="clinvar-popover"]');
    await expect(popover).toBeVisible();
    const rows = popover.locator('.vv-clinvar-popover-row');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThanOrEqual(2);
  });

  test('clicking a member row fires the host onFeatureClick and closes the popover', async ({ page }) => {
    const s = await scenario(page);
    const cluster = s.locator('.vv-clinvar-mark.is-cluster').first();
    await cluster.click();
    const popover = s.locator('[data-testid="clinvar-popover"]');
    await expect(popover).toBeVisible();
    const firstRow = popover.locator('.vv-clinvar-popover-row').first();
    const featureId = await firstRow.getAttribute('data-vv-feature-id');
    expect(featureId).toBeTruthy();
    await firstRow.click();
    await expect(popover).toHaveCount(0);
    await expect(s.locator('[data-testid="clinvar-last-clicked"] strong')).toHaveText(
      featureId!,
    );
  });

  test('clicking the backdrop dismisses the popover', async ({ page }) => {
    const s = await scenario(page);
    const cluster = s.locator('.vv-clinvar-mark.is-cluster').first();
    await cluster.click();
    const popover = s.locator('[data-testid="clinvar-popover"]');
    await expect(popover).toBeVisible();
    const backdrop = s.locator('[data-testid="clinvar-popover-backdrop"]');
    await backdrop.click({ position: { x: 5, y: 5 }, force: true });
    await expect(popover).toHaveCount(0);
  });

  test('zooming in breaks a cluster into individual marks', async ({ page }) => {
    const s = await scenario(page);
    const beforeClusters = await s.locator('.vv-clinvar-mark.is-cluster').count();
    expect(beforeClusters).toBeGreaterThan(0);
    const fig = s.locator('svg.vv-figure');
    await fig.click({ position: { x: 5, y: 5 } });
    for (let i = 0; i < 6; i++) await page.keyboard.press('=');
    await page.waitForTimeout(500);
    const afterClusters = await s.locator('.vv-clinvar-mark.is-cluster').count();
    expect(afterClusters).toBeLessThan(beforeClusters);
  });
});
