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
    // means we have more InterPro lines than there are unique entry types.
    // Slice 26 follow-up moved InterPro's default render style to 'minimal'
    // (line + end-cap ticks) so Pfam stays the prominent annotation.
    const lineCount = await figure.locator('.vv-interpro-line').count();
    expect(lineCount).toBeGreaterThan(2);
  });

  test('multi-level gutter shows the group label plus per-sub-track entry-type labels', async ({ page }) => {
    await page.goto('/');
    const scenario = page.locator('section[aria-labelledby="scenario-interpro"]');
    const gutter = scenario.locator('[data-testid="gene-glyph-left-gutter"]');
    await expect(gutter).toBeVisible();
    // One row for the InterPro group, plus one row per non-empty entry-type
    // sub-track. The demo skips tracks without a `label` (the exon track)
    // so we only see the InterPro nesting in the gutter rows that carry
    // visible text.
    await expect(gutter.locator('.vv-gutter-group')).toHaveCount(1);
    const groupText = (await gutter.locator('.vv-gutter-group').first().textContent())?.trim();
    expect(groupText).toBe('InterPro');
    // At least one entry-type label should appear in a track-kind row.
    const trackRows = gutter.locator('.vv-gutter-track');
    const trackTexts = await trackRows.allTextContents();
    const nonEmpty = trackTexts.map((s) => s.trim()).filter((s) => s.length > 0);
    expect(nonEmpty.length).toBeGreaterThan(0);
    // Common entry-type labels (`ENTRY_TYPE_LABEL`): one of these should
    // appear among the visible sub-track rows.
    expect(nonEmpty.some((s) => /Family|Domain|Repeat|Homologous/.test(s))).toBe(true);
  });
});
