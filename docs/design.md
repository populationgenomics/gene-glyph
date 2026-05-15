# gene-glyph — Architecture Design

A standalone, reusable React component for rendering gene-level annotation figures with multi-coordinate alignment, pluggable data tracks, delightful interactivity, and camera-ready vector export.

Extracted from lit-manager's `frontend/src/components/GeneSchematic.tsx` but rebuilt from scratch under a new architecture.

---

## 1. Scope and positioning

**Single-transcript, multi-coordinate-aligned annotation viewer.**

In scope:
- One transcript per viewer instance
- Three biology axes aligned and convertible: genomic, CDS, protein
- Exon/intron structure with collapsed-intron and spliced/protein views
- Arbitrary tracks (variants, domains, scores, annotations, user data)
- Pluggable data sources (gnomAD, ClinVar, MAVE, AlphaMissense, custom)
- Interactivity: pan, zoom, hover, click, brush, mode switching
- Camera-ready vector + raster export

Out of scope:
- Multi-gene or genome-browser views (IGV.js exists for that)
- Intergenic data, contigs, BAM/VCF tile loading
- Data outside the chosen transcript's window

---

## 2. Repo and package

- **Repo**: new top-level `github.com/populationgenomics/gene-glyph`
- **Package**: `@populationgenomics/gene-glyph`
- **Component**: `<GeneGlyph>`
- **Module format**: ESM-only, with TypeScript declarations
- **Tree-shaking**: every track factory and adapter is a named export
- **Peer deps**: `react`, `react-dom` (>=18 <20)
- **Build**: Vite library mode
- **Release**: changesets + semver; `0.x` while API stabilises, `1.0.0` at lit-manager cutover
- **Docs**: README + playground app (Vite); Storybook deferred until post-1.0

### Workspace layout

```
gene-glyph/
  package.json                            # workspaces: ["packages/*", "apps/*"]
  packages/
    gene-glyph/
      package.json
      src/
        index.ts                          # public API
        viewer.tsx                        # <GeneGlyph> compound component
        viewport.ts                       # ViewportController
        coordinate-mapper.ts
        layout-engine.ts
        painter/
          index.ts
          svg-painter.ts
        tracks/
          exon-track.tsx
          variant-track.tsx
          pfam-track.tsx
          interpro-track.tsx
          clinvar-track.tsx
          gnomad-track.tsx
          alphamissense-track.tsx
          mave-track.tsx
          user-annotation-track.tsx
          overview-track.tsx
        adapters/
          clinvar.ts
          gnomad.ts
          alphamissense.ts
          mave.ts
        chrome/
          default-track-chevron.tsx
          default-minimap.tsx
        animation/
          flip.ts
        styles.css
        types.ts
      vite.config.ts
      tsconfig.json
  apps/
    playground/
      src/scenarios/
        paper-report.tsx                  # mirrors lit-manager's current usage
        gnomad-demo.tsx
        mave-heatmap.tsx
        alphamissense-demo.tsx
        modes-demo.tsx
        export-demo.tsx
```

---

## 3. Coordinate model

Four coordinate spaces:

1. **Genomic** — `(chr, pos)`. Source of truth for gnomAD/ClinVar.
2. **CDS** — `(c.pos, offset)`. HGVS c. notation; intronic when `offset !== 0`.
3. **Protein** — `(aa)`. AlphaMissense, MAVE, Pfam, InterPro.
4. **Screen** — `(x, y)` in figure pixels.

Two objects own the conversions:

### `CoordinateMapper` (biology-pure, immutable per transcript)

```ts
interface CoordinateMapper {
  genomicToCds(chr: string, pos: number): { cPos: number; offset: number } | null;
  cdsToGenomic(cPos: number, offset: number): { chr: string; pos: number } | null;
  cdsToProtein(cPos: number): number | null;        // null if UTR
  proteinToCds(aa: number): number;                 // first base of codon
}
```

Constructed by the data adapter from the transcript record. Stable across viewport changes. Reused for memoisation.

### `Viewport` (screen-state, mutable on zoom/pan/mode)

```ts
interface Viewport {
  readonly mode: 'cds-with-introns' | 'cds-spliced' | 'protein';
  readonly intronScale: number;                     // 0..1, interpolatable
  readonly range: [number, number];                 // window over the active ruler

  // Point projections (return null when out-of-view in current mode)
  cdsToScreen(cPos: number, offset: number): number | null;
  proteinToScreen(aa: number): number | null;
  genomicToScreen(chr: string, pos: number): number | null;

  // Inverse (for hover readouts, brush selection)
  screenToCds(x: number): { cPos: number; offset: number } | null;
  screenToGenomic(x: number): { chr: string; pos: number } | null;
  screenToProtein(x: number): number | null;

  // Range projections — return one or more screen-x segments per range,
  // fragmenting at exon boundaries in spliced/protein modes.
  projectGenomicRange(chr: string, start: number, end: number): RangeProjection;
  projectCdsRange(start: number, end: number): RangeProjection;
  projectProteinRange(aaStart: number, aaEnd: number): RangeProjection;

  // Anchor for overlays
  resolveAnchor(target: AnchorTarget): { x: number; y: number } | null;
}

interface RangeProjection {
  segments: Array<{ xStart: number; xEnd: number; exonIdx: number }>;
  droppedIntronicCount: number;
  droppedExonicCount: number;
  droppedRanges: Array<{ kind: 'intronic' | 'out-of-bounds'; near?: { exonIdx: number } }>;
}
```

The viewport publishes its state both as JS values (for layout decisions) and as CSS custom properties on the SVG root (for animation — see §8).

---

## 4. Y-layout

Tracks stack top-to-bottom under a `LayoutEngine`. The engine offers each track a **height budget hint**; the track returns its actual height plus whether it truncated:

```ts
interface Track<TConfig = unknown, TData = unknown> {
  readonly id: string;
  readonly coordSystem: 'genomic' | 'cds' | 'protein';
  readonly heightPolicy: 'fixed' | 'data-dependent' | 'zoom-dependent';

  load(args: { viewport: Viewport; mapper: CoordinateMapper; signal: AbortSignal }): Promise<TData>;

  height(args: {
    data: TData | null;
    viewport: Viewport;
    hint: { maxPx: number };
  }): { px: number; didTruncate: boolean; droppedCount?: number };

  render(args: {
    data: TData;
    rect: { yTop: number; yBottom: number };
    viewport: Viewport;
    mapper: CoordinateMapper;
    interaction: InteractionState;
    painter: Painter;
  }): React.ReactNode;

  resolveAnchor?(data: TData, anchorId: string, viewport: Viewport): { x: number; y: number } | null;

  toJSON(): TConfig;
}
```

Track groups bundle related tracks under a single gutter label with optional collapse and shared height budget:

```ts
interface TrackGroup {
  kind: 'group';
  id: string;
  label: string;
  defaultExpanded?: boolean;
  collapsedSummary?:
    | { kind: 'count' }
    | { kind: 'density' }
    | { kind: 'custom'; render: (...) => React.ReactNode };
  gapAbove?: number;
  heightBudget?: number;
  tracks: Track[];
}
```

Public prop on `<GeneGlyph>`:
```ts
tracks: Array<Track | TrackGroup>;
```

### Height policies

- **`fixed`** (default) — height is a pure function of data. Constant during zoom. Most tracks pick this.
- **`data-dependent`** — height depends on loaded data (e.g. number of IPR lanes). Recomputed when data changes; constant during zoom.
- **`zoom-dependent`** — height changes during zoom (e.g. a MAVE heatmap expanding rows as clusters dissolve). Opt-in; the engine interpolates `{yTop, yBottom}` per-frame.

### Layout cascade rules

| Event | Y-stack changes? | Animation |
|---|---|---|
| Zoom (fixed tracks) | No | Free |
| Zoom (zoom-dependent track) | That track's height, smooth | Per-frame interpolation, paid per opted-in track |
| Expand/collapse user click | One track, big jump | Spring-curve transition, anchored to click target |
| Track add/remove | Y-stack reflows | FLIP-style transition |
| Mode change (CDS↔protein) | No (heights independent of x-projection) | Free |

### Overlays

Separate floating z-layer above the track stack. Overlays may deliberately overlap tracks (hover tooltips, brush rectangles, "you are here" markers). They are *positioned in screen-space* relative to viewport-resolved targets:

```ts
interface AnchorTarget {
  trackId?: string;
  featureId?: string;
  kind?: 'feature' | 'intron-boundary' | 'protein-aa' | 'cds-pos' | 'genomic-pos';
  // shape varies by kind
}
```

Overlays are not tracks. They don't compete for vertical budget. They are stripped at export.

---

## 5. Fade taxonomy

Three classes of feature-disappearance, each with distinct motion:

| Cause | Behaviour | Duration |
|---|---|---|
| Geometric vanish (intron collapses; range fragments at exon boundary) | Opacity tied to `intronScale`; co-animates with geometry | ~400ms |
| Pan-out-of-frame | Hard clip at viewport edge, no fade | n/a |
| Semantic filter (user toggled off) | Fade with slight delay | ~250ms |
| Emergence (label revealed by zoom; cluster member uncovered) | Fade in | ~150ms |

**Hidden-feature indicators are data marks, not chrome.** Tracks that care surface them however makes sense for their data (small marks on dashed-gap polyline, header counters, popovers). The viewport provides `droppedIntronicCount` etc.; tracks decide what to do. The viewer never imposes a hidden-features UI.

---

## 6. Track abstraction and data fetching

### `Track` interface

(Repeated from §4 for completeness.)

Each track is a plain object implementing `Track<TConfig, TData>`. Not a React component. Constructed via factory functions:

```ts
import {
  exonTrack, variantTrack, pfamTrack, interProTrack,
  clinVarTrack, gnomADTrack, alphaMissenseTrack, maveTrack,
  userAnnotationTrack, overviewTrack,
} from '@populationgenomics/gene-glyph';

<GeneGlyph
  transcript={transcript}
  mapper={mapper}
  tracks={[
    exonTrack({}),
    pfamTrack({}),
    interProTrack({ groups: ['family', 'domain'] }),
    variantTrack({ source: paperVariantsSource }),
    {
      kind: 'group',
      id: 'population',
      label: 'Population',
      tracks: [
        clinVarTrack({ source: clinvarAdapter }),
        gnomADTrack({ source: gnomadAdapter, populations: ['nfe', 'afr'] }),
      ],
    },
    alphaMissenseTrack({ source: amAdapter }),
  ]}
/>
```

### `DataSource` interface

Each track receives a typed `DataSource` adapter at construction. The adapter owns caching, deduplication, and cancellation:

```ts
interface DataSource<TQuery, TResult> {
  readonly id: string;
  cacheKey(query: TQuery): string;
  query(query: TQuery, signal: AbortSignal): Promise<TResult>;
  freshness?: 'on-viewport-change' | 'sticky' | 'realtime';
}
```

Why this shape:
- Adapters know their protocols (gnomAD has rate limits and bulk endpoints; ClinVar is a download; MAVE is per-protein). No useful generic data layer; each adapter is its own beast.
- Tracks stay pure — they don't know if the source is network or in-memory.
- Two tracks sharing an adapter instance share the cache automatically.
- Mode change doesn't refetch — the cache key is based on the query window, not the projection mode.

### Viewer-level orchestration

The viewer:
1. **Debounces viewport changes** (~120ms) before calling `track.load()`. Stale data shows with a subtle desaturation during the debounce.
2. **Per-track AbortController** — viewport change again, abort in-flight, restart.
3. **Loading state** per track via `onTrackStateChange?: (id, state) => void`. The viewer renders a default subtle shimmer over the track's y-range; never blocks the whole viewer.
4. **Initial render with no data** calls `height({data: null})`; tracks should return a sensible placeholder height.

---

## 7. Zoom, pan, and interaction

### Zoom

- **Continuous scale**, no discrete levels.
- **Snap-point affordances**: `1` = fit gene, `2` = fit selection, `f` = fit feature under cursor.
- **Range**: min = fit-gene + ~5% padding; max = ~1 aa per 20px (configurable via `maxZoom`).
- **Focal point**: cursor-anchored; falls back to viewport-centre for keyboard zoom; falls back to selected feature for fit-to-selection.
- **Pan clamps** hard to gene bounds + ~5% padding. No bounce-back.

### Mode + zoom interaction

The viewport internally tracks zoom as `{ ruler: 'cds' | 'protein', range: [start, end] }`. Mode switch preserves the **visible region** of the gene, not the numeric scale. Animation interpolates the range bounds through the mapper.

### Default interaction bindings

| Gesture | Action |
|---|---|
| Wheel over viewer | Pan horizontally; falls through to page when at pan limit |
| Cmd/Ctrl + wheel | Zoom, cursor-anchored |
| Pinch | Zoom, cursor-anchored |
| Drag | Pan, `cursor: grabbing` |
| Shift+drag or right-click drag | Brush-select a range |
| Double-click feature | Fit feature |
| Double-click empty | Zoom out one step (or fit gene on second tap) |
| `+ / -` | Zoom centred |
| `←/→` | Pan one step |
| `1 / 2 / f` | Fit gene / selection / feature-under-cursor |

Configurable via `interactionMode: 'standard' | 'embed' | 'fullscreen'`.

### Brush vs zoom

Distinct concepts. Brush sets `viewport.brushRange`, delivered to tracks via `interaction`. Tracks render selection highlights for features intersecting the brush. The host can wire a "zoom to selection" action via the imperative ref.

### Intron-gap rendering under zoom

```
gapWidth = clamp(MIN_GAP_PX, exonAvgWidth × 0.08, MAX_GAP_PX)
```
with `MIN_GAP_PX = 4`, `MAX_GAP_PX = 32`. Tweak by eye during implementation.

---

## 8. Animation — CSS-driven

The viewer's continuous state is expressed as **CSS custom properties on the SVG root**, with **CSS transitions on `transform` and `opacity`** doing all interpolation.

### CSS-variable contract

On the figure SVG root:
- `--vv-zoom` — current zoom scalar
- `--vv-pan-x` — pan offset in px
- `--vv-intron-scale` — 0..1, interpolatable
- `--vv-exon-x-{N}` — per-exon x-offset
- `--vv-exon-w-{N}` — per-exon width
- Plus theme variables: `--vv-color-text-primary`, `--vv-color-bg-surface`, etc.

### Structural rule

Every exon's features live inside a per-exon `<g>` group:
```svg
<g class="vv-exon-group" style="transform: translateX(var(--vv-exon-x-0))">
  <!-- exon 0 contents: rectangles, variant ticks, domain segments -->
</g>
```

Between-exon decorations (dashed gap polylines, intronic features) live in `<g class="vv-intron-decoration">` with `opacity: var(--vv-intron-scale)`.

### Discipline rules

- **All motion happens via `transform` on a wrapping `<g>`, never via SVG attribute-value interpolation.** Cross-browser consistent.
- **Direct manipulation (drag, wheel) updates CSS variables directly** — no React re-render during the gesture.
- **Programmatic transitions (fit-to-feature, mode-change) toggle a transitioning class**, set the new variable values, let CSS handle the rest, and listen for `transitionend` to fire callbacks.
- **`prefers-reduced-motion`** is a single global rule in `styles.css`.

### Easing palette

| Animation | Curve | Duration |
|---|---|---|
| Viewport via fit/keyboard | `cubic-bezier(0.22, 1, 0.36, 1)` (ease-out-quart) | 350ms |
| Mode transition | `cubic-bezier(0.77, 0, 0.175, 1)` (ease-in-out-quart) | 450ms |
| Track collapse/expand | `cubic-bezier(0.34, 1.56, 0.64, 1)` (slight overshoot) | 250ms |
| Variant hover lift | `ease-out` | 120ms |
| Overlay fade in / out | `ease-out` | 100ms / 200ms |

### FLIP for layout transitions

When tracks reorder, collapse, expand, or get added/removed:
1. Capture old `{yTop, yBottom}` per `track.id`.
2. Render new layout.
3. For each track whose y changed, set `transform: translateY(deltaY)` (no transition).
4. On next animation frame, remove the transform (CSS transitions interpolate to 0).

~30 lines of JS in `animation/flip.ts`.

### No animation library dependency

No Framer Motion, no react-spring. The CSS variables + transitions cover everything. The viewer ships with `styles.css` and the FLIP helper; nothing else.

---

## 9. No widgets, slot-based chrome

The viewer renders the figure SVG and nothing else that would have to be removed for export. All UI chrome is host-rendered, supplied through named slots.

### Compound-component API

```tsx
<GeneGlyph
  transcript={transcript}
  mapper={mapper}
  tracks={[...]}
  mode={mode}
  viewportRange={range}
  selectedFeatures={selection}
  collapsedGroupIds={collapsed}
  hiddenTrackIds={hidden}
  brushRange={brush}
  theme={theme}
  onModeChange={setMode}
  onViewportChange={setRange}
  onSelectionChange={setSelection}
  onBrushChange={setBrush}
  onFeatureClick={handleFeatureClick}
  onHover={handleHover}
  ref={ref}
>
  <GeneGlyph.Header>
    <ModeToggle value={mode} onChange={setMode} />
    <ZoomControls viewerRef={ref} />
  </GeneGlyph.Header>

  <GeneGlyph.LeftGutter width={32}>
    {(item) => (
      <TrackChevron
        item={item}
        collapsed={collapsed.has(item.id)}
        onToggle={() => toggleCollapse(item.id)}
      />
    )}
  </GeneGlyph.LeftGutter>

  <GeneGlyph.RightGutter width={24}>
    {(item) => item.kind === 'track' && item.didTruncate
      ? <TruncationBadge count={item.droppedCount} />
      : null}
  </GeneGlyph.RightGutter>

  <GeneGlyph.Footer height={48}>
    <DefaultMinimap viewerRef={ref} />
  </GeneGlyph.Footer>
</GeneGlyph>
```

### Slot properties

- **Layout-owned.** The viewer reserves the slot space and publishes per-item rects. Slot contents are positioned automatically against the figure.
- **Render-prop polymorphism.** Gutter children are `(item) => ReactNode` where `item` is `{kind: 'track' | 'group', id, rect, didTruncate, droppedCount, isCollapsed, ...}`.
- **Export discipline.** `exportSVG()` serialises the figure SVG only. Slots are React DOM siblings (not children) of the SVG element; they structurally cannot leak into export.

### Controlled props (host owns state)

- `mode`
- `viewportRange`
- `selectedFeatures`
- `collapsedGroupIds`
- `hiddenTrackIds`
- `brushRange`
- `theme`

Each with a matching `default*` prop for uncontrolled use and a matching `on*Change` callback.

### Imperative ref API

```ts
interface GeneGlyphRef {
  fitTo(target: { kind: 'gene' } | { kind: 'feature'; trackId: string; featureId: string }
        | { kind: 'selection' } | { kind: 'range'; range: [number, number] }): void;
  zoomBy(factor: number): void;
  getViewportInfo(): { mode, range, zoom, layout };
  exportSVG(args?: ExportArgs): Promise<string>;
  exportPNG(args?: ExportArgs & { widthPx: number }): Promise<Blob>;
}
```

### What was always going to be a widget (now host-only)

Zoom in/out buttons, mode dropdown, reset, "download SVG" button, legend toggle, track-visibility checkboxes, anything with a hover background. The host renders these around the viewer.

### Convenience exports

Pre-built chrome components shipped with the package for hosts that want a starting point:

```ts
import { DefaultTrackChevron, DefaultMinimap } from '@populationgenomics/gene-glyph';
```

No privileged access — they're built on the same public API. Hosts that want full design control bypass them.

---

## 10. Camera-ready export

### Format scope

- **SVG**: primary. `figureSvg.outerHTML` + cleanup.
- **PNG**: derived. SVG → canvas at requested `widthPx`.
- **PDF**: out of scope. Hosts use `rsvg-convert` or open SVG in Illustrator.

### Export API

```ts
type ExportArgs = {
  theme?: 'current' | 'print' | ThemeOverride;       // default 'print'
  truncation?: 'as-shown' | 'expand';                // default 'as-shown'
  width?: number;
  ariaLabel?: string;
};

exportSVG(args?: ExportArgs): Promise<string>;
exportPNG(args?: ExportArgs & { widthPx: number }): Promise<Blob>;
```

### Themes

- **`current`** — resolve `var()` to the values active in the host page. Screenshots what's on screen.
- **`print`** (default) — dedicated print palette: white bg, dark text (#1f2937), saturated category colours, stronger stroke weights, no shadows. All `var()` resolved to concrete hex.
- **`ThemeOverride`** — explicit `{ background, text, …, consequenceColors }` object.

### Truncation

- **`as-shown`** (default) — export matches screen view, preserving height-budget truncation.
- **`expand`** — ignore budgets; render each track at natural full height; figure grows vertically.

Hidden-feature indicators (which are data marks) stay in both modes.

### Animation state

Mid-animation export resolves to **target** state, not in-progress frame. Implementation cancels in-flight transitions, snaps variables to targets, serialises.

### Fonts

- **v1**: ship as font-stack (`font-family: 'Inter', system-ui, sans-serif`). Self-rendering SVG includes `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap')` in a `<defs><style>` block.
- **v2**: `textOutlines: boolean` flag converts text to SVG paths via opentype.js. Identical rendering anywhere; not editable as text.
- Inside the running viewer: host installs `@fontsource/inter` for offline builds, or links Google Fonts in `<head>`.

### PNG resolution

`widthPx` is the primary control. Sensible defaults:
- 1800px for 6-inch figure @ 300dpi
- 2400px for 8-inch figure @ 300dpi

DPI is derived from `widthPx / figureWidthInches`. Not exposed as a separate parameter.

### SVG cleanup at export

Painter's export mode strips:
- `data-*` attributes used for hit-testing
- `style="cursor: pointer"` and hover-state CSS
- Event handlers (defensive — shouldn't be in serialised DOM)
- Empty `<g>` elements
Inlines:
- All `var(--vv-*)` → resolved concrete values per theme choice
Adds:
- XML namespace declaration
- `<title>` / `<desc>` for accessibility (gene name, transcript ID, view mode)
- Embedded font `@import` if running in self-rendering mode

---

## 11. Painter abstraction

A drawing API that abstracts SVG-vs-Canvas, used by track `render()` methods:

```ts
interface Painter {
  // Per-exon group placement (the structural primitive for CSS-driven animation)
  placeInExonGroup(exonIdx: number, content: React.ReactNode): React.ReactNode;
  placeInInterExon(exonIdxA: number, exonIdxB: number, content: React.ReactNode): React.ReactNode;
  placeAbsolute(x: number, y: number, content: React.ReactNode): React.ReactNode;

  // Drawing primitives (return React.ReactNode for SVG; mutate context for Canvas)
  drawRect(args: { x; y; width; height; rx?; ry?; fill?; stroke?; strokeWidth?; vectorEffect?; className?; onClick? }): React.ReactNode;
  drawLine(args: { x1; y1; x2; y2; stroke?; strokeWidth?; className? }): React.ReactNode;
  drawText(args: { x; y; text; fontSize?; fill?; textAnchor?; dominantBaseline? }): React.ReactNode;
  drawPath(args: { d; fill?; stroke?; strokeWidth? }): React.ReactNode;
  drawCircle(args: { cx; cy; r; fill?; stroke? }): React.ReactNode;

  // Composition
  group(args: { className?; style?; children }): React.ReactNode;

  // Theme
  color(varName: string, fallback?: string): string;

  // Export-mode flags
  readonly mode: 'screen' | 'export';
}
```

Two implementations:
- **`svg-painter.ts`** — returns React.ReactElement using SVG JSX.
- **`canvas-painter.ts`** — future, returns null and mutates a Canvas context. Tracks written against the Painter interface work in both.

---

## 12. Data contract (gene-glyph native types)

```ts
interface Transcript {
  geneSymbol: string;
  transcriptId: string;
  isManeSelect?: boolean;
  cdsLength: number;
  strand: '+' | '-';
  exons: Array<{ number: number; cdsStart: number; cdsEnd: number; genomicStart: number; genomicEnd: number; chr: string }>;
}

interface ProteinAnnotations {
  uniprotAcc: string;
  length: number;
  alphafoldId?: string;
  domains: Array<{
    aaStart: number;
    aaEnd: number;
    source: string;
    sourceId: string;
    shortName: string;
    description: string;
    entryType: 'domain' | 'family' | 'repeat' | 'homologous_superfamily' | 'conserved_site' | 'active_site' | 'binding_site' | 'ptm' | 'unspecified';
  }>;
}

interface ViewerVariant {
  id: string;
  label: string;
  coord:
    | { kind: 'cds'; cPos: number; offset: number }
    | { kind: 'protein'; aa: number }
    | { kind: 'genomic'; chr: string; pos: number };
  category: 'missense' | 'nonsense' | 'synonymous' | 'frameshift' | 'inframe_indel'
          | 'splice' | 'start_lost' | 'stop_lost' | 'regulatory' | 'utr'
          | 'intronic' | 'structural' | 'other' | 'unknown';
  meta?: Record<string, unknown>;                   // arbitrary per-variant data; tracks may render from this
}
```

Lit-manager writes a ~50-line adapter at the call site to map `ExtractedVariantRecord` → `ViewerVariant`. Gene-glyph stays domain-clean.

---

## 13. CSS strategy

- **Default stylesheet**: `@populationgenomics/gene-glyph/styles.css`. Consumer imports once. Defines all `--vv-*` variables with sensible defaults; transitions; print-theme overrides under `[data-vv-print]`; `prefers-reduced-motion` rule.
- **JS theme prop**: `<GeneGlyph theme={{...}}>` applies per-instance `style="--vv-color-...: ..."` to the figure root. Used for per-viewer theming or single-call print overrides for export.

Two entry points for theming cover everything: cascade for app-wide style, prop for per-viewer override.

---

## 14. Accessibility

- The figure SVG has `role="img"` and `aria-label="…"` derived from `transcript.geneSymbol` + `transcriptId` + view mode.
- Each variant tick is keyboard-focusable; Tab order follows screen-x.
- Enter/Space activates focused features (fires `onFeatureClick`).
- Tooltips on focused features rendered as overlays.
- Group labels and track-toggle chrome (in slots) are keyboard-operable since they're regular React.
- `prefers-reduced-motion` respected globally.

---

## 15. Testing strategy

- **Unit tests**: CoordinateMapper conversions, Viewport projection, LayoutEngine height negotiation, range-projection segment fragmentation. Run in Vitest.
- **Track tests**: each track's `height()` and `render()` smoke-tested with canonical inputs.
- **Visual regression**: playground scenarios captured as snapshots via Playwright. Runs in CI.
- **Interaction tests**: keyboard + mouse interactions on representative scenarios.
- **Export tests**: SVG output validates as well-formed; PNG output renders without errors at expected widths.

---

## 16. Migration from lit-manager

### Lit-manager keeps `GeneSchematic.tsx` in production untouched until gene-glyph reaches parity.

### Acceptance checklist for cutover

- Exons + collapsed introns at fit-gene zoom
- AlphaFold link in header (when protein record present)
- MANE Select badge (when applicable)
- Strand + CDS-length info in header
- Pfam track: hue-keyed colours, centred labels
- InterPro grouped lanes (family / domain / repeat / HSF), gutter group labels
- Variant ticks coloured by consequence category
- Hover-lift (`hoveredVariantId` equivalent)
- Selection (`selectedVariantId` equivalent)
- Click fires `onFeatureClick`
- Unplaced-variants list rendered below figure
- Theme matches lit-manager's light/dark via `--color-*` cascade

### Cutover steps

1. Add `@populationgenomics/gene-glyph` to lit-manager's `frontend/package.json`.
2. Write `frontend/src/components/gene-glyph-adapter.ts` (~50 lines) mapping lit-manager types → gene-glyph types.
3. Replace `<GeneSchematicView ...>` in `ReportsTabContent.tsx` with `<GeneGlyph ...>`, threading data via the adapter.
4. Verify visually against the legacy page.
5. Delete `frontend/src/components/GeneSchematic.tsx`.
6. Remove now-unused types from `frontend/src/types.ts` (e.g. `GeneSchematic` if not used elsewhere).
