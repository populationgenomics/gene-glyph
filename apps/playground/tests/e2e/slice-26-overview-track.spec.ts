import { test, expect, type Locator, type Page } from '@playwright/test';

async function scenario(page: Page): Promise<Locator> {
  await page.goto('/');
  return page.locator('section[aria-labelledby="scenario-overview-track"]');
}

test.describe('Slice 26 — overview track + minimap', () => {
  test('overviewTrack renders the upstream exon track minimap and a window rectangle', async ({ page }) => {
    const s = await scenario(page);
    // The overview lives in the in-figure track stack and composes
    // `renderMinimap` outputs from upstream tracks. The exon track
    // contributes one minimap row with one rect per exon.
    const overviewFigure = s.locator('svg.vv-figure').first();
    await expect(
      overviewFigure.locator('.vv-overview-row .vv-exon-minimap-exon'),
    ).toHaveCount(10);
    await expect(
      overviewFigure.locator('[data-testid="gene-glyph-overview-window"]'),
    ).toBeVisible();
  });

  test('exporting the in-figure overview keeps the window rectangle in the SVG markup', async ({ page }) => {
    // The whole point of an in-figure overview vs a chrome minimap: the
    // serialised SVG carries the navigation context.
    const s = await scenario(page);
    await expect(s.locator('.vv-exon-minimap-exon').first()).toBeAttached();
    const overviewFigure = s.locator('svg.vv-figure').first();
    const svgHtml = await overviewFigure.evaluate((el) => el.outerHTML);
    expect(svgHtml).toContain('gene-glyph-overview-window');
    expect(svgHtml).toContain('vv-exon-minimap-exon');
  });

  test('clicking the overview background jumps the figure', async ({ page }) => {
    const s = await scenario(page);
    const fig = s.locator('svg.vv-figure').first();
    await fig.click({ position: { x: 5, y: 60 } });
    // Zoom in so the window is narrow enough that a click can shift it.
    for (let i = 0; i < 4; i++) await page.keyboard.press('=');
    await page.waitForTimeout(450);
    const window = s.locator('[data-testid="gene-glyph-overview-window"]');
    const bg = s.locator('[data-testid="gene-glyph-overview-bg"]');
    await bg.scrollIntoViewIfNeeded();
    const before = await window.evaluate((el) => (el as SVGRectElement).x.baseVal.value);
    const bbox = (await bg.boundingBox())!;
    await bg.click({ position: { x: bbox.width * 0.85, y: bbox.height / 2 } });
    await page.waitForTimeout(450);
    const after = await window.evaluate((el) => (el as SVGRectElement).x.baseVal.value);
    expect(after).toBeGreaterThan(before + 20);
  });

  test('dragging the overview window pans the figure', async ({ page }) => {
    const s = await scenario(page);
    const fig = s.locator('svg.vv-figure').first();
    await fig.click({ position: { x: 5, y: 60 } });
    for (let i = 0; i < 4; i++) await page.keyboard.press('=');
    await page.waitForTimeout(450);
    const window = s.locator('[data-testid="gene-glyph-overview-window"]');
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
    const fig = s.locator('svg.vv-figure').first();
    await fig.click({ position: { x: 5, y: 60 } });
    for (let i = 0; i < 3; i++) await page.keyboard.press('=');
    await page.waitForTimeout(450);
    const window = s.locator('[data-testid="gene-glyph-overview-window"]');
    const handle = s.locator('[data-testid="gene-glyph-overview-handle-right"]');
    await handle.scrollIntoViewIfNeeded();
    const widthBefore = await window.evaluate((el) => (el as SVGRectElement).width.baseVal.value);
    const hbox = (await handle.boundingBox())!;
    await page.mouse.move(hbox.x + hbox.width / 2, hbox.y + hbox.height / 2);
    await page.mouse.down();
    await page.mouse.move(hbox.x - 60, hbox.y + hbox.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(50);
    const widthAfter = await window.evaluate((el) => (el as SVGRectElement).width.baseVal.value);
    expect(widthAfter).toBeLessThan(widthBefore - 20);
  });

  test('window rectangle uses the mini-viewport baseline mapping, not the figure CSS transforms', async ({ page }) => {
    // The overview's mini-viewport is pinned to fit-gene at the figure
    // width; cdsToBaselineX(viewerRange[0..1]) in that frame is purely
    // logical CDS-to-display math, decoupled from the figure's
    // gaps-don't-scale transforms. After deep zoom+pan to the 3' end,
    // the window's left edge should sit in the gene's last ~25% of
    // baseline-x (the visible CDS range is at the 3' end of TP53).
    const s = await scenario(page);
    const fig = s.locator('svg.vv-figure').first();
    await fig.click({ position: { x: 5, y: 80 } });
    for (let i = 0; i < 4; i++) await page.keyboard.press('=');
    await page.waitForTimeout(450);
    for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(450);
    const windowX = await s.evaluate((sectionEl) => {
      const figSvg = sectionEl.querySelector('svg.vv-figure') as SVGSVGElement;
      const win = figSvg.querySelector(
        '[data-testid="gene-glyph-overview-window"]',
      ) as SVGRectElement;
      return win.x.baseVal.value;
    });
    expect(windowX).toBeGreaterThan(700);
  });

  test('both overviewTrack and DefaultMinimap coexist in this scenario', async ({ page }) => {
    // The demo deliberately shows both side by side so a reader can compare
    // the trade-off. Both should be visible on the page.
    const s = await scenario(page);
    await expect(s.locator('[data-testid="gene-glyph-overview-window"]')).toBeVisible();
    await expect(s.locator('[data-testid="gene-glyph-minimap-window"]')).toBeVisible();
  });
});
