import { useRef, useState } from 'react';
import {
  GeneGlyph,
  exonTrack,
  interProTrack,
  pfamTrack,
  variantTrack,
} from '@populationgenomics/gene-glyph';
import type {
  ExportArgs,
  GeneGlyphRef,
} from '@populationgenomics/gene-glyph';
import { TP53_PROTEIN, TP53_TRANSCRIPT, TP53_VARIANTS } from '../fixtures/tp53.js';

/**
 * Slice 19 — camera-ready SVG/PNG export.
 *
 * Two download buttons drive the imperative ref. The SVG path emits a
 * stand-alone file that opens cleanly in Inkscape; the PNG path rasterises
 * the same SVG at the requested width. Both default to the dedicated
 * `print` theme (white background, deeper saturation, heavier strokes) —
 * the toggle in the controls flips to `current` so the screen colours come
 * through unchanged.
 */
export function ExportDemoScenario() {
  const ref = useRef<GeneGlyphRef | null>(null);
  const [theme, setTheme] = useState<'print' | 'current'>('print');
  const [pngWidth, setPngWidth] = useState(2400);
  const [lastSvgLength, setLastSvgLength] = useState<number | null>(null);
  const [lastPngBytes, setLastPngBytes] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const themeArgs: ExportArgs = { theme };

  const handleSvg = async () => {
    setError(null);
    try {
      const svg = await ref.current?.exportSVG(themeArgs);
      if (!svg) return;
      setLastSvgLength(svg.length);
      triggerDownload(
        new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
        `tp53-gene-glyph.${theme}.svg`,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handlePng = async () => {
    setError(null);
    try {
      const blob = await ref.current?.exportPNG({ ...themeArgs, widthPx: pngWidth });
      if (!blob) return;
      setLastPngBytes(blob.size);
      triggerDownload(blob, `tp53-gene-glyph.${theme}.${pngWidth}px.png`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // Hidden hook for the Playwright spec: stash the most recently produced
  // SVG string on the wrapper element so the test can read it back without
  // needing to capture the browser download.
  const stashRef = useRef<HTMLPreElement | null>(null);
  const handleSvgPreview = async () => {
    setError(null);
    try {
      const svg = await ref.current?.exportSVG(themeArgs);
      if (!svg) return;
      setLastSvgLength(svg.length);
      if (stashRef.current) stashRef.current.textContent = svg;
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="scenario" aria-labelledby="scenario-export">
      <h2 id="scenario-export">Camera-ready export — TP53</h2>
      <p className="scenario-blurb">
        <code>exportSVG()</code> serialises the figure to a self-contained
        string; <code>exportPNG()</code> rasterises that same SVG via canvas
        at the chosen pixel width. The print theme swaps in concrete hex
        colours, a white background, and heavier strokes so the figure stays
        legible on paper.
      </p>
      <div
        style={{
          display: 'flex',
          gap: 16,
          flexWrap: 'wrap',
          alignItems: 'center',
          marginBottom: 8,
          fontSize: '0.85rem',
          color: '#475569',
        }}
      >
        <label>
          Theme{' '}
          <select
            data-testid="export-theme-select"
            value={theme}
            onChange={(e) => setTheme(e.target.value as 'print' | 'current')}
            style={{ font: 'inherit', padding: '2px 6px' }}
          >
            <option value="print">print</option>
            <option value="current">current</option>
          </select>
        </label>
        <label>
          PNG width{' '}
          <input
            data-testid="export-png-width"
            type="number"
            min={400}
            step={100}
            value={pngWidth}
            onChange={(e) => setPngWidth(Math.max(100, Number(e.target.value) || 0))}
            style={{ width: 90 }}
          />{' '}
          px
        </label>
        <button
          type="button"
          data-testid="export-download-svg"
          onClick={handleSvg}
        >
          Download SVG
        </button>
        <button
          type="button"
          data-testid="export-download-png"
          onClick={handlePng}
        >
          Download PNG
        </button>
        <button
          type="button"
          data-testid="export-preview-svg"
          onClick={handleSvgPreview}
        >
          Preview SVG (inline)
        </button>
        {lastSvgLength !== null && (
          <span data-testid="export-last-svg-length" style={{ fontVariantNumeric: 'tabular-nums' }}>
            last svg: <strong>{lastSvgLength}</strong> bytes
          </span>
        )}
        {lastPngBytes !== null && (
          <span data-testid="export-last-png-bytes" style={{ fontVariantNumeric: 'tabular-nums' }}>
            last png: <strong>{lastPngBytes}</strong> bytes
          </span>
        )}
      </div>
      {error && (
        <p data-testid="export-error" style={{ color: '#b91c1c', fontSize: '0.85rem' }}>
          {error}
        </p>
      )}
      <GeneGlyph
        ref={ref}
        transcript={TP53_TRANSCRIPT}
        protein={TP53_PROTEIN}
        tracks={[
          exonTrack({}),
          variantTrack({ source: TP53_VARIANTS }),
          pfamTrack({}),
          interProTrack({}),
        ]}
        trackHeightBudget={260}
      />
      <pre
        ref={stashRef}
        data-testid="export-svg-stash"
        style={{
          display: 'none',
        }}
      />
    </section>
  );
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Defer the revoke so Safari/Firefox actually pick up the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
