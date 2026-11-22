import { test, expect, type Locator, type Page } from '@playwright/test';

async function scenario(page: Page): Promise<Locator> {
  await page.goto('/');
  return page.locator('section[aria-labelledby="scenario-transcript-map"]');
}

test.describe('Transcript map — UTR and intronic placement', () => {
  test("draws the exon wholly in the 5' UTR and a variant in it", async ({ page }) => {
    const s = await scenario(page);
    await expect(s.locator('.vv-exon-utr-only')).toHaveCount(1);
    const utrVariant = s.locator('[data-vv-track-id="case"] [data-vv-feature-id="c.-164G>A"]');
    await expect(utrVariant).toBeVisible();
    const exonBox = (await s.locator('.vv-exon-utr-only').boundingBox())!;
    const variantBox = (await utrVariant.locator('.vv-variant-tick').boundingBox())!;
    expect(variantBox.x).toBeGreaterThanOrEqual(exonBox.x);
    expect(variantBox.x).toBeLessThanOrEqual(exonBox.x + exonBox.width);
  });

  test('draws intronic variants on the exon edges, marked toward the intron', async ({ page }) => {
    const s = await scenario(page);
    const donor = s.locator('[data-vv-feature-id="c.441+5G>A"]');
    const acceptor = s.locator('[data-vv-feature-id="c.163-2A>G"]');
    await expect(donor).toHaveAttribute('data-vv-intron-side', 'donor');
    await expect(acceptor).toHaveAttribute('data-vv-intron-side', 'acceptor');
    await expect(donor.locator('.vv-variant-intron-mark')).toHaveCount(1);
  });

  test('hovering an intronic variant names its c. position', async ({ page }) => {
    const s = await scenario(page);
    await s.locator('[data-vv-feature-id="c.441+5G>A"] .vv-variant-dot').hover();
    await expect(s.locator('[data-testid="gene-glyph-tooltip"]')).toContainText(
      'c.441+5G>A (c.441+5)',
    );
  });

  test('lists only off-transcript features as unplaced, under their track names', async ({
    page,
  }) => {
    const s = await scenario(page);
    const caseList = s.locator('[data-testid="case-unplaced"]');
    await expect(caseList.locator('.vv-unplaced-label')).toHaveText('Unplaced in This case (1)');
    await expect(caseList.locator('.vv-unplaced-chip')).toHaveAttribute(
      'data-vv-feature-id',
      'chr17:g.7700000A>G',
    );
    await expect(s.locator('[data-testid="literature-unplaced"] .vv-unplaced-label')).toHaveText(
      'Unplaced in Literature (1)',
    );
    await expect(s.locator('[data-testid="regions-unplaced"]')).toHaveCount(0);
  });

  test('draws a band over the UTR-only exon and marks an intronic band on an exon edge', async ({
    page,
  }) => {
    const s = await scenario(page);
    const regions = s.locator('[data-vv-track-id="regions"]');
    await expect(
      regions.locator('[data-vv-feature-id="del-ex1"] .vv-segment-band-rect'),
    ).toHaveCount(1);
    await expect(regions.locator('[data-vv-feature-id="dup-int3"]')).toHaveAttribute(
      'data-vv-intron-side',
      /donor|acceptor/,
    );
  });
});
