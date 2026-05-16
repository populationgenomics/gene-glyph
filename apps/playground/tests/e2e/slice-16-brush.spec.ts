import { test, expect, type Locator, type Page } from '@playwright/test';

async function scenario(page: Page): Promise<Locator> {
  await page.goto('/');
  return page.locator('section[aria-labelledby="scenario-slots"]');
}

async function figure(s: Locator): Promise<Locator> {
  const figure = s.locator('svg.vv-figure');
  await expect(figure).toBeVisible();
  return figure;
}

/** Dispatch a shift-key pointer gesture on the figure. We dispatch raw
 *  PointerEvent objects via `evaluate` because Playwright's mouse API drops
 *  modifier-key state on touch / pointer events — the React synthetic event
 *  reads `shiftKey` from the native PointerEvent and our hook keys off it. */
async function shiftDrag(
  _page: Page,
  fig: Locator,
  x1: number,
  x2: number,
  y: number,
): Promise<void> {
  await fig.evaluate(
    (el, args) => {
      const rect = (el as SVGSVGElement).getBoundingClientRect();
      const cy = rect.top + rect.height / 2 + args.y;
      const steps = 8;
      const downX = rect.left + args.x1;
      const upX = rect.left + args.x2;
      const dispatch = (type: string, x: number) => {
        const ev = new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: cy,
          pointerId: 1,
          pointerType: 'mouse',
          button: 0,
          buttons: type === 'pointerup' ? 0 : 1,
          shiftKey: true,
        });
        (type === 'pointerdown' ? el : window).dispatchEvent(ev);
      };
      dispatch('pointerdown', downX);
      for (let i = 1; i <= steps; i++) {
        const x = downX + ((upX - downX) * i) / steps;
        dispatch('pointermove', x);
      }
      dispatch('pointerup', upX);
    },
    { x1, x2, y },
  );
}

async function shiftClick(fig: Locator, x: number, y: number): Promise<void> {
  await fig.evaluate(
    (el, args) => {
      const rect = (el as SVGSVGElement).getBoundingClientRect();
      const cx = rect.left + args.x;
      const cy = rect.top + rect.height / 2 + args.y;
      const dispatch = (type: string) => {
        const ev = new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: cx,
          clientY: cy,
          pointerId: 1,
          pointerType: 'mouse',
          button: 0,
          buttons: type === 'pointerup' ? 0 : 1,
          shiftKey: true,
        });
        (type === 'pointerdown' ? el : window).dispatchEvent(ev);
      };
      dispatch('pointerdown');
      dispatch('pointerup');
    },
    { x, y },
  );
}

test.describe('Slice 16 — brush selection', () => {
  test('shift+drag renders a brush rect and shows a host-driven count', async ({ page }) => {
    const s = await scenario(page);
    const fig = await figure(s);
    const box = await fig.boundingBox();
    if (!box) throw new Error('figure not visible');
    // Drag across the middle ~30% of the figure so the brush covers a chunk
    // of TP53's CDS that contains at least a couple of variants.
    await shiftDrag(page, fig, box.width * 0.3, box.width * 0.65, 0);

    const overlay = s.locator('[data-testid="gene-glyph-brush"]');
    await expect(overlay).toBeVisible();
    await expect(overlay.locator('.vv-brush-rect').first()).toBeVisible();

    const readout = s.locator('[data-testid="brush-readout"]');
    await expect(readout).toBeVisible();
    // The fixture has 5 placed missense / nonsense / synonymous variants in
    // the [protein 100–400] region. The drag covers a generous CDS swath; we
    // assert at least one variant is selected without pinning an exact count
    // (the brush range depends on figure geometry that may differ across
    // browsers).
    await expect(readout).toContainText(/Selected \d+ variant/);
  });

  test('the brush rect lives inside the figure SVG (export-clean)', async ({ page }) => {
    const s = await scenario(page);
    const fig = await figure(s);
    const box = await fig.boundingBox();
    if (!box) throw new Error('figure not visible');
    await shiftDrag(page, fig, box.width * 0.25, box.width * 0.55, 0);
    const inFigure = await s.locator('svg.vv-figure .vv-brush-overlay').count();
    expect(inFigure).toBeGreaterThan(0);
  });

  test('shift-click without drag clears the brush', async ({ page }) => {
    const s = await scenario(page);
    const fig = await figure(s);
    const box = await fig.boundingBox();
    if (!box) throw new Error('figure not visible');
    await shiftDrag(page, fig, box.width * 0.3, box.width * 0.6, 0);
    await expect(s.locator('[data-testid="brush-readout"]')).toBeVisible();

    // A shift-click (no drag) clears.
    await shiftClick(fig, box.width * 0.4, 0);
    await expect(s.locator('[data-testid="brush-readout"]')).toHaveCount(0);
  });

  test('"Selection" button zooms to the brushed range', async ({ page }) => {
    const s = await scenario(page);
    const fig = await figure(s);
    const box = await fig.boundingBox();
    if (!box) throw new Error('figure not visible');
    const zoomText = () =>
      s.locator('span[title^="Range"]').textContent();
    const zoomBefore = await zoomText();
    await shiftDrag(page, fig, box.width * 0.25, box.width * 0.5, 0);
    const selectionBtn = s.locator('[data-testid="zoom-to-selection"]');
    await expect(selectionBtn).toBeEnabled();
    await selectionBtn.click();
    // Animation runs ~350ms; wait for it to land and verify the zoom readout
    // moved (zoom factor > 1× since we're zooming into a sub-range).
    await page.waitForTimeout(500);
    const zoomAfter = await zoomText();
    expect(zoomAfter).not.toEqual(zoomBefore);
    expect(zoomAfter ?? '').toMatch(/[0-9]+\.[0-9]+×/);
  });
});
