import { test, expect, type Locator, type Page } from '@playwright/test';

async function scenario(page: Page): Promise<Locator> {
  await page.goto('/');
  return page.locator('section[aria-labelledby="scenario-transcript-map"]');
}

test.describe('Transcript map — overlapping bands', () => {
  test('overlapping regions draw in separate rows, each hoverable', async ({ page }) => {
    const s = await scenario(page);
    const regions = s.locator('[data-vv-track-id="regions"]');
    const del = regions.locator('[data-vv-feature-id="del-ex5-6"] .vv-segment-band-rect').first();
    const dup = regions.locator('[data-vv-feature-id="dup-ex6"] .vv-segment-band-rect').first();
    const delBox = (await del.boundingBox())!;
    const dupBox = (await dup.boundingBox())!;
    expect(Math.abs(dupBox.y - delBox.y)).toBeGreaterThanOrEqual(delBox.height);
    await dup.hover();
    await expect(s.locator('[data-testid="gene-glyph-tooltip"]')).toContainText(
      'Exon 6 duplication',
    );
  });
});
