import { test, expect, type Locator, type Page } from '@playwright/test';

async function scenario(page: Page): Promise<Locator> {
  await page.goto('/');
  return page.locator('section[aria-labelledby="scenario-tooltips"]');
}

async function installTooltipMutationCounter(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as {
      __ggTooltipAdds?: number;
      __ggTooltipRemoves?: number;
      __ggObserver?: MutationObserver;
    };
    w.__ggTooltipAdds = 0;
    w.__ggTooltipRemoves = 0;
    const layer = document.querySelector('[data-testid="gene-glyph-overlay-layer"]');
    if (!layer) throw new Error('overlay layer not mounted yet');
    if (w.__ggObserver) w.__ggObserver.disconnect();
    w.__ggObserver = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of Array.from(m.addedNodes)) {
          if (n instanceof Element && n.matches('[data-testid="gene-glyph-tooltip"]')) {
            w.__ggTooltipAdds = (w.__ggTooltipAdds ?? 0) + 1;
          }
        }
        for (const n of Array.from(m.removedNodes)) {
          if (n instanceof Element && n.matches('[data-testid="gene-glyph-tooltip"]')) {
            w.__ggTooltipRemoves = (w.__ggTooltipRemoves ?? 0) + 1;
          }
        }
      }
    });
    w.__ggObserver.observe(layer, { childList: true, subtree: true });
  });
}

async function readMutations(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as {
      __ggTooltipAdds?: number;
      __ggTooltipRemoves?: number;
    };
    return { adds: w.__ggTooltipAdds ?? 0, removes: w.__ggTooltipRemoves ?? 0 };
  });
}

test.describe('RD-1109 — hover debouncing on variants', () => {
  test('gliding between adjacent variants does not remount the tooltip', async ({ page }) => {
    const s = await scenario(page);
    await expect(s.locator('svg.vv-figure')).toBeVisible();

    const variants = s.locator('.vv-variant');
    const count = await variants.count();
    expect(count).toBeGreaterThanOrEqual(2);

    const a = variants.nth(0);
    const b = variants.nth(1);

    // Park on the first variant via Playwright's .hover() so the tooltip
    // mounts before we start instrumenting mutations.
    await a.hover();
    const tip = s.locator('[data-testid="gene-glyph-tooltip"]');
    await expect(tip).toBeVisible();

    // Install the mutation counter AFTER the tooltip is mounted. From here
    // on, any unmount/remount of the tooltip during the glide is a flicker.
    await installTooltipMutationCounter(page);

    // Glide back-and-forth across the two variants several times. Each pass
    // crosses the 1–2 px empty SVG gap between glyphs that used to unmount
    // and re-mount the tooltip on every pointermove tick.
    for (let i = 0; i < 4; i++) {
      await b.hover();
      await a.hover();
    }

    const { adds, removes } = await readMutations(page);
    expect(removes).toBe(0);
    expect(adds).toBe(0);
    await expect(tip).toBeVisible();
  });

  test('pointer-leaving the figure dismisses the tooltip immediately', async ({ page }) => {
    const s = await scenario(page);
    const variants = s.locator('.vv-variant');
    await expect(variants.first()).toBeVisible();
    await variants.first().hover();
    const tip = s.locator('[data-testid="gene-glyph-tooltip"]');
    await expect(tip).toBeVisible();
    // A confident pointer leave (off the figure entirely) bypasses the exit
    // grace and tears the tooltip down without delay.
    await page.mouse.move(0, 0);
    await expect(tip).toHaveCount(0);
  });
});
