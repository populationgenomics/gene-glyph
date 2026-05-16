import { test, expect } from '@playwright/test';

test.describe('Slice 3 — exon track first render (RD-1062)', () => {
  test('paper-report renders the TP53 schematic with per-exon groups and intron decorations', async ({ page }) => {
    await page.goto('/');
    const figure = page.locator('section[aria-labelledby="scenario-paper-report"] svg.vv-figure');
    await expect(figure).toBeVisible();
    // The TP53 fixture has 10 exons (NM_000546.6 modelled to first-coding-bp).
    // Count the exon track's own rectangles rather than `.vv-exon-group`s —
    // the latter are shared by every track that places content inside an
    // exon (variants, Pfam segments, etc.).
    await expect(figure.locator('rect.vv-exon-rect')).toHaveCount(10);
    // n-1 intron polylines (one per gap). Each lives inside its own
    // `.vv-intron-decoration` `<g>` which carries the `--vv-intron-x-{i}`
    // translate that landed in commit 9fd20c2.
    await expect(figure.locator('polyline.vv-intron-polyline')).toHaveCount(9);
    // The header is wired through the default `<GeneGlyphHeader>` and must
    // surface the gene symbol + transcript ID + MANE badge.
    const header = page.locator('section[aria-labelledby="scenario-paper-report"] [data-testid="gene-glyph-header"]');
    await expect(header).toContainText('TP53');
    await expect(header).toContainText('NM_000546');
    await expect(header).toContainText('MANE Select');
  });
});
