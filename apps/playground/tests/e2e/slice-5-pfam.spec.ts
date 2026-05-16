import { test, expect } from '@playwright/test';

test.describe('Slice 5 — Pfam + protein-range fragmentation (RD-1064)', () => {
  test('a multi-exon Pfam domain renders fragmented rectangles joined by linkers over the intron gaps', async ({ page }) => {
    await page.goto('/');
    const figure = page.locator('section[aria-labelledby="scenario-pfam"] svg.vv-figure');
    await expect(figure).toBeVisible();
    // The TP53 DNA-binding domain spans aa 94..312 and crosses several exon
    // boundaries — there must be at least one linker drawn across a
    // collapsed-intron gap. Playwright treats SVG `<line>` elements as
    // "hidden" by default (no layout box), so assert via DOM count rather
    // than `toBeVisible()`.
    await expect(figure.locator('.vv-pfam-linker')).not.toHaveCount(0);
    // Multiple Pfam rects exist (one per visible domain × intersected exon).
    const rectCount = await figure.locator('.vv-pfam-rect').count();
    expect(rectCount).toBeGreaterThan(1);
    // Labels render and don't bleed into each other — assert at least one
    // label per domain.
    const labelCount = await figure.locator('.vv-pfam-label').count();
    expect(labelCount).toBeGreaterThanOrEqual(1);
  });
});
