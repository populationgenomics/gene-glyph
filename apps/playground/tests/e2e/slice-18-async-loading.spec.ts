import { test, expect, type Locator, type Page } from '@playwright/test';

async function scenario(page: Page): Promise<Locator> {
  await page.goto('/');
  return page.locator('section[aria-labelledby="scenario-async"]');
}

test.describe('Slice 18 — async data source orchestration', () => {
  test('shimmer appears on first load and clears once data resolves', async ({ page }) => {
    const s = await scenario(page);
    // Default delay is 800ms — long enough that the shimmer should be
    // observable from page open. Set the delay first so the next load uses it.
    await s.locator('[data-testid="async-delay-input"]').fill('600');
    // Trigger a viewport change so the debounce + reload kicks; clicking the
    // figure focuses it and a left-arrow nudges the range.
    const fig = s.locator('svg.vv-figure');
    await fig.click({ position: { x: 10, y: 10 } });
    await page.keyboard.press('ArrowRight');
    const shimmerA = s.locator('[data-testid="gene-glyph-shimmer-variants-a"]');
    const shimmerB = s.locator('[data-testid="gene-glyph-shimmer-variants-b"]');
    await expect(shimmerA).toBeVisible();
    await expect(shimmerB).toBeVisible();
    // After the simulated network delay the shimmer should be gone.
    await expect(shimmerA).toHaveCount(0, { timeout: 4000 });
    await expect(shimmerB).toHaveCount(0, { timeout: 4000 });
    await expect(s.locator('[data-testid="async-state-primary"]')).toContainText('ready');
    await expect(s.locator('[data-testid="async-state-secondary"]')).toContainText('ready');
  });

  test('two tracks sharing a DataSource fire one query per unique window', async ({ page }) => {
    const s = await scenario(page);
    // Wait for the initial load to settle before reading the counter.
    await expect(s.locator('[data-testid="async-state-primary"]')).toContainText('ready', {
      timeout: 4000,
    });
    const counter = s.locator('[data-testid="async-query-count"]');
    // First render → exactly one query for the shared (mode, range) tuple.
    await expect(counter).toContainText('queries fired: 1');
    // Speed up the delay so the next debounced load completes quickly.
    await s.locator('[data-testid="async-delay-input"]').fill('50');
    const fig = s.locator('svg.vv-figure');
    await fig.click({ position: { x: 10, y: 10 } });
    await page.keyboard.press('ArrowRight');
    // After the new viewport settles, exactly one additional query fires —
    // the second track resolves from cache.
    await expect(s.locator('[data-testid="async-state-secondary"]')).toContainText('ready', {
      timeout: 2000,
    });
    await expect(counter).toContainText('queries fired: 2');
  });

  test('data-vv-stale appears on the viewer root during the debounce window', async ({ page }) => {
    const s = await scenario(page);
    await expect(s.locator('[data-testid="async-state-primary"]')).toContainText('ready', {
      timeout: 4000,
    });
    const root = s.locator('[data-testid="gene-glyph"]');
    // Quiet state: no stale attribute.
    await expect(root).not.toHaveAttribute('data-vv-stale', /.*/);
    const fig = s.locator('svg.vv-figure');
    await fig.click({ position: { x: 10, y: 10 } });
    // Fire a pan and immediately assert the stale flag is on.
    await page.keyboard.press('ArrowRight');
    await expect(root).toHaveAttribute('data-vv-stale', '');
  });
});
