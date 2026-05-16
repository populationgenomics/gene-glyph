import { test, expect } from '@playwright/test';

test.describe('Slice 8 — imperative ref + fitTo / zoomBy (RD-1068)', () => {
  test('zoom buttons in the slot-system toolbar drive the figure and update the live readout', async ({ page }) => {
    await page.goto('/');
    const scenario = page.locator('section[aria-labelledby="scenario-slots"]');
    const header = scenario.locator('[data-testid="gene-glyph-header-slot"]');

    // The accessible name of each zoom button is its visible glyph (`+` /
    // `−` / `Fit` / `Variant`); the descriptive label lives on `title`.
    // Use `getByTitle` so the tests are insensitive to that visible text.
    const readout = header.locator('span[title^="Range"]');
    await expect(readout).toBeVisible();
    const fitZoom = (await readout.textContent())?.trim() ?? '';
    expect(fitZoom).toMatch(/\d\.\d+×/);

    await header.getByTitle('Zoom in').click();
    await expect.poll(async () => {
      const t = (await readout.textContent())?.trim() ?? '';
      return parseFloat(t);
    }, { timeout: 2_000 }).toBeGreaterThan(1.5);

    await header.getByTitle('Fit gene').click();
    await expect.poll(async () => {
      const t = (await readout.textContent())?.trim() ?? '';
      return parseFloat(t);
    }, { timeout: 2_000 }).toBeLessThan(1.1);
  });

  test('fit-variant button zooms onto the chosen variant', async ({ page }) => {
    await page.goto('/');
    const scenario = page.locator('section[aria-labelledby="scenario-slots"]');
    const header = scenario.locator('[data-testid="gene-glyph-header-slot"]');
    const readout = header.locator('span[title^="Range"]');

    await header.getByTitle('Fit gene').click();
    // The fit-variant button's title is dynamic (`Fit <variant label>`); the
    // visible button text is always "Variant", so match by text instead.
    await header.getByRole('button', { name: 'Variant' }).click();
    await expect.poll(async () => {
      const t = (await readout.textContent())?.trim() ?? '';
      return parseFloat(t);
    }, { timeout: 2_000 }).toBeGreaterThan(2);
  });
});
