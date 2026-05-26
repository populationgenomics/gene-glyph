import { test, expect, type Locator, type Page } from '@playwright/test';

/** Read the current `[lo–hi] · NN×` readout from the interaction-demo
 *  header. Returns numeric range values so tests can compare numerically. */
async function readRange(page: Page): Promise<[number, number]> {
  const text = await page.locator('section[aria-labelledby="scenario-interactions"]').locator('span', { hasText: /range \[/ }).textContent();
  const match = (text ?? '').match(/range \[(-?\d+)[\s–—-]+(-?\d+)\]/);
  if (!match) throw new Error(`could not parse range from ${text}`);
  return [Number(match[1]), Number(match[2])];
}

async function lastReason(page: Page): Promise<string | null> {
  const txt = (await page.locator('section[aria-labelledby="scenario-interactions"]').locator('span', { hasText: 'last:' }).textContent()) ?? null;
  return txt ? txt.replace(/^last:\s*/, '').trim() : null;
}

async function getFigure(page: Page): Promise<Locator> {
  const figure = page.locator('section[aria-labelledby="scenario-interactions"] svg.vv-figure');
  await expect(figure).toBeVisible();
  return figure;
}

test.describe('Slice 9 — pan / zoom interactions (RD-1070)', () => {
  test('keyboard right-arrow pans the range to the right', async ({ page }) => {
    await page.goto('/');
    await getFigure(page);
    // Focus the keyboard-handling root directly. Slice 17 added a
    // .vv-figure-wrap between the SVG and the figure row, so relative
    // parent-walks are now brittle.
    const container = page.locator('section[aria-labelledby="scenario-interactions"] [data-testid="gene-glyph"]');
    await container.focus();
    const before = await readRange(page);
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await readRange(page))[0], { timeout: 2_000 }).toBeGreaterThan(before[0]);
    const after = await readRange(page);
    expect(after[1]).toBeGreaterThan(before[1]);
    expect(await lastReason(page)).toBe('keyboard');
  });

  test('keyboard "1" returns to fit-gene', async ({ page }) => {
    await page.goto('/');
    await getFigure(page);
    const container = page.locator('section[aria-labelledby="scenario-interactions"] [data-testid="gene-glyph"]');
    await container.focus();
    await page.keyboard.press('ArrowRight');
    // The readout updates via rAF, not synchronously on keydown — poll until
    // the panned state propagates so the subsequent "1" reset is observable.
    await expect.poll(async () => (await readRange(page))[0], { timeout: 2_000 }).toBeGreaterThan(1);
    await container.focus();
    await page.keyboard.press('1');
    await expect.poll(async () => (await readRange(page))[0], { timeout: 2_000 }).toBeLessThanOrEqual(1);
    const reset = await readRange(page);
    // Natural range is [1, cdsLength=1182] in genome mode.
    expect(reset[1]).toBeGreaterThanOrEqual(1100);
  });

  test('wheel pans horizontally', async ({ page }) => {
    await page.goto('/');
    const figure = await getFigure(page);
    const before = await readRange(page);
    const box = await figure.boundingBox();
    if (!box) throw new Error('figure not visible');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(120, 0);
    const after = await readRange(page);
    expect(after[0]).toBeGreaterThan(before[0]);
    expect(after[1]).toBeGreaterThan(before[1]);
    expect(await lastReason(page)).toBe('wheel');
  });

  test('Space+drag pans the gene under the cursor', async ({ page }) => {
    await page.goto('/');
    // Seed an inset range so drag has room to move in either direction.
    const container = page.locator('section[aria-labelledby="scenario-interactions"] [data-testid="gene-glyph"]');
    await container.focus();
    await page.keyboard.press('+');
    const before = await readRange(page);
    const figure = await getFigure(page);
    const box = await figure.boundingBox();
    if (!box) throw new Error('figure not visible');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    // Plain drag now means box-zoom (RD-1106, Adobe Hand-tool pattern);
    // Space holds the pan modifier.
    await page.keyboard.down('Space');
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx - 100, cy, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up('Space');
    const after = await readRange(page);
    // Drag-right-to-left (cursor moves left) = range slides right.
    expect(after[0]).toBeGreaterThan(before[0]);
    expect(await lastReason(page)).toBe('drag');
  });

  test('interactionMode="embed" ignores Cmd/Ctrl+wheel zoom', async ({ page }) => {
    await page.goto('/');
    const scenario = page.locator('section[aria-labelledby="scenario-interactions"]');
    // Switch the demo into embed mode.
    await scenario.getByLabel('Interaction mode').selectOption('embed');
    const figure = await getFigure(page);
    const before = await readRange(page);
    const box = await figure.boundingBox();
    if (!box) throw new Error('figure not visible');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    // Synthesise a Cmd+wheel zoom; in embed mode the listener returns
    // without preventing default, so the viewer range stays put.
    await figure.evaluate((el, dy) => {
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, ctrlKey: true, bubbles: true, cancelable: true }));
    }, -100);
    const after = await readRange(page);
    expect(after).toEqual(before);
  });
});
