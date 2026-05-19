/**
 * Slice 19 — camera-ready SVG/PNG export.
 *
 * `exportSVG` builds a portable, self-contained SVG string from the live
 * figure DOM: CSS-variable-driven transforms collapse to concrete
 * `transform="matrix(...)"` attributes, theme colours resolve to hex, and
 * transient affordances (loading shimmer, cursor styles, data-* hit-test
 * hooks) are stripped. The result opens cleanly in Inkscape / Illustrator
 * without any of gene-glyph's stylesheet attached.
 *
 * The work happens on a clone mounted in an offscreen wrapper styled with the
 * host's `.gene-glyph` class (and optionally `data-vv-print=""` for the
 * print theme). Mounting the clone lets `getComputedStyle` resolve the active
 * cascade against the requested theme — without touching the live figure or
 * triggering a paint flash for the user.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const GOOGLE_FONTS_IMPORT =
  "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');";

/** Public arg shape from design §10. `truncation` is plumbed for symmetry
 *  with the design doc but is a no-op today — every currently-shipped track
 *  reports `didTruncate: false`, so `expand` and `as-shown` produce the same
 *  layout. The branch lights up when a truncating track lands. */
export interface ExportArgs {
  /** `'current'` resolves CSS vars to the values active in the host page;
   *  `'print'` resolves them against the dedicated print palette. Default
   *  `'print'`. */
  theme?: 'current' | 'print';
  /** Reserved for tracks that truncate to fit a height budget. Default
   *  `'as-shown'` (mirror the screen view). `'expand'` will rerun layout
   *  without truncation once a truncating track ships. */
  truncation?: 'as-shown' | 'expand';
  /** Pixel width of the exported SVG `<svg width="…">`. Defaults to the
   *  figure's viewBox width — Inkscape opens at logical units regardless. */
  width?: number;
  /** Accessibility label written into `<title>`. Defaults to the same string
   *  the live SVG carries on `aria-label`. */
  ariaLabel?: string;
  /** Embedded font handling. `'google'` injects a `@import` so the SVG self-
   *  renders Inter when opened in a browser; `'none'` skips it (the figure
   *  falls back to the platform font stack). Default `'google'`. */
  fontImport?: 'google' | 'none';
  /** Optional human-readable description for `<desc>`. Defaults to a short
   *  string built from the transcript metadata. */
  description?: string;
}

export interface PrepareExportInput {
  /** The live figure SVG to clone. */
  svg: SVGSVGElement;
  /** String written into `<title>` when `args.ariaLabel` is not supplied. */
  ariaLabel: string;
  /** Default description written into `<desc>`. */
  description: string;
  args?: ExportArgs;
}

/** Produce a stand-alone SVG string. Runs only in a browser-ish DOM (needs
 *  `getComputedStyle` + a writable `document.body`). Callers in JSDOM hit a
 *  noop fallback that returns the cloned outerHTML untouched. */
export function exportSvgString(input: PrepareExportInput): string {
  const args = input.args ?? {};
  const theme = args.theme ?? 'print';
  const fontImport = args.fontImport ?? 'google';
  const ariaLabel = args.ariaLabel ?? input.ariaLabel;
  const description = args.description ?? input.description;

  const doc = input.svg.ownerDocument;
  const win = doc?.defaultView;
  if (!doc || !win || typeof win.getComputedStyle !== 'function' || !doc.body) {
    // Last-resort fallback: serialize the live element as-is. This path is
    // only reachable under test runners that don't provide a real document
    // (the production import in the viewer guards behind `svgRef.current`).
    return serializeRoot(input.svg);
  }

  const clone = input.svg.cloneNode(true) as SVGSVGElement;

  // Mount the clone in a hidden wrapper that mirrors the host's gene-glyph
  // class so the CSS cascade resolves. Print theme rides on an ancestor of
  // the gene-glyph class (the cascade rule is `[data-vv-print] .gene-glyph`,
  // a descendant selector — putting both attrs on the same element would not
  // match). Nesting is cheap and keeps the live host untouched.
  const outer = doc.createElement('div');
  outer.style.cssText =
    'position:absolute;left:-99999px;top:-99999px;width:1px;height:1px;overflow:hidden;pointer-events:none;';
  if (theme === 'print') outer.setAttribute('data-vv-print', '');
  const wrap = doc.createElement('div');
  wrap.className = 'gene-glyph';
  outer.appendChild(wrap);
  wrap.appendChild(clone);
  doc.body.appendChild(outer);

  try {
    // Force a layout pass so `getComputedStyle` resolves transforms / colours
    // against the wrapper-supplied cascade. Without this, Chromium under load
    // can return the unresolved `var(--vv-exon-x-0)` string on the first read.
    void wrap.getBoundingClientRect();

    removeTransientNodes(clone);
    const background = readBackgroundColor(clone, win);
    inlineStylesInPlace(clone, win);
    finalizeRoot(clone, doc, {
      title: ariaLabel,
      description,
      fontImport,
      widthPx: args.width,
      background,
    });

    return serializeRoot(clone);
  } finally {
    outer.remove();
  }
}

/** Rasterise an SVG string to a PNG Blob at the requested pixel width. The
 *  height is derived from the SVG's intrinsic aspect ratio so callers control
 *  resolution with a single number (design §10: "1800px for 6-inch @ 300dpi,
 *  2400px for 8-inch"). White background painted in to avoid the transparent
 *  PNG quirk where journal layouts composite against grey. */
export async function exportPngBlob(args: {
  svgString: string;
  widthPx: number;
  viewBoxWidth: number;
  viewBoxHeight: number;
  background?: string;
}): Promise<Blob> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    throw new Error('exportPNG requires a browser environment.');
  }
  const widthPx = Math.max(1, Math.round(args.widthPx));
  const aspect = args.viewBoxHeight / Math.max(1, args.viewBoxWidth);
  const heightPx = Math.max(1, Math.round(widthPx * aspect));
  const blob = new Blob([args.svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'sync';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('exportPNG: SVG image failed to load.'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = widthPx;
    canvas.height = heightPx;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('exportPNG: 2D context unavailable.');
    ctx.fillStyle = args.background ?? '#ffffff';
    ctx.fillRect(0, 0, widthPx, heightPx);
    ctx.drawImage(img, 0, 0, widthPx, heightPx);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('exportPNG: canvas.toBlob produced no blob.'))),
        'image/png',
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const TRANSIENT_SELECTOR = '.vv-loading-shimmer, .vv-loading-overlay';

function removeTransientNodes(root: SVGSVGElement): void {
  // Loading shimmer is a screen-only affordance; it would smear a translucent
  // band across the figure in print and signal nothing.
  root.querySelectorAll(TRANSIENT_SELECTOR).forEach((el) => el.remove());
}

function inlineStylesInPlace(root: SVGSVGElement, win: Window): void {
  // Two-pass walk: read all computed styles first, then strip.
  //
  // Why two passes: the live SVG carries `--vv-exon-x-N`, `--vv-intron-scale`,
  // etc. as inline CSS variables on the root <svg> element (set by
  // ViewportController.publish). Child elements like `.vv-exon-group` read
  // those variables to resolve their `transform`. Stripping the root's inline
  // style attribute mid-walk drops the variable definitions, leaving the
  // children's subsequent computed transforms unresolvable — every per-exon
  // transform would collapse to identity. Two passes keeps the cascade alive
  // until we're done reading.
  const all: SVGElement[] = [root];
  const walker = root.ownerDocument!.createTreeWalker(root, /* NodeFilter.SHOW_ELEMENT */ 1);
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    all.push(n as SVGElement);
  }
  for (const el of all) {
    const isRoot = el === root;
    let cs: CSSStyleDeclaration | null;
    try {
      cs = win.getComputedStyle(el);
    } catch {
      cs = null;
    }
    if (!cs) continue;
    if (!isRoot) {
      const transform = cs.transform;
      if (transform && transform !== 'none') {
        el.setAttribute('transform', cssMatrixToSvgTransform(transform));
      }
    }
    const tag = el.tagName.toLowerCase();
    if (tag === 'text') {
      setIfMeaningful(el, 'fill', cs.fill);
      setIfMeaningful(el, 'opacity', cs.opacity);
      setIfMeaningful(el, 'font-family', cs.fontFamily);
      setIfMeaningful(el, 'font-size', cs.fontSize);
      setIfMeaningful(el, 'font-weight', cs.fontWeight);
      setIfMeaningful(el, 'font-style', cs.fontStyle);
      setIfMeaningful(el, 'text-anchor', cs.textAnchor);
      setIfMeaningful(el, 'dominant-baseline', cs.dominantBaseline);
    } else if (!isRoot) {
      setIfMeaningful(el, 'fill', cs.fill);
      setIfMeaningful(el, 'fill-opacity', cs.fillOpacity);
      setIfMeaningful(el, 'stroke', cs.stroke);
      setIfMeaningful(el, 'stroke-opacity', cs.strokeOpacity);
      setIfMeaningful(el, 'stroke-width', cs.strokeWidth);
      setIfMeaningful(el, 'stroke-linecap', cs.strokeLinecap);
      setIfMeaningful(el, 'stroke-linejoin', cs.strokeLinejoin);
      setIfMeaningful(el, 'stroke-dasharray', cs.strokeDasharray);
      setIfMeaningful(el, 'opacity', cs.opacity);
    }
  }
  for (const el of all) {
    stripInteractiveAttrs(el, el === root);
  }
}

function setIfMeaningful(el: SVGElement, name: string, value: string | null | undefined): void {
  if (value === null || value === undefined) return;
  const v = value.trim();
  if (!v) return;
  // Drop attribute-default no-ops that would just inflate the output.
  if (v === 'none' && (name === 'fill' || name === 'stroke')) {
    el.setAttribute(name, 'none');
    return;
  }
  if (v === 'normal' && (name === 'font-style' || name === 'font-weight')) return;
  if (v === '1' && (name === 'opacity' || name === 'fill-opacity' || name === 'stroke-opacity')) return;
  if (v === 'rgba(0, 0, 0, 0)' && name === 'fill') {
    el.setAttribute(name, 'none');
    return;
  }
  el.setAttribute(name, v);
}

const KEEP_ON_ROOT = new Set([
  'viewBox',
  'preserveAspectRatio',
  'width',
  'height',
  'role',
  'aria-label',
  'xmlns',
  'xmlns:xlink',
]);

function stripInteractiveAttrs(el: SVGElement, isRoot: boolean): void {
  // Wipe class + inline style after computed-style readouts; both are now
  // baked into attributes (or intentionally absent).
  el.removeAttribute('style');
  if (!isRoot) {
    el.removeAttribute('class');
    el.removeAttribute('tabindex');
    el.removeAttribute('role');
    el.removeAttribute('aria-label');
    el.removeAttribute('aria-hidden');
  }
  // Strip data-* attributes used for hit-testing and Playwright selectors.
  const toRemove: string[] = [];
  for (const attr of Array.from(el.attributes)) {
    if (attr.name.startsWith('data-')) toRemove.push(attr.name);
    if (attr.name.startsWith('on')) toRemove.push(attr.name);
    if (isRoot && !KEEP_ON_ROOT.has(attr.name) && !attr.name.startsWith('xml')) {
      // Keep namespace declarations + structural root attrs; drop everything
      // else (class, data-*, event handlers).
      toRemove.push(attr.name);
    }
  }
  for (const name of toRemove) el.removeAttribute(name);
}

interface RootFinalizeArgs {
  title: string;
  description: string;
  fontImport: 'google' | 'none';
  widthPx?: number;
  background?: string | null;
}

/** Read the figure's resolved `background-color`. `null` when the figure has
 *  the default transparent background — no point painting a transparent rect.
 *  Captured before {@link inlineStylesInPlace} strips the class hooks the
 *  cascade depends on. */
function readBackgroundColor(svg: SVGSVGElement, win: Window): string | null {
  let cs: CSSStyleDeclaration | null;
  try {
    cs = win.getComputedStyle(svg);
  } catch {
    return null;
  }
  const value = cs.backgroundColor?.trim();
  if (!value) return null;
  if (value === 'transparent' || value === 'rgba(0, 0, 0, 0)') return null;
  return value;
}

function finalizeRoot(
  svg: SVGSVGElement,
  doc: Document,
  args: RootFinalizeArgs,
): void {
  svg.setAttribute('xmlns', SVG_NS);
  svg.setAttribute('xmlns:xlink', XLINK_NS);

  // Concrete width/height. The viewBox stays in figure units so vector tools
  // see real coordinates; width/height drive raster previewers (PDF renderers,
  // Image previews).
  const viewBox = svg.getAttribute('viewBox') ?? '0 0 1000 100';
  const parts = viewBox.split(/[\s,]+/).map(Number);
  const vbWidth = Number.isFinite(parts[2]) ? (parts[2] as number) : 1000;
  const vbHeight = Number.isFinite(parts[3]) ? (parts[3] as number) : 100;
  const widthPx = args.widthPx ?? vbWidth;
  const aspect = vbHeight / Math.max(1, vbWidth);
  svg.setAttribute('width', String(widthPx));
  svg.setAttribute('height', String(Math.round(widthPx * aspect)));

  // Drop any pre-existing <title>/<desc> children — the React render emits a
  // generic title that we replace with the export-specific one.
  for (const child of Array.from(svg.children)) {
    const tag = child.tagName.toLowerCase();
    if (tag === 'title' || tag === 'desc') child.remove();
  }

  const titleEl = doc.createElementNS(SVG_NS, 'title');
  titleEl.textContent = args.title;
  const descEl = doc.createElementNS(SVG_NS, 'desc');
  descEl.textContent = args.description;
  svg.insertBefore(descEl, svg.firstChild);
  svg.insertBefore(titleEl, svg.firstChild);

  if (args.fontImport === 'google') {
    const defs = doc.createElementNS(SVG_NS, 'defs');
    const styleEl = doc.createElementNS(SVG_NS, 'style');
    styleEl.setAttribute('type', 'text/css');
    styleEl.textContent = GOOGLE_FONTS_IMPORT;
    defs.appendChild(styleEl);
    svg.insertBefore(defs, titleEl.nextSibling);
  }

  // Paint the resolved background as the first visible child. The screen
  // figure picks up its background via CSS (`vv-color-bg-surface`) — the
  // standalone SVG has no host stylesheet attached, so without an in-figure
  // rect the print-theme white background would be lost when the file lands
  // in Illustrator or a PDF.
  if (args.background) {
    const bg = doc.createElementNS(SVG_NS, 'rect');
    bg.setAttribute('x', '0');
    bg.setAttribute('y', '0');
    bg.setAttribute('width', String(vbWidth));
    bg.setAttribute('height', String(vbHeight));
    bg.setAttribute('fill', args.background);
    // Insert after <title>/<desc>/<defs> so accessibility chunks stay first.
    const insertionPoint = findFirstNonMetaChild(svg);
    if (insertionPoint) svg.insertBefore(bg, insertionPoint);
    else svg.appendChild(bg);
  }
}

function findFirstNonMetaChild(svg: SVGSVGElement): Element | null {
  for (const child of Array.from(svg.children)) {
    const tag = child.tagName.toLowerCase();
    if (tag !== 'title' && tag !== 'desc' && tag !== 'defs') return child;
  }
  return null;
}

/** CSS `matrix(a, b, c, d, e, f)` → SVG `matrix(a b c d e f)`. Also accepts
 *  `matrix3d(...)` (16 args) and flattens to the 2D submatrix that SVG uses.
 *  Returns `''` if it can't parse, signalling the caller to skip writing. */
function cssMatrixToSvgTransform(css: string): string {
  const trimmed = css.trim();
  if (!trimmed || trimmed === 'none') return '';
  const matrixMatch = /^matrix\(([^)]+)\)$/.exec(trimmed);
  if (matrixMatch) {
    const nums = matrixMatch[1]!
      .split(/[\s,]+/)
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n));
    if (nums.length === 6) {
      return `matrix(${nums.join(' ')})`;
    }
  }
  const matrix3d = /^matrix3d\(([^)]+)\)$/.exec(trimmed);
  if (matrix3d) {
    const nums = matrix3d[1]!
      .split(/[\s,]+/)
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n));
    if (nums.length === 16) {
      // CSS matrix3d is column-major; the 2D submatrix uses indices 0,1,4,5,12,13.
      const a = nums[0]!;
      const b = nums[1]!;
      const c = nums[4]!;
      const d = nums[5]!;
      const e = nums[12]!;
      const f = nums[13]!;
      return `matrix(${a} ${b} ${c} ${d} ${e} ${f})`;
    }
  }
  // Unknown form — round-trip the raw value so we at least don't lose info.
  return trimmed;
}

function serializeRoot(svg: SVGSVGElement): string {
  // Guard the namespace declaration even when XMLSerializer is unavailable.
  if (!svg.getAttribute('xmlns')) svg.setAttribute('xmlns', SVG_NS);
  if (typeof XMLSerializer === 'function') {
    const xml = new XMLSerializer().serializeToString(svg);
    return `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n${svg.outerHTML}`;
}
