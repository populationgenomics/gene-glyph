import { test, expect, type Locator, type Page } from '@playwright/test';

async function getFigure(page: Page): Promise<Locator> {
  const figure = page.locator('section[aria-labelledby="scenario-interactions"] svg.vv-figure');
  await expect(figure).toBeVisible();
  return figure;
}

test.describe('Slice 10 — smooth pan internals (RD-1084)', () => {
  test('exon rects keep a stable width across a drag-pan (no edge popping)', async ({ page }) => {
    await page.goto('/');
    const figure = await getFigure(page);
    // Snapshot rect widths before and during a drag. Slice 10 guarantees
    // baseline geometry: each `.vv-exon-rect` keeps the same `width`
    // attribute regardless of pan. Prior to Slice 10, edge exons shrank
    // continuously during drag as their CDS range got clipped — the "edge
    // popping" symptom.
    const before = await figure.locator('.vv-exon-rect').evaluateAll((rs) =>
      rs.map((r) => r.getAttribute('width')),
    );

    const box = await figure.boundingBox();
    if (!box) throw new Error('figure not visible');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    // Zoom in first so there's room to drag in either direction.
    const container = page.locator(
      'section[aria-labelledby="scenario-interactions"] [data-testid="gene-glyph"]',
    );
    await container.focus();
    await page.keyboard.press('+');
    await page.keyboard.press('+');

    const afterZoom = await figure.locator('.vv-exon-rect').evaluateAll((rs) =>
      rs.map((r) => r.getAttribute('width')),
    );
    expect(afterZoom).toEqual(before);

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx - 150, cy, { steps: 8 });
    const midDrag = await figure.locator('.vv-exon-rect').evaluateAll((rs) =>
      rs.map((r) => r.getAttribute('width')),
    );
    await page.mouse.up();
    expect(midDrag).toEqual(before);
  });

  test('off-figure exons get true off-figure --vv-exon-x-{N} values, not 0px', async ({ page }) => {
    await page.goto('/');
    const container = page.locator(
      'section[aria-labelledby="scenario-interactions"] [data-testid="gene-glyph"]',
    );
    await container.focus();
    // Zoom in several times so most exons sit off-figure.
    for (let i = 0; i < 4; i += 1) await page.keyboard.press('+');

    const figure = await getFigure(page);
    // Find an exon whose current screen-x value is negative (off-figure left)
    // or > figure width (off-figure right). The figure's `overflow: hidden`
    // clips the visual, but the CSS variable still reports the true value so
    // future pan / zoom animations slide it cleanly past the edge.
    const offFigure = await figure.evaluate((el) => {
      const svg = el as SVGSVGElement;
      const figureWidth = svg.getBoundingClientRect().width;
      // ViewportController.attach() sets the CSS variables inline on the
      // figure SVG. Read them off the SVG's `style` attribute directly —
      // computed styles on the parent div don't see inline-styled SVG vars.
      const values: Array<{ idx: number; value: number }> = [];
      for (let i = 0; i < 16; i += 1) {
        const v = svg.style.getPropertyValue(`--vv-exon-x-${i}`).trim();
        if (!v) break;
        values.push({ idx: i, value: parseFloat(v) });
      }
      return { values, figureWidth };
    });
    expect(offFigure).not.toBeNull();
    const anyOffFigure = offFigure!.values.some(
      (v) => v.value < -0.1 || v.value > offFigure!.figureWidth + 0.1,
    );
    expect(anyOffFigure).toBe(true);
  });

  test('keyboard pan never adds the legacy vv-no-transition class (Slice 33 retired the animation system)', async ({ page }) => {
    await page.goto('/');
    const container = page.locator(
      'section[aria-labelledby="scenario-interactions"] [data-testid="gene-glyph"]',
    );
    await container.focus();
    await page.keyboard.press('ArrowRight');
    const cls = await container.getAttribute('class');
    expect(cls ?? '').not.toContain('vv-no-transition');
  });
});
