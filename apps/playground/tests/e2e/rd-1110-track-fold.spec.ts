import { test, expect, type Locator, type Page } from '@playwright/test';

async function liveDataScenario(page: Page): Promise<Locator> {
  await page.goto('/');
  const s = page.locator('section[aria-labelledby="scenario-live-data"]');
  await s.scrollIntoViewIfNeeded();
  return s;
}

async function waitForReady(s: Locator, gene: string): Promise<void> {
  // The live-data scenario fetches gnomAD and reports the ClinVar variant
  // count once the transcript + records arrive.
  await s.locator('[data-testid="live-data-gene-picker"]').selectOption(gene);
  await expect(s.locator('[data-testid="live-data-status"]')).toContainText(
    /ClinVar variants/,
    { timeout: 20_000 },
  );
}

test.describe('RD-1110 — nested ClinVar fold contract', () => {
  test('folded parent shows whole-record summary; unfolding parent reveals per-significance sub-groups', async ({ page }) => {
    const s = await liveDataScenario(page);
    await waitForReady(s, 'BRCA1');

    // Default state: parent folded (and every sub-group also folded).
    const parent = s.locator('[data-testid="gene-glyph-chevron-clinvar-group"]');
    await expect(parent).toHaveAttribute('aria-expanded', 'false');

    // While the parent is folded, *only* the parent-level summary is in
    // the figure — none of the per-significance summaries are mounted
    // because their enclosing group is skipped.
    const parentSummary = s.locator('[data-testid="gene-glyph-track-clinvar-summary"]');
    await expect(parentSummary).toBeAttached();
    await expect(s.locator('[data-testid="gene-glyph-track-clinvar-pathogenic-summary"]')).toHaveCount(0);

    // Unfold the parent. Now the six per-significance sub-group
    // chevrons are reachable and each sub-group is still folded, so
    // their summaries are mounted but their detail stacks are not.
    await parent.click();
    await expect(parent).toHaveAttribute('aria-expanded', 'true');
    const pathogenic = s.locator('[data-testid="gene-glyph-chevron-clinvar-pathogenic"]');
    await expect(pathogenic).toHaveAttribute('aria-expanded', 'false');
    await expect(parentSummary).toHaveCount(0);
    await expect(s.locator('[data-testid="gene-glyph-track-clinvar-pathogenic-summary"]')).toBeAttached();
    await expect(s.locator('[data-vv-track-id="clinvar-pathogenic-detail"]')).toHaveCount(0);
  });

  test('unfolding one sub-group swaps its summary for the stacked detail; others remain folded', async ({ page }) => {
    const s = await liveDataScenario(page);
    await waitForReady(s, 'BRCA1');

    // Expand the parent so the sub-group chevrons are reachable.
    await s.locator('[data-testid="gene-glyph-chevron-clinvar-group"]').click();

    const figure = s.locator('svg.vv-figure');
    const beforeHeight = await figure.evaluate((el) =>
      (el as SVGSVGElement).getBoundingClientRect().height,
    );

    // Unfold just the pathogenic sub-group. Its stacked detail mounts;
    // its summary disappears; the neighbouring (likely_pathogenic /
    // benign / …) sub-groups stay folded with their summaries intact.
    const pathogenic = s.locator('[data-testid="gene-glyph-chevron-clinvar-pathogenic"]');
    await pathogenic.click();
    await expect(pathogenic).toHaveAttribute('aria-expanded', 'true');
    await expect(s.locator('[data-vv-track-id="clinvar-pathogenic-detail"]')).toBeAttached();
    await expect(s.locator('[data-testid="gene-glyph-track-clinvar-pathogenic-summary"]')).toHaveCount(0);
    await expect(s.locator('[data-testid="gene-glyph-track-clinvar-likely_pathogenic-summary"]')).toBeAttached();
    await expect(s.locator('[data-vv-track-id="clinvar-likely_pathogenic-detail"]')).toHaveCount(0);

    const afterHeight = await figure.evaluate((el) =>
      (el as SVGSVGElement).getBoundingClientRect().height,
    );
    expect(afterHeight).toBeGreaterThan(beforeHeight);
  });
});
