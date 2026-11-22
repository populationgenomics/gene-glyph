import { test, expect, type Locator, type Page } from '@playwright/test';

async function scenario(page: Page): Promise<Locator> {
  await page.goto('/');
  return page.locator('section[aria-labelledby="scenario-transcript-map"]');
}

test.describe('Transcript map — per-feature clickability', () => {
  test('a clickable variant shows the pointer and activates on Enter and Space', async ({
    page,
  }) => {
    const s = await scenario(page);
    const variant = s.locator('[data-vv-track-id="literature"] [data-vv-feature-id="c.524G>A"]');
    await expect(variant).toHaveAttribute('role', 'button');
    await expect(variant).toHaveCSS('cursor', 'pointer');
    const clicked = s.locator('[data-testid="transcript-map-clicked"]');
    await variant.focus();
    await page.keyboard.press('Enter');
    await expect(clicked).toHaveText('Clicked: c.524G>A');
    const chip = s.locator('[data-testid="literature-unplaced"] .vv-unplaced-chip');
    await chip.focus();
    await page.keyboard.press(' ');
    await expect(clicked).toHaveText('Clicked: chr1:g.1000A>G');
  });

  test('a variant the host does not let be clicked is hoverable but not a button', async ({
    page,
  }) => {
    const s = await scenario(page);
    const variant = s.locator('[data-vv-track-id="case"] [data-vv-feature-id="c.*50T>C"]');
    await expect(variant).not.toHaveAttribute('role', 'button');
    await expect(variant).not.toHaveAttribute('tabindex', /.*/);
    await variant.locator('.vv-variant-dot').hover();
    await expect(s.locator('[data-testid="gene-glyph-tooltip"]')).toHaveText('c.*50T>C');
    await expect(s.locator('.vv-figure')).not.toHaveCSS('cursor', 'pointer');
    await variant.locator('.vv-variant-dot').click();
    await expect(s.locator('[data-testid="transcript-map-clicked"]')).toHaveText(
      'Clicked: nothing',
    );
  });
});
