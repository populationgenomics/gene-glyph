import { test, expect } from '@playwright/test';

test.describe('Slice 6 — InterPro + groups + LeftGutter (RD-1066)', () => {
  test('InterPro group label surfaces via the LeftGutter render-prop', async ({ page }) => {
    await page.goto('/');
    const scenario = page.locator('section[aria-labelledby="scenario-interpro"]');
    const gutter = scenario.locator('[data-testid="gene-glyph-left-gutter"]');
    await expect(gutter).toBeVisible();
    // The group label is rendered for the InterPro `TrackGroup`. Its text is
    // owned by the gene-glyph package; assert there's at least one non-empty
    // entry in the gutter coming from a group-kind row.
    const groupRows = gutter.locator('.vv-gutter-group');
    await expect(groupRows).not.toHaveCount(0);
    const text = (await groupRows.first().textContent())?.trim() ?? '';
    expect(text.length).toBeGreaterThan(0);
  });

  test('overlapping InterPro family entries lane-pack into multiple rows', async ({ page }) => {
    await page.goto('/');
    const figure = page.locator('section[aria-labelledby="scenario-interpro"] svg.vv-figure');
    await expect(figure).toBeVisible();
    // Two TP53 family entries (TAD + TAD2) overlap and should stack — this
    // means we have more InterPro rects than there are unique entry types.
    const rectCount = await figure.locator('.vv-interpro-rect').count();
    expect(rectCount).toBeGreaterThan(2);
  });
});
