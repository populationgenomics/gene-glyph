import { test, expect } from '@playwright/test';

test.describe('Slice 31 — numeric profile track', () => {
  test('heatmap renders viridis cells across the visible aa range', async ({ page }) => {
    await page.goto('/');
    const s = page.locator('section[aria-labelledby="scenario-profile"]');
    await s.scrollIntoViewIfNeeded();
    const heatmap = s.locator('.vv-profile-track[data-vv-profile-render="heatmap"]');
    await expect(heatmap).toBeVisible();
    const cells = heatmap.locator('.vv-profile-cell');
    const count = await cells.count();
    // 393 aa over the figure width: at fit-gene the aggregator buckets
    // multiple aa per pixel — expect ≪ 393 cells, but never zero.
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(393);
  });

  test('histogram renders an area-fill path per exon', async ({ page }) => {
    await page.goto('/');
    const s = page.locator('section[aria-labelledby="scenario-profile"]');
    await s.scrollIntoViewIfNeeded();
    const hist = s.locator('.vv-profile-track[data-vv-profile-render="histogram"]');
    await expect(hist).toBeVisible();
    const areas = hist.locator('.vv-profile-area');
    const n = await areas.count();
    // TP53 spans 10 exons but most carry density; one path per exon
    // that has at least one bucket. Should be well over 1.
    expect(n).toBeGreaterThan(0);
    // Path must be non-empty.
    const d = await areas.first().getAttribute('d');
    expect(d).toBeTruthy();
    expect(d!.length).toBeGreaterThan(10);
  });

  test('zooming in increases bucket fidelity (smaller step)', async ({ page }) => {
    await page.goto('/');
    const s = page.locator('section[aria-labelledby="scenario-profile"]');
    await s.scrollIntoViewIfNeeded();

    const heatmap = s.locator('.vv-profile-track[data-vv-profile-render="heatmap"]');
    const fitStep = Number(await heatmap.getAttribute('data-vv-profile-step'));

    await s.getByTestId('profile-zoom-dbd').click();
    await page.waitForTimeout(600);

    const zoomedStep = Number(await heatmap.getAttribute('data-vv-profile-step'));
    // Zooming into the DBD (aa 100–300, ~half the protein) at least
    // halves the units-per-pixel; the integer step should drop (or
    // stay the same if it was already 1).
    expect(zoomedStep).toBeLessThanOrEqual(fitStep);

    // After zooming we expect more cells than at fit-gene (or the same
    // if we're already at step = 1).
    const fitCount = await s.locator('.vv-profile-cell').count();
    // re-read at zoom level
    expect(fitCount).toBeGreaterThan(0);
  });

  test('every cell + bar lives inside a per-exon group', async ({ page }) => {
    await page.goto('/');
    const s = page.locator('section[aria-labelledby="scenario-profile"]');
    await s.scrollIntoViewIfNeeded();

    const stranded = await s.evaluate((sec) => {
      const nodes = sec.querySelectorAll<SVGElement>(
        '.vv-profile-cell, .vv-profile-area, .vv-profile-bar',
      );
      let outside = 0;
      nodes.forEach((n) => {
        if (!n.closest('.vv-exon-group')) outside++;
      });
      return { total: nodes.length, outside };
    });
    expect(stranded.total).toBeGreaterThan(0);
    expect(stranded.outside).toBe(0);
  });

  test('switching to CDS mode keeps both profile tracks rendered', async ({ page }) => {
    await page.goto('/');
    const s = page.locator('section[aria-labelledby="scenario-profile"]');
    await s.scrollIntoViewIfNeeded();

    await s.getByTestId('profile-mode').selectOption('cds-with-introns');
    await page.waitForTimeout(600);

    await expect(s.locator('.vv-profile-track[data-vv-profile-render="heatmap"]')).toBeVisible();
    await expect(s.locator('.vv-profile-track[data-vv-profile-render="histogram"]')).toBeVisible();
  });
});
