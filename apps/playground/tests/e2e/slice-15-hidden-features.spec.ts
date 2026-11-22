import { test, expect, type Page } from '@playwright/test';

async function scenario(page: Page) {
  await page.goto('/');
  return page.locator('section[aria-labelledby="scenario-slots"]');
}

test.describe('Slice 15 — hidden-feature indicators', () => {
  test('protein mode marks the intron holding a variant it cannot draw', async ({ page }) => {
    const s = await scenario(page);
    await s.locator('select').first().selectOption('protein');

    // TP53 fixture contributes one intronic variant (c.560-2A>G) so exactly
    // one indicator should render. Its anchor id encodes the bracketing exon
    // pair; the slice spec pins the format `__hidden_intron_{A}_{B}`.
    const mark = s.locator('.vv-hidden-feature-mark');
    await expect(mark).toHaveCount(1);
    await expect(mark).toHaveAttribute('data-vv-feature-id', /^__hidden_intron_\d+_\d+$/);
    await page.waitForTimeout(550);
    const opacity = await mark.evaluate((el) => Number(getComputedStyle(el).opacity));
    expect(opacity).toBeCloseTo(1, 1);
  });

  for (const mode of ['genome', 'transcript'] as const) {
    test(`${mode} mode draws the intronic variant on the exon edge instead of a mark`, async ({
      page,
    }) => {
      const s = await scenario(page);
      await s.locator('select').first().selectOption(mode);
      await expect(s.locator('.vv-hidden-feature-mark')).toHaveCount(0);
      await expect(s.locator('.vv-variant[data-vv-intron-side="acceptor"]')).toHaveCount(1);
    });
  }

  test('clicking a hidden-feature mark fires onFeatureClick with the documented anchor id', async ({
    page,
  }) => {
    const s = await scenario(page);
    await s.locator('select').first().selectOption('protein');
    await page.waitForTimeout(550);

    const mark = s.locator('.vv-hidden-feature-mark').first();
    const featureId = await mark.getAttribute('data-vv-feature-id');
    expect(featureId).not.toBeNull();
    await mark.click();

    const readout = s.locator('[data-testid="hidden-click-readout"]');
    await expect(readout).toBeVisible();
    await expect(readout).toContainText(featureId!);
  });

  test('the indicator is structurally inside the figure SVG so future export captures it cleanly', async ({
    page,
  }) => {
    const s = await scenario(page);
    await s.locator('select').first().selectOption('protein');
    await expect(s.locator('svg.vv-figure .vv-hidden-feature-mark')).toHaveCount(1);
  });
});
