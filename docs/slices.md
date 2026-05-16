# gene-glyph — Implementation Slices

Tracer-bullet vertical slices ordered to deliver visible value incrementally. Each slice ends with a runnable demonstration in `apps/playground` and a defined acceptance bar.

Slices 1–20 deliver the cutover-ready package. Slices 21–26 deliver the post-cutover feature wishlist.

---

## Phase 1: Foundation

### Slice 1 — Repo bootstrap

Set up the repository and CI so subsequent slices have a place to land.

**In scope:**
- Create `github.com/populationgenomics/gene-glyph` repo
- npm workspaces: `packages/gene-glyph`, `apps/playground`
- Vite library mode for the package; Vite app for the playground
- TypeScript project references between package and playground
- ESLint + Prettier shared config
- CI workflow (`.github/workflows/ci.yml`): lint, typecheck, build, unit tests
- Release workflow with changesets (`.github/workflows/release.yml`)
- Empty `<GeneGlyph>` React component that renders a placeholder
- Empty `styles.css`
- README skeleton + LICENSE + CONTRIBUTING.md (mention yalc workflow)
- Publish `0.0.0` to npm

**Definition of done:**
- `npm install @populationgenomics/gene-glyph` works in a clean project
- Playground app imports the package and renders the placeholder
- CI is green on `main`

---

### Slice 2 — Core abstractions (no rendering)

The internal scaffolding everything else builds on. No visible UI yet.

**In scope:**
- `Transcript`, `ProteinAnnotations`, `ViewerVariant` public types
- `CoordinateMapper` interface + reference implementation constructed from a `Transcript`
- `Viewport` interface + `ViewportController` class that owns mutable state and publishes CSS variables
- Range-projection primitive returning `{segments, droppedIntronicCount, ...}`
- `LayoutEngine`: stack a list of `Track | TrackGroup` with height-budget hints
- `Track` and `TrackGroup` TypeScript interfaces
- `Painter` interface with SVG implementation (drawRect, drawLine, drawText, drawPath, drawCircle, group, placeInExonGroup, placeInInterExon, placeAbsolute, color, mode)
- Unit tests:
  - `genomicToCds`, `cdsToProtein`, `proteinToCds` round-trips
  - Range projection across exon boundaries (single segment, multi-segment, intronic-dropped)
  - LayoutEngine: tracks negotiate budgets, didTruncate set correctly
  - Viewport: screen-to-CDS and back at fit-gene zoom

**Definition of done:**
- All public types exported from package root
- Unit test coverage of CoordinateMapper, Viewport projection, LayoutEngine height negotiation
- No new UI; playground renders the same placeholder as Slice 1

---

## Phase 2: Parity render path

### Slice 3 — Exon track + first real render

The first slice that renders something users would recognise.

**In scope:**
- `exonTrack({})` factory
- Per-exon `<g class="vv-exon-group" style="transform: translateX(var(--vv-exon-x-N))">` structure
- Exon rectangles via `painter.drawRect` inside each exon group
- Intron decoration: donor flank + chevron-peaked dashed gap + acceptor flank, inside `<g class="vv-intron-decoration">` with `opacity: var(--vv-intron-scale)`
- ViewportController publishes per-exon-x and intron-scale CSS variables on the SVG root
- Default `styles.css` with variable declarations and transition rules
- Header rendering: gene symbol, transcript ID, strand, CDS length, MANE Select badge, AlphaFold link (when present)
- Playground scenario `paper-report.tsx` using a real lit-manager transcript dataset (committed as fixture)

**Definition of done:**
- Playground renders a recognisable gene schematic for a fixture transcript
- Side-by-side comparison with lit-manager's current rendering shows comparable visual weight at fit-gene zoom
- No interactivity yet

---

### Slice 4 — Variant track + interaction

Variants render and respond to host-driven hover/selection/click.

**In scope:**
- `variantTrack({ source })` factory; accepts a `DataSource<ViewportQuery, ViewerVariant[]>` or a static array
- Variant tick + dot rendering, coloured by `category`
- Wrap each variant in a `<g>` for transform-based hover lift; CSS transition on the wrapper
- `hoveredFeatureId`, `selectedFeatures` controlled props
- `onHover`, `onFeatureClick` callbacks
- Variant filter: tracks with `coordSystem: 'cds'` skip variants whose viewport projection returns null
- Unplaced-variants list rendered as a bottom track (or as a non-track region below the figure — decide and document)
- Playground scenario extends `paper-report.tsx` with variants from lit-manager fixture

**Definition of done:**
- Variants display on the gene at correct positions
- Hover over a row in a host-side table lifts the matching variant tick (controlled-prop demo)
- Click fires `onFeatureClick`; host can react
- Selection ring visible on selected variants

---

### Slice 5 — Pfam track + protein-range fragmentation

First track to exercise the range-projection-returns-segments machinery.

**In scope:**
- `projectProteinRange` implementation returning segments fragmented at exon boundaries
- `pfamTrack({})` factory
- Hue-keyed colour assignment via stable hash of `sourceId`
- Joined-rectangles rendering for ranges spanning multiple exons, with thin linker drawn above the dashed-gap polyline (replacing the current "rectangle spans the gap" behaviour)
- Centred labels with width-aware truncation (port `fitText` semantics from the current code)
- Label maximum-width budget bounded by half-distance to neighbouring rectangle midpoints
- Playground scenario `pfam-demo.tsx` with a multi-exon-spanning domain

**Definition of done:**
- Pfam annotations render at the same visual quality as lit-manager's current viewer
- Domains spanning intron boundaries fragment into joined rectangles with a visible linker
- Labels don't overflow into neighbouring domains' labels

---

### Slice 6 — InterPro track + groups + LeftGutter

Track groups and gutter slots come online together because they're co-dependent for IPR rendering.

**In scope:**
- `TrackGroup` type recognition in `LayoutEngine`
- Group label rendering owned by the layout engine (italic, vertically centred on group's y-extent)
- Lane packing primitive (`packLanes`) ported and exposed for any track that wants it
- `interProTrack({ groups })` factory; produces a `TrackGroup` containing one sub-track per entry-type
- `GeneGlyph.LeftGutter` slot mechanic: render-prop called once per visible track/group with `{id, kind, rect, ...}`
- Default-empty gutter (host has to opt in)
- Playground scenario shows IPR family/domain/repeat/HSF lanes with group labels in the gutter

**Definition of done:**
- InterPro lanes render at functional parity with lit-manager's current viewer
- Group labels appear in the left gutter
- Slot render-prop is called with correct rects for each item (tracks + groups)

---

### Slice 7 — Slot system completion

Header, Footer, and RightGutter; locks in the compound-component API.

**In scope:**
- `GeneGlyph.Header`, `GeneGlyph.Footer`, `GeneGlyph.RightGutter` as compound-component children
- Slot DOM structure: slots are siblings of the figure SVG in a flex column
- `width` (gutters) and `height` (header/footer) props for layout reservation
- Header/Footer accept React children; gutters accept render-prop
- Playground scenario with a custom header (mode dropdown placeholder + zoom controls placeholder) and a footer (placeholder text)

**Definition of done:**
- All four slots functional
- Figure SVG width adjusts when gutter widths change
- Export does not include slot content (test: `exportSVG()` output has no slot DOM)

---

### Slice 8 — Imperative ref API + basic fitTo

Hosts can drive viewport state programmatically without managing every prop.

**In scope:**
- `forwardRef` on `<GeneGlyph>`
- `GeneGlyphRef` interface implementing `fitTo`, `zoomBy`, `getViewportInfo`
- `fitTo({kind: 'gene'})`, `fitTo({kind: 'feature', trackId, featureId})` — uses `track.resolveAnchor` for features
- Implementations call `viewport.transitionTo(targetState)` which sets a `vv-transitioning` class, updates CSS variables, listens for `transitionend`
- Playground scenario with toolbar buttons: "Fit Gene", "Fit Variant X", "Zoom In"

**Definition of done:**
- Toolbar buttons trigger smooth animated viewport changes
- `getViewportInfo()` returns current state (also during animation — interpolated)
- Animation uses CSS transitions on `transform`, not rAF

---

### Slice 9 — Pan + zoom interaction handlers

Wire up the default interaction bindings; viewer becomes interactive.

**In scope:**
- Drag-to-pan handler: direct CSS-variable updates per pointer event, no transition
- Wheel-pan, Cmd/Ctrl+wheel-zoom handlers with cursor-anchored focal point
- Pinch-to-zoom (PointerEvents)
- Pan clamping to gene bounds + ~5% padding
- Zoom clamping to `[minZoom, maxZoom]`
- Keyboard handlers: `+/-/←/→/1/f`
- `interactionMode: 'standard' | 'embed' | 'fullscreen'` prop
- `viewportRange` controlled prop + `onViewportChange` callback
- `defaultViewportRange` for uncontrolled use
- Playground scenario demonstrating each gesture

**Definition of done:**
- All bindings from §7 of the design document work
- Pan and zoom feel smooth (no jank); direct manipulation has no transition; programmatic changes do
- `interactionMode: 'embed'` opts out of wheel-zoom

---

### Slice 10 — Smooth pan internals (stable geometry + viewport-only transforms)

Make pan / zoom / mode transitions actually glide. Slice 9 surfaced two related bugs that share a single root cause: **track geometry is recomputed against the current viewport range on every render**.

- During an animated `fitTo` / `zoomBy`, per-exon widths change because `pxPerBp` depends on the visible-bp total; the wrapping `.vv-exon-group` `<g>` slides via CSS transform while React snaps its children to new local coords mid-flight (the "content jumps inside the animated frame" symptom Slice 9 worked around by snapping keyboard pans).
- During a drag, `exon-track` clips each exon's CDS range to `[rangeLo, rangeHi]` and recomputes the rect width from the clipped endpoints. Edge exons reshape continuously instead of sliding off-figure (the "popping at the ends" symptom). The same `clipCdsToScreen` helper is mirrored in Pfam / InterPro tracks.
- `ViewportController.publish` compounds it by falling back to `xStart = 0` for fully-hidden exons, so as an exon transitions from partially visible to off-figure its `--vv-exon-x-{N}` snaps to the figure's left edge rather than continuing past it.

Both symptoms go away if geometry stops being viewport-dependent and clipping moves to the rendering layer.

**Strategy:**
1. **Baseline geometry per exon** — each exon owns a stable screen-x + width derived from a viewport-independent reference (fit-gene). Tracks render their features in that baseline frame; their rect `width` / `x` attributes don't change on pan or zoom.
2. **Viewport drives translate + scale only** — `ViewportController` publishes `--vv-exon-x-{N}` (current screen-x, including off-figure values) and `--vv-exon-scale-x-{N}` (current width ÷ baseline width). `placeInExonGroup` applies `transform: translateX(var(--vv-exon-x-N)) scaleX(var(--vv-exon-scale-x-N))`.
3. **Clip at the figure boundary, not at coordinates** — the figure SVG (or an inner `<g>`) clips via `clip-path` / `overflow: hidden`. Off-figure exons stay in the DOM and slide cleanly past the edge.

**In scope:**
- Refactor `cdsGeometry` / `ViewportController.publish` to emit `--vv-exon-x-{N}` and `--vv-exon-scale-x-{N}` for *every* exon (not just visible ones), with true off-figure values where appropriate.
- Update `placeInExonGroup` to apply both `translateX` and `scaleX`.
- Per-intron equivalent: `--vv-intron-x-{N}` already exists; add `--vv-intron-w-{N}` (or stable baseline gap) so intron polylines also follow the translate-only path.
- Remove `clipCdsToScreen`-style clamping from `exon-track`, `pfam-track`, `interpro-track`. Tracks compute baseline coordinates and trust the figure's clip.
- All strokes inside exon groups get `vector-effect="non-scaling-stroke"`.
- Pfam / InterPro labels apply a counter `scaleX(calc(1 / var(--vv-exon-scale-x-N)))` so text doesn't squish.
- Variant ticks + dots use non-scaling stroke; dots stay circular.
- Figure SVG gains `overflow: hidden` (or a `clip-path` on a single inner group) so off-figure content disappears cleanly.
- Remove the `vv-no-transition` override on keyboard pan/zoom from Slice 9 (no longer needed).
- Audit all track render functions: motion must be via wrapping `<g>` transform, never via SVG attribute interpolation.
- Playground smoke scenarios: drag the interaction-demo back and forth, eyeball that edge exons slide off cleanly with no rect-width pop; `fitTo` across the gene in `cds-with-introns` mode, eyeball that exons + introns + Pfam segments all slide together.
- New Playwright tests (per Slice 11 convention): assert that edge-exon `rect.vv-exon-rect[width]` is stable across drag-pan, and that `--vv-exon-x-{N}` for an off-figure exon takes a true off-figure value (not `0px`).

**Definition of done:**
- Drag-pan in the interaction-demo: no edge popping. Edge exons / Pfam rects / IPR rects slide off the figure cleanly.
- `fitTo`, `zoomBy`, mode transitions in `cds-with-introns` mode glide smoothly — no content snap inside the animation window.
- Pfam / InterPro labels stay readable at all zoom levels (no horizontal stretch/squish artifacts).
- Variant dots stay circular regardless of zoom.
- Keyboard pan animates smoothly without the `vv-no-transition` override.
- Off-figure exons have non-zero, true `--vv-exon-x-{N}` values; figure SVG clips them via `clip-path` / `overflow: hidden`.
- Playwright + unit tests cover both symptoms (no edge pop on drag; no content snap on transition).
- Animation + clipping discipline documented in `CONTRIBUTING.md`.

---

### Slice 11 — Playwright browser tests (backfill + going-forward)

JSDOM-only coverage misses the visual coordination the design relies on — CSS transitions, layout reflow under width changes, pinch gestures, intron-vs-exon animation alignment. Stand up Playwright so we can exercise the rendered playground, then backfill tests for every slice already on `main`.

**In scope:**
- Add `@playwright/test` as a workspace devDep + `playwright.config.ts` at the repo root (or under `apps/playground`) with a `webServer` block that starts `vite` and tears it down at end of run
- Browser bootstrap: `npx playwright install --with-deps chromium`
- Workspace script `npm run test:e2e`
- Tests under `tests/e2e/` (or `apps/playground/tests/`) backfilling each shipped slice's acceptance bar:
  - Slice 3 (paper-report renders, exons + intron decorations visible)
  - Slice 4 (variant hover lift, click selection ring)
  - Slice 5 (Pfam multi-exon domain shows a linker over the gap; labels truncate)
  - Slice 6 (InterPro group labels surface via the LeftGutter)
  - Slice 7 (Header / Footer / RightGutter slots render; figure SVG width adjusts to gutter widths)
  - Slice 8 (imperative `fitTo` + `zoomBy` via the GeneGlyphRef, viewport readout updates)
  - Slice 9 (drag-pan moves the gene under the cursor; wheel pans; Cmd/Ctrl+wheel zooms; keyboard `+ − ← → 1`; pan-limit fall-through)
  - Slice 10 (smooth-pan: capture screenshots mid-transition and assert exon + intron transforms move together; Pfam labels not stretched)
- Visual regression snapshots for canonical scenarios under `tests/e2e/__snapshots__/`
- CI workflow `.github/workflows/ci.yml` gains a `playwright` job that runs after the unit suite passes; uploads diff artifacts on failure
- `CONTRIBUTING.md`: how to update snapshots, how to run a single test, how to debug with `--headed`
- Future slices add at least one Playwright test as part of their acceptance bar (document this convention in `slices.md`)

**Definition of done:**
- `npm run test:e2e` passes locally and in CI
- Every shipped slice (3–10) has at least one Playwright assertion pinning its acceptance bar
- Visual regression snapshots committed for `paper-report`, `slot-system`, and `interaction-demo`
- CI Playwright job goes green on `main`

---

### Slice 12 — CSS-driven hover lift + selection feedback

Polish on per-feature micro-interactions; locks in the discipline of "all motion via `transform` on wrappers." (Previously Slice 10; now follows Slice 10 — smooth pan internals — and Slice 11 — Playwright backfill.)

> **Status: shipped.** Most of the substance landed incrementally in Slices 4, 9, and 10 — Slice 12 added the `[data-vv-reduce-motion]` simulation hook (mirrors the `@media (prefers-reduced-motion: reduce)` block), a playground checkbox that exercises it, and `slice-12-css-animation.spec.ts` pinning the four assertions below.

**In scope:**
- Re-audit track render functions after Slice 10 (which already lands part of this discipline) to ensure motion is via wrapping `<g>` transform, not via attribute interpolation
- Selection ring uses CSS opacity transition
- Hover lift uses CSS transform transition
- `prefers-reduced-motion` global rule in `styles.css` overriding all transitions to `none`
- Playground page can toggle a `prefers-reduced-motion: reduce` simulation for testing

**Definition of done:**
- Hover and selection animations work via CSS only (verified by performance profile — no JS during animation)
- Reduced-motion mode disables animations
- Animation discipline documented in CONTRIBUTING.md

---

## Phase 3: Cutover

### Slice 13 — Lit-manager adapter + cutover

Replace `GeneSchematic.tsx` in lit-manager with `<GeneGlyph>`.

> **Status: shipped.** lit-manager now renders gene schematics via
> `<GeneGlyph>`. The translation layer lives in
> `frontend/src/components/gene-glyph-adapter.ts` (lit-manager `GeneSchematic`
> → `Transcript`, `ProteinRecord` → `ProteinAnnotations`,
> `ExtractedVariantRecord` → `ViewerVariant`); a thin
> `GeneGlyphPanel.tsx` wraps the viewer with exon + variant + Pfam + InterPro
> tracks and the InterPro left-gutter group label. Variants without a
> parseable HGVS `c.` notation are mapped to a sentinel out-of-range CDS
> position so they bubble into the viewer's unplaced-variants list. The
> bespoke `GeneSchematic.tsx` is deleted. gene-glyph `1.0.0` published in
> tandem.

**In scope:**
- `frontend/src/components/gene-glyph-adapter.ts`: maps `ExtractedVariantRecord` → `ViewerVariant`, `ProteinRecord` → `ProteinAnnotations`, lit-manager's `GeneSchematic` type → `Transcript`
- Replace `<GeneSchematicView ...>` in `ReportsTabContent.tsx` (lines 302 and 413) with `<GeneGlyph ...>`
- Pass through `selectedVariantId`, `hoveredVariantId`, `onVariantClick` as controlled props / callbacks
- Visual verification on real paper-report pages
- Delete `frontend/src/components/GeneSchematic.tsx`
- Remove now-unused types if applicable
- Publish gene-glyph `1.0.0`

**Acceptance checklist** (from design doc §16):
- Exons + collapsed introns at fit-gene zoom
- AlphaFold link in header when protein record present
- MANE Select badge when applicable
- Strand + CDS-length info in header
- Pfam track: hue-keyed colours, centred labels
- InterPro grouped lanes, gutter group labels
- Variant ticks coloured by consequence
- Hover-lift, selection, click → `onFeatureClick`
- Unplaced-variants list
- Theme matches lit-manager light/dark

**Definition of done:**
- Lit-manager paper-reports page renders via gene-glyph with no visual regressions
- `GeneSchematic.tsx` deleted from lit-manager
- gene-glyph `1.0.0` published

---

## Phase 4: Post-cutover features

### Slice 14 — Mode transitions (CDS ↔ spliced ↔ protein)

The first feature the rewrite was for. Modes are viewport projections, not separate render paths.

**In scope:**
- `mode` controlled prop + `defaultMode` + `onModeChange`
- ViewportController interpolates `intronScale` and per-exon-x variables on mode change
- Intronic features (variants with `offset !== 0`, gnomAD variants projected to intronic genomic positions) opacity = `var(--vv-intron-scale)` in their CSS
- Per-exon-x variables updated to spliced positions when `mode !== 'cds-with-introns'`
- Axis-ruler labels cross-fade (CDS ↔ aa) via two overlapping `<text>` elements with opacity transitions
- Playground scenario with mode dropdown; switching animates smoothly

**Definition of done:**
- Mode switch animates over ~450ms with `ease-in-out-quart`
- No JS work runs during the animation (verify via performance profile)
- `transitionend` on the SVG root fires `onModeChange` callback completion

---

### Slice 15 — Hidden-feature indicators

Tracks that care surface counts of features dropped by current viewport.

**In scope:**
- Range projection's `droppedIntronicCount` + `droppedRanges` populated for all coord systems
- `exonTrack` renders hidden-feature marks on dashed-gap polylines: small chevron or tick with count
- Marks fade out when `intronScale === 1` and fade in when in spliced/protein mode
- Click on mark fires `onFeatureClick(trackId, '__hidden_intron_{N}_{M}')` — host decides what that means
- Playground scenario in spliced mode shows count indicators at intron boundaries

**Definition of done:**
- Hidden-feature indicators render as data marks (not chrome) at correct positions
- Indicators are export-clean
- Click fires the documented callback

---

### Slice 16 — Brush selection

Users can drag-select a range; tracks reflect the selection.

**In scope:**
- Shift+drag (or right-click drag) brush handler
- `brushRange` controlled prop + `onBrushChange`
- Brush rectangle drawn as an overlay (not a track)
- `interaction.brushRange` delivered to all track `render` calls
- Default behaviour: variant tracks render selection highlights for features intersecting brush
- Playground scenario: brush → host displays "selected N variants"

**Definition of done:**
- Brush works smoothly with no jank
- Host can use brushed range to drive its own UI
- "Zoom to selection" example via imperative `fitTo({kind: 'range', range: brushRange})`

---

### Slice 17 — Overlay layer

Tooltips, "you are here" markers, transient UI floating above tracks.

**In scope:**
- Overlay infrastructure: positioned absolutely in screen-space, layered above the figure SVG
- Anchored to `{kind, ...target}` — viewport resolves to `{x, y}`
- Default hover-tooltip implementation: pops up on hover of any focusable feature
- Tooltip content via `renderTooltip?: (feature) => ReactNode` prop
- Overlays are stripped at export (structurally — they live outside the figure SVG)
- Playground scenario shows hover tooltips on variants and ClinVar entries

**Definition of done:**
- Hover tooltips render at correct anchor points
- Overlays don't appear in exported SVG
- Reduced-motion respected for overlay fade

---

### Slice 18 — DataSource adapter pattern + async track loading

The infrastructure for pluggable backends.

**In scope:**
- `DataSource<TQuery, TResult>` interface
- Viewer-level debouncing of viewport changes (~120ms)
- Per-track `AbortController` and cancellation on viewport change
- Track loading state via `onTrackStateChange?: (id, state) => void`
- Default per-track loading affordance: subtle shimmer over track's y-range
- Caching: tracks share data if they share a `DataSource` instance (adapter owns its own cache)
- Stale data desaturation during debounce
- Playground scenario with a mock async data source demonstrating loading states

**Definition of done:**
- Async track loads work without blocking the rest of the viewer
- Cancellation works (no stale data races)
- Two tracks with the same `DataSource` instance share fetched data

---

### Slice 19 — Camera-ready export (SVG + PNG)

The "camera-ready vector graphics" goal lands.

**In scope:**
- `exportSVG(args?)` imperative method
- `exportPNG({widthPx, ...})` imperative method
- Print theme implementation: concrete hex values for all `--vv-*` vars; white bg; dark text; stronger strokes
- Theme override application
- Truncation `as-shown` vs `expand`
- Animation snap-to-target before serialise
- Painter export-mode: strip cursors, data-attrs, hover styles; add `<title>`, `<desc>`, XML namespace
- Self-rendering Google Fonts `@import` injected into `<defs><style>`
- Playground "Download SVG" + "Download PNG" buttons producing clean files
- Output validates: SVG opens correctly in Inkscape; PNG renders at exact `widthPx`

**Definition of done:**
- SVG export passes well-formedness check and opens in Inkscape with no visual drift
- PNG export at 2400px produces a high-quality figure suitable for a paper
- Print theme is visibly different from screen (white bg, deeper colours, heavier strokes)

---

### Slice 20 — Convenience chrome exports

Pre-built chrome components for hosts that don't want to write their own.

**In scope:**
- `DefaultTrackChevron({item, collapsed, onToggle})` — renders in `LeftGutter`
- `DefaultMinimap({viewerRef})` — renders in `Footer`; shows full-gene thumbnail with draggable window rectangle; drag pans the viewer; resize handles zoom
- Both built using only the public API (no privileged access)
- Playground scenario using both defaults

**Definition of done:**
- Hosts can drop in `<DefaultTrackChevron />` and `<DefaultMinimap />` and get functioning chrome with no extra code
- Both components honour `prefers-reduced-motion`

---

## Phase 5: New data tracks

These are independent of each other and can be grabbed in parallel after Slice 18.

### Slice 21 — ClinVar track

**In scope:**
- `clinVarTrack({source})` factory
- Density-clustering at low zoom: features within Npx of each other render as a cluster mark with count
- Cluster expansion via overlay (popover) on click
- `clinvar` data adapter: paginated NCBI fetch with caching by transcript+range
- Colour scheme by clinical significance (pathogenic / VUS / benign / etc.)
- Playground scenario with real ClinVar data for a fixture gene

**Definition of done:**
- ClinVar variants render correctly on the gene
- Cluster behaviour smooth across zoom levels
- Click on cluster shows expansion overlay

---

### Slice 22 — gnomAD track

**In scope:**
- `gnomADTrack({source, populations})` factory
- gnomAD GraphQL adapter
- Frequency rendering: dot height encodes MAF; colour by population
- Mode-respecting: intronic variants fade out in spliced mode
- Playground scenario with real gnomAD data

**Definition of done:**
- gnomAD variants display with population-aware encoding
- Mode transitions handle intronic gnomAD entries correctly
- Adapter respects gnomAD's rate limits and caches by query range

---

### Slice 23 — AlphaMissense track

**In scope:**
- `alphaMissenseTrack({source})` factory
- AlphaMissense per-position score adapter (bulk-fetch by transcript)
- Heatmap rendering across protein aa positions (one row, colour-mapped by score)
- coordSystem: 'protein' — track stays correctly positioned in all modes
- Playground scenario shows AM heatmap aligned with protein domains

**Definition of done:**
- AM heatmap renders aligned to protein axis
- Hover shows score; click selects position
- Heatmap is correctly aligned in CDS-with-introns mode (mapped through CDS)

---

### Slice 24 — MAVE track

**In scope:**
- `maveTrack({source})` factory
- MAVE database adapter (or local-file mode for unpublished datasets)
- Multi-row heatmap: aa positions × substitution amino acid; colour by score
- Optional collapse to single-row summary (heightPolicy: 'data-dependent')
- Playground scenario with a published MAVE dataset

**Definition of done:**
- MAVE heatmap renders with correct aa alignment
- Hover shows position + substitution + score
- Track collapsible to single-row summary

---

### Slice 25 — User annotation track

**In scope:**
- `userAnnotationTrack({store})` factory
- `store` is a host-provided interface: `{list(range), create(annotation), update(id, patch), delete(id), subscribe(callback)}`
- Annotation marks render as labelled bars at user-defined positions
- Editing UX: shift+click creates a new annotation at cursor position; click on existing annotation fires `onAnnotationClick` (host renders edit overlay)
- Optimistic updates: local store mutation applied immediately, network reconciliation via store subscription
- Playground scenario with localStorage-backed store

**Definition of done:**
- Users can create, edit, delete annotations
- Annotations persist (localStorage in playground; real backend in lit-manager)
- Optimistic UI feels responsive

---

### Slice 26 — Mini-map as standalone component + Overview track

Two final pieces of polish.

**In scope:**
- `DefaultMinimap` already exists from Slice 20; ensure it shares the imperative-ref machinery cleanly
- `overviewTrack({})` — alternative to footer minimap: a track that renders the full gene at fixed scale with a draggable viewport rectangle, embedded *inside* the figure SVG as a track (for hosts that want it in-figure rather than in chrome)
- Documentation comparing the two approaches and when to use each

**Definition of done:**
- Both options work
- Documentation makes clear the trade-off (overview track exports; minimap doesn't)

---

## Cross-cutting work (not slice-specific)

### Documentation
- `README.md` with install + minimal example + link to playground
- API reference auto-generated from TypeScript declarations
- Migration guide for lit-manager (referenced from Slice 13)
- CONTRIBUTING.md covering yalc workflow, animation discipline, painter abstraction rules

### CI / quality gates
- All slices keep CI green
- Visual regression snapshots updated as part of each slice's PR
- Bundle-size budget enforced post-Slice 13 (target: <50KB gzipped for the core lib)

### Versioning milestones
- `0.1.0` — after Slice 3 (first real render)
- `0.5.0` — after Slice 12 (parity render path complete, no cutover yet)
- `1.0.0` — Slice 13 (lit-manager cutover)
- `1.x` — subsequent slices (additive features, no breaking changes)

---

## Notes on parallelisation

- Slices 1–13 are mostly sequential (each builds on the previous render path).
- Slice 14 (mode transitions) blocks new tracks that need to respect modes (Slices 22, 23).
- Slices 18, 19, 20 unblock independent work.
- Slices 21–25 (data tracks) are all parallel after Slice 18.
- Slice 26 is a polish slice; can land any time after Slice 20.

A two-person team could split: one drives the render path (Slices 1–13), the other follows behind with infrastructure (Slices 16–20) and then peels off data tracks in parallel.
