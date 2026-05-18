import { test, expect } from '@playwright/test';

test.describe('Slice 29 — nucleotide + aa sequence tracks', () => {
  test('both tracks contribute zero height at fit-gene zoom', async ({ page }) => {
    await page.goto('/');
    const s = page.locator('section[aria-labelledby="scenario-sequence"]');
    await s.scrollIntoViewIfNeeded();
    // No letters rendered before the user zooms in.
    await expect(s.locator('.vv-nt-letter')).toHaveCount(0);
    await expect(s.locator('.vv-aa-letter')).toHaveCount(0);
  });

  test('zooming to a hotspot codon unfurls both tracks with correct residues', async ({ page }) => {
    await page.goto('/');
    const s = page.locator('section[aria-labelledby="scenario-sequence"]');
    await s.scrollIntoViewIfNeeded();

    await s.getByTestId('zoom-codon-175').click();
    // Mode transition uses a CSS curve — let it settle.
    await page.waitForTimeout(600);

    // Letters appear inside the section.
    const ntLetters = s.locator('.vv-nt-letter');
    const aaLetters = s.locator('.vv-aa-letter');
    await expect(ntLetters.first()).toBeVisible();
    await expect(aaLetters.first()).toBeVisible();

    // The R175 letter should be present in the visible aa track.
    const aa175 = s.locator('.vv-aa-letter[data-vv-aa-pos="175"]');
    await expect(aa175).toHaveText('R');

    // The three bp of codon 175 are 523, 524, 525 — they should all
    // be rendered and spell an arginine codon (TP53 R175 is CGC in
    // NM_000546.6).
    const ntPositions = await ntLetters.evaluateAll((els) =>
      els.map((el) => ({
        pos: Number(el.getAttribute('data-vv-cds-pos')),
        letter: el.textContent,
      })),
    );
    const codonBps = [523, 524, 525];
    const codon = codonBps.map((bp) => {
      const hit = ntPositions.find((p) => p.pos === bp);
      return hit?.letter ?? '?';
    });
    expect(codon.join('')).toBe('CGC');
  });

  test('every rendered letter lives inside a per-exon group', async ({ page }) => {
    await page.goto('/');
    const s = page.locator('section[aria-labelledby="scenario-sequence"]');
    await s.scrollIntoViewIfNeeded();

    await s.getByTestId('zoom-codon-248').click();
    await page.waitForTimeout(600);

    const stranded = await s.evaluate((sec) => {
      const letters = sec.querySelectorAll<SVGElement>('.vv-nt-letter, .vv-aa-letter');
      let outside = 0;
      letters.forEach((l) => {
        if (!l.closest('.vv-exon-group')) outside++;
      });
      return { total: letters.length, outside };
    });
    expect(stranded.total).toBeGreaterThan(0);
    expect(stranded.outside).toBe(0);
  });

  test('protein mode hides the nucleotide track but keeps the aa track', async ({ page }) => {
    await page.goto('/');
    const s = page.locator('section[aria-labelledby="scenario-sequence"]');
    await s.scrollIntoViewIfNeeded();

    await s.getByTestId('sequence-mode').selectOption('protein');
    await page.waitForTimeout(500);
    await s.getByTestId('zoom-codon-273').click();
    await page.waitForTimeout(600);

    // Nucleotide track collapses entirely in protein mode regardless
    // of zoom — DoD asserts this.
    await expect(s.locator('.vv-nt-letter')).toHaveCount(0);

    // AA letters still appear; R273 should be visible.
    const aa273 = s.locator('.vv-aa-letter[data-vv-aa-pos="273"]');
    await expect(aa273).toHaveText('R');
  });

  test('clicking Fit gene re-collapses the sequence rows', async ({ page }) => {
    await page.goto('/');
    const s = page.locator('section[aria-labelledby="scenario-sequence"]');
    await s.scrollIntoViewIfNeeded();

    await s.getByTestId('zoom-codon-175').click();
    await page.waitForTimeout(600);
    await expect(s.locator('.vv-aa-letter').first()).toBeVisible();

    await s.getByTestId('fit-gene').click();
    await page.waitForTimeout(600);

    await expect(s.locator('.vv-nt-letter')).toHaveCount(0);
    await expect(s.locator('.vv-aa-letter')).toHaveCount(0);
  });
});
