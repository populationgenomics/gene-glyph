import { test, expect, type Locator, type Page } from '@playwright/test';

async function scenario(page: Page): Promise<Locator> {
  await page.goto('/');
  return page.locator('section[aria-labelledby="scenario-export"]');
}

async function exportSvgViaPreview(s: Locator): Promise<string> {
  // The scenario stashes the most-recently-produced SVG into a hidden <pre>
  // so the spec can read it without intercepting the browser download.
  await s.locator('[data-testid="export-preview-svg"]').click();
  await expect(s.locator('[data-testid="export-last-svg-length"]')).toBeVisible();
  return (await s.locator('[data-testid="export-svg-stash"]').textContent()) ?? '';
}

test.describe('Slice 19 — camera-ready export', () => {
  test('exportSVG produces a well-formed standalone document', async ({ page }) => {
    const s = await scenario(page);
    const svg = await exportSvgViaPreview(s);
    expect(svg.length).toBeGreaterThan(200);
    // XML preamble + a single root <svg> with the namespace declaration.
    expect(svg.startsWith('<?xml')).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    // <title>/<desc> for accessibility — design §10 + Inkscape Object
    // Properties panel.
    expect(svg).toMatch(/<title>[^<]*TP53/);
    expect(svg).toMatch(/<desc>[^<]*TP53/);
    // Google Fonts @import injected so the SVG self-renders when opened in a
    // browser.
    expect(svg).toContain('fonts.googleapis.com');
    // None of the transient affordances or hit-test hooks leak.
    expect(svg).not.toContain('vv-loading-shimmer');
    expect(svg).not.toContain('data-testid=');
    expect(svg).not.toContain('data-vv-track-id=');
    // CSS-variable references must have been resolved to concrete values; if
    // any `var()` survives, downstream renderers (Inkscape) will choke.
    expect(svg).not.toContain('var(--');
    // No overlay layer (lives outside the figure SVG; structurally excluded).
    expect(svg).not.toContain('vv-overlay-layer');
  });

  test('print theme is visibly different from the current theme', async ({ page }) => {
    const s = await scenario(page);
    await s.locator('[data-testid="export-theme-select"]').selectOption('current');
    const currentSvg = await exportSvgViaPreview(s);
    await s.locator('[data-testid="export-theme-select"]').selectOption('print');
    const printSvg = await exportSvgViaPreview(s);
    expect(currentSvg).not.toEqual(printSvg);
    // Print theme paints the figure with an explicit white background.
    expect(printSvg).toMatch(/fill="rgb\(255, 255, 255\)"|fill="#fff/i);
  });

  test('exported figure carries concrete transform matrices instead of CSS vars', async ({ page }) => {
    const s = await scenario(page);
    const svg = await exportSvgViaPreview(s);
    // At least one exon group should have a resolved matrix() transform —
    // there is no other way to bake the CSS-variable-driven translate +
    // scale into the serialised file.
    expect(svg).toMatch(/transform="matrix\(/);
  });

  test('exportPNG produces a PNG blob at the requested width', async ({ page }) => {
    const s = await scenario(page);
    // The PNG path is exercised via the byte-counter readout — the scenario
    // surfaces the latest blob size in the DOM so the spec doesn't have to
    // intercept the download itself.
    await s.locator('[data-testid="export-png-width"]').fill('800');
    await s.locator('[data-testid="export-download-png"]').click();
    const counter = s.locator('[data-testid="export-last-png-bytes"]');
    await expect(counter).toBeVisible({ timeout: 5000 });
    const text = await counter.textContent();
    const m = text && /(\d+)/.exec(text);
    expect(m).not.toBeNull();
    const bytes = Number(m![1]);
    expect(bytes).toBeGreaterThan(500);
  });
});
