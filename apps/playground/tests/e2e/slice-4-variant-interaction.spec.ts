import { test, expect } from '@playwright/test';

test.describe('Slice 4 — variant track + interaction (RD-1063)', () => {
  test('hover on a host table row lifts the matching variant tick; click toggles the selection ring', async ({ page }) => {
    await page.goto('/');
    const scenario = page.locator('section[aria-labelledby="scenario-paper-report"]');
    const figure = scenario.locator('svg.vv-figure');
    await expect(figure).toBeVisible();

    // Pick the first variant row in the host table.
    const firstRow = scenario.locator('table tbody tr').first();
    const variantLabel = (await firstRow.locator('td').first().textContent())?.trim() ?? '';
    expect(variantLabel.length).toBeGreaterThan(0);

    // Hover the row — the matching feature `<g>` in the figure gains the
    // `is-hovered` class (controlled prop lift) and the inner `<g>`
    // translates via CSS transition.
    await firstRow.hover();
    const hoveredFeature = figure.locator('.vv-variant.is-hovered');
    await expect(hoveredFeature).toHaveCount(1);

    // Click on the row dispatches `onFeatureClick`; the host toggles the
    // selection set; the figure picks up `selectedFeatureIds` and applies
    // the selection ring.
    await firstRow.click();
    await expect(figure.locator('.vv-variant.is-selected')).toHaveCount(1);
  });

  test('variants that cannot project (intronic, out-of-bounds) appear in the unplaced chip row', async ({ page }) => {
    await page.goto('/');
    const below = page.locator('section[aria-labelledby="scenario-paper-report"] [data-testid="gene-glyph-below"]');
    await expect(below).toBeVisible();
    await expect(below.locator('.vv-unplaced-chip')).not.toHaveCount(0);
  });
});
