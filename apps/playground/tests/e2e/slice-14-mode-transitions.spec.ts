import { test, expect, type Page } from '@playwright/test';

async function scenario(page: Page) {
  await page.goto('/');
  return page.locator('section[aria-labelledby="scenario-slots"]');
}

test.describe('Slice 14 — mode transitions (CDS ↔ spliced ↔ protein)', () => {
  test('switching to transcript collapses --vv-intron-scale to 0', async ({ page }) => {
    const s = await scenario(page);
    const root = s.locator('[data-testid="gene-glyph"]');
    const figure = s.locator('svg.vv-figure');

    await expect(root).toHaveAttribute('data-vv-mode', 'genome');
    const before = await figure.evaluate(
      (el) => (el as SVGSVGElement).style.getPropertyValue('--vv-intron-scale'),
    );
    expect(before).toBe('1');

    await s.locator('select').first().selectOption('transcript');

    // The data attribute flips immediately; CSS handles the visual fade.
    await expect(root).toHaveAttribute('data-vv-mode', 'transcript');
    const after = await figure.evaluate(
      (el) => (el as SVGSVGElement).style.getPropertyValue('--vv-intron-scale'),
    );
    expect(after).toBe('0');
  });

  test('switching to protein retargets the per-exon-x CSS variables', async ({ page }) => {
    const s = await scenario(page);
    const figure = s.locator('svg.vv-figure');

    // CDS-with-introns: exon 0 starts at x=0, exon 1 is offset by the gap.
    const exon0Before = await figure.evaluate(
      (el) => (el as SVGSVGElement).style.getPropertyValue('--vv-exon-x-0'),
    );
    expect(exon0Before).toBe('0px');

    await s.locator('select').first().selectOption('protein');

    // Protein mode still anchors exon 0 at x=0 (aa=1 → x=0); per-exon-x for
    // later exons shifts because exon boundaries land on shared aa positions
    // (no inter-exon gap in protein mode).
    const exon0After = await figure.evaluate(
      (el) => (el as SVGSVGElement).style.getPropertyValue('--vv-exon-x-0'),
    );
    expect(exon0After).toBe('0px');
    const intron0After = await figure.evaluate(
      (el) => (el as SVGSVGElement).style.getPropertyValue('--vv-intron-scale-x-0'),
    );
    expect(intron0After).toBe('0');
  });

  test('mode switch never adds .vv-mode-transitioning or a transition-duration (Slice 33 retired the animation)', async ({ page }) => {
    const s = await scenario(page);
    const root = s.locator('[data-testid="gene-glyph"]');

    await s.locator('select').first().selectOption('transcript');
    await expect(root).not.toHaveClass(/vv-mode-transitioning/);

    const exonGroup = s.locator('.vv-exon-group').first();
    const dur = await exonGroup.evaluate(
      (el) => getComputedStyle(el).transitionDuration,
    );
    // No transition on the exon group anymore — computed value is "0s".
    expect(dur).toBe('0s');
  });
});
