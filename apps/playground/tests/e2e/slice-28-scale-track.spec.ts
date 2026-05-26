import { test, expect } from '@playwright/test';

test.describe('Slice 28 — coordinate ruler track', () => {
  test('ruler renders above the exon ribbon with bp labels at fit-gene', async ({ page }) => {
    await page.goto('/');
    const s = page.locator('section[aria-labelledby="scenario-slots"]');
    await s.scrollIntoViewIfNeeded();
    const scale = s.locator('.vv-scale-track');
    await expect(scale).toBeVisible();
    await expect(scale).toHaveAttribute('data-vv-scale-unit', 'bp');
    // TP53 CDS = 1182 bp; auto-step picks 50, and intronic flank ticks
    // add a few per exon edge. Crash-aware skipping drops labels that
    // would overlap. Bounds are loose because the assertion is "majors
    // render across the gene", not a precise count.
    const majors = scale.locator('.vv-scale-tick-major');
    const count = await majors.count();
    expect(count).toBeGreaterThanOrEqual(10);
    expect(count).toBeLessThanOrEqual(35);
    // Last label carries the unit suffix.
    const labels = scale.locator('.vv-scale-label');
    const texts = await labels.allTextContents();
    expect(texts.some((t) => /\bbp$/.test(t))).toBe(true);
  });

  test('switching to protein mode flips bp labels to aa', async ({ page }) => {
    await page.goto('/');
    const s = page.locator('section[aria-labelledby="scenario-slots"]');
    await s.scrollIntoViewIfNeeded();
    const select = s.locator('select').first();
    await select.selectOption('protein');
    // Give the mode transition a beat to settle.
    await page.waitForTimeout(500);
    const scale = s.locator('.vv-scale-track');
    await expect(scale).toHaveAttribute('data-vv-scale-unit', 'aa');
    const labels = scale.locator('.vv-scale-label');
    const texts = await labels.allTextContents();
    expect(texts.some((t) => /\baa$/.test(t))).toBe(true);
    expect(texts.every((t) => !/\bbp$/.test(t))).toBe(true);
  });

  test('ticks ride per-exon transforms (live under pan/zoom)', async ({ page }) => {
    await page.goto('/');
    const s = page.locator('section[aria-labelledby="scenario-slots"]');
    await s.scrollIntoViewIfNeeded();
    // Every tick should live inside a per-exon `<g>` so the CSS-
    // variable transform machinery moves it with the exon underneath.
    const stranded = await s.evaluate((sec) => {
      const ticks = sec.querySelectorAll<SVGElement>('.vv-scale-tick');
      let outside = 0;
      ticks.forEach((t) => {
        if (!t.closest('.vv-exon-group')) outside++;
      });
      return { total: ticks.length, outside };
    });
    expect(stranded.total).toBeGreaterThan(0);
    expect(stranded.outside).toBe(0);
  });
});
