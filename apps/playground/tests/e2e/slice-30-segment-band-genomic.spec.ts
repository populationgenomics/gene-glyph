import { test, expect, type Locator, type Page } from '@playwright/test';

async function scenario(page: Page): Promise<Locator> {
  await page.goto('/');
  return page.locator('section[aria-labelledby="scenario-segment-band"]');
}

test.describe('Slice 30 — segment band track in genomic coordinates', () => {
  for (const mode of ['protein', 'transcript', 'genome'] as const) {
    test(`a deletion of exons 5–7 draws one piece per deleted exon in ${mode} mode`, async ({
      page,
    }) => {
      const s = await scenario(page);
      await s.locator('[data-testid="segment-band-mode"]').selectOption(mode);
      const strip = s.locator('[data-vv-track-id="genomic-region"]');
      const pieces = strip.locator('.vv-segment-band-rect');
      await expect(pieces).toHaveCount(3);
      const exonIdxs = await strip
        .locator('[data-vv-exon-idx]')
        .evaluateAll((els) => els.map((el) => el.getAttribute('data-vv-exon-idx')));
      // TP53 exons 5, 6, 7 are the 4th–6th coding exons (exon 1 is non-coding).
      expect(exonIdxs.sort()).toEqual(['3', '4', '5']);
      await expect(s.locator('[data-testid="genomic-region-unplaced"]')).toHaveCount(0);
    });
  }

  test('hovering the deletion shows its label and genomic span', async ({ page }) => {
    const s = await scenario(page);
    await s.locator('[data-testid="segment-band-mode"]').selectOption('transcript');
    const piece = s.locator('[data-vv-track-id="genomic-region"] [data-vv-feature-id="del-ex5-7"]');
    await piece.first().hover();
    const tip = s.locator('[data-testid="gene-glyph-tooltip"]');
    await expect(tip).toBeVisible();
    await expect(tip).toContainText('Exons 5–7 deleted (chr17:7673100–7674000)');
  });
});
