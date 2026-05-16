import { test, expect, type Locator, type Page } from '@playwright/test';

async function scenario(page: Page): Promise<Locator> {
  await page.goto('/');
  return page.locator('section[aria-labelledby="scenario-default-chrome"]');
}

test.describe('Slice 20 — default chrome components', () => {
  test('DefaultTrackChevron collapses a track on click', async ({ page }) => {
    const s = await scenario(page);
    const chevron = s.locator('[data-testid="gene-glyph-chevron-variants"]');
    await expect(chevron).toBeVisible();
    await expect(chevron).toHaveAttribute('aria-expanded', 'true');
    // Variants render as ticks/dots inside the figure; the host's collapse
    // swaps the real track for a stub so the chevron row stays reachable
    // and the figure-side render disappears.
    const tracks = s.locator('[data-vv-track-id="variants"]');
    await expect(tracks.locator('.vv-variant-tick').first()).toBeAttached();
    await chevron.click();
    await expect(chevron).toHaveAttribute('aria-expanded', 'false');
    await expect(tracks.locator('.vv-variant-tick')).toHaveCount(0);
  });

  test('DefaultTrackChevron re-expands a track on second click', async ({ page }) => {
    const s = await scenario(page);
    const chevron = s.locator('[data-testid="gene-glyph-chevron-pfam-track"]');
    await chevron.click();
    await expect(chevron).toHaveAttribute('aria-expanded', 'false');
    await chevron.click();
    await expect(chevron).toHaveAttribute('aria-expanded', 'true');
  });

  test('DefaultMinimap renders one rect per exon and a window rectangle', async ({ page }) => {
    const s = await scenario(page);
    await expect(s.locator('.vv-default-minimap-exon')).toHaveCount(10);
    const window = s.locator('[data-testid="gene-glyph-minimap-window"]');
    await expect(window).toBeVisible();
    const initialW = await window.evaluate((el) => (el as SVGRectElement).width.baseVal.value);
    expect(initialW).toBeGreaterThan(200); // fit-gene → near-full width
  });

  test('clicking on the minimap background jumps the figure to that location', async ({ page }) => {
    const s = await scenario(page);
    // Zoom in first so the minimap window is narrow enough that a click can
    // visibly move it. The chrome doesn't expose a zoom button itself; use
    // keyboard zoom from a focused figure.
    const fig = s.locator('svg.vv-figure');
    await fig.click({ position: { x: 5, y: 5 } });
    for (let i = 0; i < 4; i++) await page.keyboard.press('=');
    await page.waitForTimeout(450);
    const window = s.locator('[data-testid="gene-glyph-minimap-window"]');
    const bg = s.locator('[data-testid="gene-glyph-minimap-bg"]');
    // The bg sits below the fold on the long playground page; rely on
    // Playwright's element-relative click to scroll it into view before
    // dispatching, then click far to the right of where the window
    // currently sits.
    await bg.scrollIntoViewIfNeeded();
    const before = await window.evaluate((el) => (el as SVGRectElement).x.baseVal.value);
    const bbox = (await bg.boundingBox())!;
    await bg.click({ position: { x: bbox.width * 0.85, y: bbox.height / 2 } });
    await page.waitForTimeout(450);
    const after = await window.evaluate((el) => (el as SVGRectElement).x.baseVal.value);
    expect(after).toBeGreaterThan(before + 20);
  });

  test('dragging the minimap window pans the figure', async ({ page }) => {
    const s = await scenario(page);
    const fig = s.locator('svg.vv-figure');
    await fig.click({ position: { x: 5, y: 5 } });
    for (let i = 0; i < 4; i++) await page.keyboard.press('=');
    await page.waitForTimeout(450);
    const window = s.locator('[data-testid="gene-glyph-minimap-window"]');
    await window.scrollIntoViewIfNeeded();
    const before = await window.evaluate((el) => (el as SVGRectElement).x.baseVal.value);
    const wbox = (await window.boundingBox())!;
    await page.mouse.move(wbox.x + wbox.width / 2, wbox.y + wbox.height / 2);
    await page.mouse.down();
    await page.mouse.move(wbox.x + wbox.width / 2 + 80, wbox.y + wbox.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(50);
    const after = await window.evaluate((el) => (el as SVGRectElement).x.baseVal.value);
    expect(after).toBeGreaterThan(before + 20);
  });

  test('dragging the right edge handle zooms the figure', async ({ page }) => {
    const s = await scenario(page);
    const fig = s.locator('svg.vv-figure');
    await fig.click({ position: { x: 5, y: 5 } });
    // Start somewhere mid-zoom so there's headroom either way.
    for (let i = 0; i < 3; i++) await page.keyboard.press('=');
    await page.waitForTimeout(450);
    const window = s.locator('[data-testid="gene-glyph-minimap-window"]');
    const handle = s.locator('[data-testid="gene-glyph-minimap-handle-right"]');
    await handle.scrollIntoViewIfNeeded();
    const widthBefore = await window.evaluate((el) => (el as SVGRectElement).width.baseVal.value);
    const hbox = (await handle.boundingBox())!;
    await page.mouse.move(hbox.x + hbox.width / 2, hbox.y + hbox.height / 2);
    await page.mouse.down();
    // Drag the right edge inward → window narrows → figure zooms in.
    await page.mouse.move(hbox.x - 60, hbox.y + hbox.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(50);
    const widthAfter = await window.evaluate((el) => (el as SVGRectElement).width.baseVal.value);
    expect(widthAfter).toBeLessThan(widthBefore - 20);
  });
});
