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

  test('toggling host-side significance filter re-clusters surviving records (RD-1102)', async ({
    page,
  }) => {
    const s = await scenario(page);
    const pathogenicMarks = s.locator('.vv-clinvar-mark[data-vv-significance="pathogenic"]');
    // At fit-gene zoom the TP53 hotspots dominate; we expect at least one
    // pathogenic-coloured mark on screen.
    expect(await pathogenicMarks.count()).toBeGreaterThan(0);

    // Toggle off pathogenic + likely_pathogenic — the viewer re-clusters
    // against the survivors purely from the new filter predicate.
    await s.locator('[data-testid="clinvar-chip-pathogenic"]').click();
    await s.locator('[data-testid="clinvar-chip-likely_pathogenic"]').click();
    await page.waitForTimeout(50);

    // No remaining cluster carries a pathogenic representative once the
    // pathogenic + likely_pathogenic members are filtered out. The cluster
    // gets re-coloured to the next-highest survivor (VUS / conflicting /
    // benign), so the count of pathogenic-tagged marks drops to zero.
    expect(await pathogenicMarks.count()).toBe(0);

    // Re-enabling restores them.
    await s.locator('[data-testid="clinvar-chip-pathogenic"]').click();
    await s.locator('[data-testid="clinvar-chip-likely_pathogenic"]').click();
    await page.waitForTimeout(50);
    expect(await pathogenicMarks.count()).toBeGreaterThan(0);
  });

  test('drag-to-zoom starting over a ClinVar cluster narrows the viewport (RD-1102 / RD-1106)', async ({
    page,
  }) => {
    // RD-1102 asked for a region-zoom gesture on the ClinVar track. RD-1106
    // shipped drag-to-zoom as the figure-wide default, and the ClinVar mark
    // only stops propagation on `onClick` (clicks, not pointerdown), so the
    // SVG-level pointerdown still arms the box-zoom even when the gesture
    // starts on a cluster glyph. This test pins that contract.
    const s = await scenario(page);
    const fig = s.locator('svg.vv-figure');
    const figBox = (await fig.boundingBox())!;
    const cluster = s.locator('.vv-clinvar-mark.is-cluster').first();
    const clusterBox = (await cluster.boundingBox())!;
    const startX = clusterBox.x + clusterBox.width / 2;
    const startY = clusterBox.y + clusterBox.height / 2;
    const endX = startX + Math.min(160, figBox.x + figBox.width - startX - 4);
    expect(endX).toBeGreaterThan(startX + 40);

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // Move in several steps so the gesture is unambiguously a drag (not a
    // click) and the box-zoom preview rect mounts.
    await page.mouse.move(startX + 30, startY, { steps: 4 });
    await expect(s.locator('[data-testid="gene-glyph-box-zoom"]')).toBeVisible();
    await page.mouse.move(endX, startY, { steps: 6 });
    await page.mouse.up();

    // After release, the box-zoom preview tears down and the visible
    // exon-span shrinks (the SVG's intrinsic content-width grows or the
    // visible exons collapse — measure by counting rendered exon groups
    // and asserting the figure's exon-scale CSS variable changed).
    await expect(s.locator('[data-testid="gene-glyph-box-zoom"]')).toHaveCount(0);
    const exonScale = await fig.evaluate((el) => {
      const v = getComputedStyle(el).getPropertyValue('--vv-exon-scale-x-0');
      return Number(v) || 1;
    });
    expect(exonScale).toBeGreaterThan(1);
  });
});
