import { test, expect, type Page } from '@playwright/test';

async function scenario(page: Page) {
  await page.goto('/');
  return page.locator('section[aria-labelledby="scenario-slots"]');
}

test.describe('Slice 14 — mode transitions (CDS ↔ spliced ↔ protein)', () => {
  test('switching to cds-spliced collapses --vv-intron-scale to 0', async ({ page }) => {
    const s = await scenario(page);
    const root = s.locator('[data-testid="gene-glyph"]');
    const figure = s.locator('svg.vv-figure');

    await expect(root).toHaveAttribute('data-vv-mode', 'cds-with-introns');
    const before = await figure.evaluate(
      (el) => (el as SVGSVGElement).style.getPropertyValue('--vv-intron-scale'),
    );
    expect(before).toBe('1');

    await s.locator('select').first().selectOption('cds-spliced');

    // The data attribute flips immediately; CSS handles the visual fade.
    await expect(root).toHaveAttribute('data-vv-mode', 'cds-spliced');
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

  test('.vv-mode-transitioning carries the 450ms ease-in-out-quart curve', async ({ page }) => {
    const s = await scenario(page);
    const root = s.locator('[data-testid="gene-glyph"]');

    await s.locator('select').first().selectOption('cds-spliced');
    await expect(root).toHaveClass(/vv-mode-transitioning/);

    const exonGroup = s.locator('.vv-exon-group').first();
    const dur = await exonGroup.evaluate(
      (el) => getComputedStyle(el).transitionDuration,
    );
    // computed transition-duration may report the longest of stacked
    // transitions; 450ms shows up as "0.45s" first in the list.
    expect(dur.startsWith('0.45s')).toBe(true);

    // After ~500ms the class clears and the duration drops back to the
    // pan/zoom 350ms curve.
    await page.waitForTimeout(550);
    await expect(root).not.toHaveClass(/vv-mode-transitioning/);
    const durAfter = await exonGroup.evaluate(
      (el) => getComputedStyle(el).transitionDuration,
    );
    expect(durAfter.startsWith('0.35s')).toBe(true);
  });
});
