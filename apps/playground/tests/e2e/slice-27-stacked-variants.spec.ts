import { test, expect, type Locator, type Page } from '@playwright/test';

async function scenario(page: Page): Promise<Locator> {
  await page.goto('/');
  const s = page.locator('section[aria-labelledby="scenario-stacked-variants"]');
  await s.scrollIntoViewIfNeeded();
  return s;
}

test.describe('Slice 27 — stacked variant view', () => {
  test('side-by-side renders the same data in both styles', async ({ page }) => {
    const s = await scenario(page);
    const classic = s.locator('[data-testid="stacked-side-classic"]');
    const stacked = s.locator('[data-testid="stacked-side-stacked"]');
    await expect(classic.locator('.vv-variant').first()).toBeAttached();
    await expect(stacked.locator('.vv-variant-stacked').first()).toBeAttached();
    // Stacked-side variant count equals classic-side placed count — every
    // dense fixture entry projects onto an exon at fit-gene.
    const classicCount = await classic.locator('.vv-variant').count();
    const stackedCount = await stacked.locator('.vv-variant-stacked').count();
    expect(stackedCount).toBe(classicCount);
    expect(stackedCount).toBeGreaterThan(50);
  });

  test('stacked render assigns multiple rows at hotspot positions', async ({ page }) => {
    const s = await scenario(page);
    const trackEl = s.locator(
      '[data-testid="stacked-side-stacked"] .vv-variant-track-stacked',
    );
    await expect(trackEl).toBeAttached();
    const rows = Number(await trackEl.getAttribute('data-vv-stack-rows'));
    // The hotspot piles around codon 248 (20 variants in one column) force
    // at least 4 rows even when lane separation is honoured.
    expect(rows).toBeGreaterThanOrEqual(4);
  });

  test('clicking a stacked glyph fires onFeatureClick', async ({ page }) => {
    const s = await scenario(page);
    const glyph = s.locator('[data-testid="stacked-side-stacked"] .vv-variant-stacked').first();
    const id = await glyph.getAttribute('data-vv-feature-id');
    expect(id).toBeTruthy();
    await glyph.click();
    await expect(s.locator('[data-testid="stacked-last-clicked"] strong')).toHaveText(id!);
  });

  test('clinVar stacked render suppresses density clustering', async ({ page }) => {
    const s = await scenario(page);
    // The ClinVar-stacked figure is the third <GeneGlyph> in the scenario;
    // it owns the only `.vv-clinvar-track-stacked` node.
    const stacked = s.locator('.vv-clinvar-track-stacked');
    await expect(stacked).toBeAttached();
    const glyphs = stacked.locator('.vv-clinvar-mark-stacked');
    // Whatever the placeable-record count, none should collapse into a
    // cluster diamond in stacked mode — that's the defining property.
    const glyphCount = await glyphs.count();
    expect(glyphCount).toBeGreaterThan(0);
    const clusters = stacked.locator('.vv-clinvar-mark.is-cluster');
    await expect(clusters).toHaveCount(0);
  });
});
