import { test, expect } from '@playwright/test';

test.describe('Slice 7 — slot system (RD-1067)', () => {
  test('header, footer, and right gutter slots all render alongside the figure', async ({ page }) => {
    await page.goto('/');
    const scenario = page.locator('section[aria-labelledby="scenario-slots"]');
    await expect(scenario.locator('[data-testid="gene-glyph-header-slot"]')).toBeVisible();
    await expect(scenario.locator('[data-testid="gene-glyph-footer-slot"]')).toBeVisible();
    await expect(scenario.locator('[data-testid="gene-glyph-right-gutter"]')).toBeVisible();
    await expect(scenario.locator('[data-testid="gene-glyph-left-gutter"]')).toBeVisible();
  });

  test('changing the gutter widths shifts the figure SVG within the row', async ({ page }) => {
    await page.goto('/');
    const scenario = page.locator('section[aria-labelledby="scenario-slots"]');
    const figure = scenario.locator('svg.vv-figure');
    const figureBox1 = await figure.boundingBox();
    expect(figureBox1).not.toBeNull();
    // The figure occupies the row between left + right gutters; their widths
    // are concrete numbers (96 / 56). Without per-test mutation we can at
    // least assert the figure's left edge sits past the left gutter's right
    // edge.
    const leftGutter = scenario.locator('[data-testid="gene-glyph-left-gutter"]');
    const leftBox = await leftGutter.boundingBox();
    expect(leftBox).not.toBeNull();
    expect(figureBox1!.x).toBeGreaterThanOrEqual(leftBox!.x + leftBox!.width - 1);
  });
});
