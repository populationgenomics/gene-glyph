import { test, expect, type Locator, type Page } from '@playwright/test';

async function scenario(page: Page): Promise<Locator> {
  await page.goto('/');
  return page.locator('section[aria-labelledby="scenario-tooltips"]');
}

async function firstVariant(s: Locator): Promise<Locator> {
  // The tooltip scenario uses TP53; its first placed variant is R175H. Tab-
  // order follows screen-x, but the underlying DOM order matches fixture
  // order — picking the first `vv-variant` group lands us on a stable target
  // regardless of viewport size.
  const variant = s.locator('.vv-variant').first();
  await expect(variant).toBeVisible();
  return variant;
}

test.describe('Slice 17 — overlay tooltips', () => {
  test('overlay layer is a sibling of the figure SVG (export-clean)', async ({ page }) => {
    const s = await scenario(page);
    await expect(s.locator('svg.vv-figure')).toBeVisible();
    const overlay = s.locator('[data-testid="gene-glyph-overlay-layer"]').first();
    await expect(overlay).toBeAttached();
    // Overlay must NOT live inside the figure SVG.
    const inSvg = await s.locator('svg.vv-figure [data-testid="gene-glyph-overlay-layer"]').count();
    expect(inSvg).toBe(0);
  });

  test('host renderTooltip surfaces variant category on hover', async ({ page }) => {
    const s = await scenario(page);
    // Custom renderer is the default in the scenario.
    await expect(s.locator('[data-testid="tooltip-custom-toggle"]')).toBeChecked();
    const variant = await firstVariant(s);
    await variant.hover();
    const tip = s.locator('[data-testid="gene-glyph-tooltip"]');
    await expect(tip).toBeVisible();
    // R175H is a missense variant in the fixture.
    await expect(tip).toContainText('R175H');
    await expect(tip).toContainText('missense');
    // Moving the cursor off the figure dismisses the tooltip.
    await page.mouse.move(0, 0);
    await expect(tip).toHaveCount(0);
  });

  test('built-in tooltip falls back to Track.featureLabel when host omits renderTooltip', async ({ page }) => {
    const s = await scenario(page);
    await s.locator('[data-testid="tooltip-custom-toggle"]').uncheck();
    const variant = await firstVariant(s);
    await variant.hover();
    const tip = s.locator('[data-testid="gene-glyph-tooltip"]');
    await expect(tip).toBeVisible();
    // Default label is the variant's `label` field (no category badge).
    await expect(tip).toHaveText('R175H');
  });

  test('tooltip fade-in respects prefers-reduced-motion', async ({ page }) => {
    const s = await scenario(page);
    await page.locator('[data-testid="reduce-motion-toggle"]').check();
    const variant = await firstVariant(s);
    await variant.hover();
    const tip = s.locator('[data-testid="gene-glyph-tooltip"]');
    await expect(tip).toBeVisible();
    // With reduced motion, the tooltip skips the fade animation and lands at
    // opacity 1 immediately rather than ramping from 0.
    const opacity = await tip.evaluate((el) => getComputedStyle(el).opacity);
    expect(Number(opacity)).toBe(1);
    const animationName = await tip.evaluate((el) => getComputedStyle(el).animationName);
    expect(animationName).toBe('none');
  });
});
