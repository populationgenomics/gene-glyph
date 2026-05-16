import { describe, expect, it, beforeEach } from 'vitest';
import { exportSvgString } from './export.js';

/**
 * JSDOM doesn't resolve CSS variables (or CSS transitions) the way Chromium
 * does, so the heavy lifting of Slice 19 is pinned by the Playwright spec
 * `slice-19-export.spec.ts`. These unit tests cover the structural surface
 * that's environment-independent: namespace declarations, <title>/<desc>
 * injection, transient-node removal, and data-* / class stripping.
 */
describe('exportSvgString', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function buildFigure(): SVGSVGElement {
    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('viewBox', '0 0 1000 100');
    svg.setAttribute('class', 'vv-figure');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'TEST (NM_TEST.1) — 99 aa');

    const title = document.createElementNS(svgNs, 'title');
    title.textContent = 'placeholder title';
    svg.appendChild(title);

    const exonGroup = document.createElementNS(svgNs, 'g');
    exonGroup.setAttribute('class', 'vv-exon-group');
    exonGroup.setAttribute('data-vv-exon-idx', '0');
    exonGroup.setAttribute('data-testid', 'exon-0');
    const rect = document.createElementNS(svgNs, 'rect');
    rect.setAttribute('class', 'vv-exon-rect');
    rect.setAttribute('x', '0');
    rect.setAttribute('y', '0');
    rect.setAttribute('width', '50');
    rect.setAttribute('height', '20');
    exonGroup.appendChild(rect);
    svg.appendChild(exonGroup);

    // Transient shimmer: must not survive into the export.
    const shimmer = document.createElementNS(svgNs, 'rect');
    shimmer.setAttribute('class', 'vv-loading-shimmer');
    shimmer.setAttribute('data-vv-track-id', 'variants-a');
    svg.appendChild(shimmer);

    document.body.appendChild(svg);
    return svg as SVGSVGElement;
  }

  it('emits an XML preamble and the SVG namespace', () => {
    const svg = buildFigure();
    const out = exportSvgString({
      svg,
      ariaLabel: 'TEST (NM_TEST.1)',
      description: 'desc',
    });
    expect(out.startsWith('<?xml')).toBe(true);
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('replaces the existing <title> and injects a <desc>', () => {
    const svg = buildFigure();
    const out = exportSvgString({
      svg,
      ariaLabel: 'TEST gene',
      description: 'sample description',
    });
    expect(out).toMatch(/<title>TEST gene<\/title>/);
    expect(out).toMatch(/<desc>sample description<\/desc>/);
    expect(out).not.toContain('placeholder title');
  });

  it('strips loading shimmer, class, and data-* hooks from interior elements', () => {
    const svg = buildFigure();
    const out = exportSvgString({
      svg,
      ariaLabel: 'TEST',
      description: 'desc',
    });
    expect(out).not.toContain('vv-loading-shimmer');
    expect(out).not.toContain('data-vv-exon-idx');
    expect(out).not.toContain('data-vv-track-id');
    expect(out).not.toContain('data-testid');
    // Interior class hooks (e.g. vv-exon-rect) are inlined into attributes and
    // dropped from the export — verify a representative one is gone.
    expect(out).not.toContain('class="vv-exon-rect"');
  });

  it('writes a concrete width/height derived from the viewBox', () => {
    const svg = buildFigure();
    const out = exportSvgString({
      svg,
      ariaLabel: 'TEST',
      description: 'desc',
      args: { width: 2000 },
    });
    expect(out).toMatch(/width="2000"/);
    expect(out).toMatch(/height="200"/);
  });

  it('injects a Google Fonts @import by default and skips it when disabled', () => {
    const svg = buildFigure();
    const withFonts = exportSvgString({
      svg,
      ariaLabel: 'TEST',
      description: 'desc',
    });
    expect(withFonts).toContain('fonts.googleapis.com');
    const svg2 = buildFigure();
    const without = exportSvgString({
      svg: svg2,
      ariaLabel: 'TEST',
      description: 'desc',
      args: { fontImport: 'none' },
    });
    expect(without).not.toContain('fonts.googleapis.com');
  });

  it('keeps role and aria-label on the root for accessibility', () => {
    const svg = buildFigure();
    const out = exportSvgString({
      svg,
      ariaLabel: 'TEST',
      description: 'desc',
    });
    expect(out).toContain('role="img"');
    expect(out).toMatch(/aria-label="TEST \(NM_TEST\.1\) — 99 aa"/);
  });
});
