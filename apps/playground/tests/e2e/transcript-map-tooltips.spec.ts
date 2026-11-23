import { test, expect, type Locator, type Page } from '@playwright/test';

async function scenario(page: Page): Promise<Locator> {
  await page.goto('/');
  return page.locator('section[aria-labelledby="scenario-transcript-map"]');
}

test.describe('Transcript map — tooltips without native titles', () => {
  test('carries no title attribute or SVG title', async ({ page }) => {
    const s = await scenario(page);
    await expect(s.locator('.vv-unplaced-chip').first()).toBeVisible();
    await expect(s.locator('[title]')).toHaveCount(0);
    await expect(s.locator('title')).toHaveCount(0);
  });

  test('the MANE badge shows its description in the built-in tooltip', async ({ page }) => {
    const s = await scenario(page);
    await s.locator('.vv-mane-badge').hover();
    await expect(s.locator('[data-testid="gene-glyph-tooltip"]')).toHaveText(
      'MANE Select transcript',
    );
  });

  test('an unplaced chip shows its label above the chip, and Escape dismisses it', async ({
    page,
  }) => {
    const s = await scenario(page);
    const chip = s.locator('[data-testid="case-unplaced"] .vv-unplaced-chip');
    await chip.hover();
    const tip = s.locator('[data-testid="gene-glyph-tooltip"]');
    await expect(tip).toHaveText('chr17:g.7700000A>G');
    const tipBox = (await tip.boundingBox())!;
    const chipBox = (await chip.boundingBox())!;
    expect(tipBox.y + tipBox.height).toBeLessThanOrEqual(chipBox.y);
    await page.keyboard.press('Escape');
    await expect(tip).toHaveCount(0);
  });
});
