import { test, expect, type Locator, type Page } from '@playwright/test';

async function getFirstVariantRow(page: Page): Promise<Locator> {
  const row = page
    .locator('section[aria-labelledby="scenario-paper-report"] table tbody tr')
    .first();
  await expect(row).toBeVisible();
  return row;
}

async function getFigure(page: Page): Promise<Locator> {
  const figure = page.locator(
    'section[aria-labelledby="scenario-paper-report"] svg.vv-figure',
  );
  await expect(figure).toBeVisible();
  return figure;
}

test.describe('Slice 12 — CSS-driven hover lift + selection feedback', () => {
  test('hover lift is a CSS transform on .vv-variant-inner, not an SVG attribute', async ({
    page,
  }) => {
    await page.goto('/');
    const figure = await getFigure(page);
    const row = await getFirstVariantRow(page);

    await row.hover();
    const hovered = figure.locator('.vv-variant.is-hovered');
    await expect(hovered).toHaveCount(1);

    // Wait for the 120ms transition to finish.
    await page.waitForTimeout(180);

    const inner = hovered.locator('.vv-variant-inner');
    const transform = await inner.evaluate((el) => getComputedStyle(el).transform);
    // Identity is `none` or `matrix(1, 0, 0, 1, 0, 0)`. A lift is a translateY
    // of `--vv-variant-hover-lift-px` (4px) up the y-axis, which appears in the
    // matrix's `f` component (last) as a negative number.
    expect(transform).not.toBe('none');
    const match = /matrix\(([^)]+)\)/.exec(transform);
    expect(match, `expected a matrix transform, got: ${transform}`).not.toBeNull();
    const parts = match![1].split(',').map((s) => parseFloat(s.trim()));
    expect(parts[5]).toBeLessThan(-1);
  });

  test('selection ring uses CSS opacity, transitioning from 0 to 1', async ({ page }) => {
    await page.goto('/');
    const figure = await getFigure(page);
    const row = await getFirstVariantRow(page);

    // Move the pointer away first so the hovered state doesn't bleed into the
    // ring's focus-visible 0.6 fallback.
    await page.mouse.move(0, 0);
    const firstVariant = figure.locator('.vv-variant').first();
    const ring = firstVariant.locator('.vv-variant-ring');
    const initialOpacity = await ring.evaluate((el) => getComputedStyle(el).opacity);
    expect(parseFloat(initialOpacity)).toBeLessThan(0.5);

    await row.click();
    await page.waitForTimeout(160);
    const selected = figure.locator('.vv-variant.is-selected');
    await expect(selected).toHaveCount(1);
    const selectedRing = selected.locator('.vv-variant-ring');
    const selectedOpacity = await selectedRing.evaluate((el) => getComputedStyle(el).opacity);
    expect(parseFloat(selectedOpacity)).toBeCloseTo(1, 2);
  });

  test('prefers-reduced-motion @media rule zeroes transitions on animated nodes', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const figure = await getFigure(page);

    const inner = figure.locator('.vv-variant-inner').first();
    const ring = figure.locator('.vv-variant-ring').first();
    const innerDur = await inner.evaluate((el) =>
      getComputedStyle(el).transitionDuration,
    );
    const ringDur = await ring.evaluate((el) =>
      getComputedStyle(el).transitionDuration,
    );
    // `transition: none` expands to `all 0s ease 0s` in computed style.
    expect(innerDur).toBe('0s');
    expect(ringDur).toBe('0s');

    const exonGroup = figure.locator('.vv-exon-group').first();
    const exonDur = await exonGroup.evaluate((el) =>
      getComputedStyle(el).transitionDuration,
    );
    expect(exonDur).toBe('0s');
  });

  test('playground reduced-motion toggle mirrors the @media rule', async ({ page }) => {
    await page.goto('/');
    const figure = await getFigure(page);
    const inner = figure.locator('.vv-variant-inner').first();

    // Baseline: 120ms transition is in effect.
    const before = await inner.evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(before).toBe('0.12s');

    await page.getByTestId('reduce-motion-toggle').check();
    const after = await inner.evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(after).toBe('0s');

    await page.getByTestId('reduce-motion-toggle').uncheck();
    const restored = await inner.evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(restored).toBe('0.12s');
  });
});
