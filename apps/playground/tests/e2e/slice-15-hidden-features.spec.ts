import { test, expect, type Page } from '@playwright/test';

async function scenario(page: Page) {
  await page.goto('/');
  return page.locator('section[aria-labelledby="scenario-slots"]');
}

test.describe('Slice 15 — hidden-feature indicators', () => {
  test('a hidden-feature mark renders for each intron with dropped features and fades in once the intron collapses', async ({ page }) => {
    const s = await scenario(page);

    // TP53 fixture contributes one intronic variant (c.560-2A>G) so exactly
    // one indicator should render. Its anchor id encodes the bracketing exon
    // pair; the slice spec pins the format `__hidden_intron_{A}_{B}`.
    const mark = s.locator('.vv-hidden-feature-mark');
    await expect(mark).toHaveCount(1);
    await expect(mark).toHaveAttribute(
      'data-vv-feature-id',
      /^__hidden_intron_\d+_\d+$/,
    );

    // CDS-with-introns: intronScale = 1 → mark is fully faded out so users
    // can read the polyline beneath it.
    const initialOpacity = await mark.evaluate(
      (el) => Number(getComputedStyle(el).opacity),
    );
    expect(initialOpacity).toBeCloseTo(0, 1);

    // Spliced collapses intronScale → mark fades in to 1.
    await s.locator('select').first().selectOption('cds-spliced');
    await page.waitForTimeout(550);
    const splicedOpacity = await mark.evaluate(
      (el) => Number(getComputedStyle(el).opacity),
    );
    expect(splicedOpacity).toBeCloseTo(1, 1);
  });

  test('clicking a hidden-feature mark fires onFeatureClick with the documented anchor id', async ({ page }) => {
    const s = await scenario(page);
    await s.locator('select').first().selectOption('cds-spliced');
    await page.waitForTimeout(550);

    const mark = s.locator('.vv-hidden-feature-mark').first();
    const featureId = await mark.getAttribute('data-vv-feature-id');
    expect(featureId).not.toBeNull();
    await mark.click();

    const readout = s.locator('[data-testid="hidden-click-readout"]');
    await expect(readout).toBeVisible();
    await expect(readout).toContainText(featureId!);
  });

  test('the indicator is structurally inside the figure SVG so future export captures it cleanly', async ({ page }) => {
    const s = await scenario(page);
    const inFigure = await s
      .locator('svg.vv-figure .vv-hidden-feature-mark')
      .count();
    expect(inFigure).toBe(1);
  });
});
