# gene-glyph — Implementation Slices

Tracer-bullet vertical slices ordered to deliver visible value incrementally. Each slice ends with a runnable demonstration in `apps/playground` and a defined acceptance bar.

Slices 1–20 deliver the cutover-ready package. Slices 21–27 deliver the post-cutover feature wishlist.

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

### Slice 14 — Mode transitions (CDS ↔ spliced ↔ protein) — **shipped**

The first feature the rewrite was for. Modes are viewport projections, not separate render paths.

**Landed:**
- `mode` controlled prop + `defaultMode` + `onModeChange` on `<GeneGlyph>`
- ViewportController persists across mode changes (no longer reconstructed on the `mode` dep); `setMode` reprojects the visible range through the ruler (CDS bp ↔ aa) so the gene window is preserved, and republishes per-exon-x / intron-scale CSS variables
- Intronic features rendered inside the painter's `placeInInterExon` group continue to fade via `opacity: var(--vv-intron-scale)` — the Pfam/IPR linkers and exon-track chevrons already use this; new intronic-feature tracks pick it up for free
- `.vv-mode-transitioning` class toggles for 450ms after a mode change, overriding the always-on 350ms `ease-out-quart` curve on `.vv-exon-group` / `.vv-intron-decoration` with a symmetrical `ease-in-out-quart` curve (design §8)
- Mode + class are applied in the same `useLayoutEffect` so the variable change and the curve override land in one paint — splitting them across two paints lets the var change fire the transition with the pan/zoom curve first
- Reduced-motion override extended to zero the new mode-transitioning rules too
- Playground slot-system scenario's mode dropdown is now live; Playwright spec `slice-14-mode-transitions.spec.ts` pins the acceptance bar

**Deferred:**
- Axis-ruler labels (CDS ↔ aa cross-fade via two overlapping `<text>` elements) — the axis-ruler track doesn't exist yet and the `<GeneGlyphHeader>` already shows CDS length; revisit when an axis-ruler track lands

**Definition of done:**
- Mode switch animates over ~450ms with `ease-in-out-quart` ✓
- No JS work runs during the animation (visual interpolation handled by CSS transitions on per-exon transforms; viewport publishes the target values once on mode change) ✓
- `onModeChange` fires after every committed mode change ✓

---

### Slice 15 — Hidden-feature indicators — **shipped**

Tracks that care surface counts of features dropped by current viewport.

**Landed:**
- `projectCdsRange` / `projectProteinRange` now report `droppedIntronicCount` + intronic `droppedRanges` for every consecutive exon pair the range crosses — matching `projectGenomicRange`. `DroppedRange.intronic` carries `{exonIdxA, exonIdxB}` (was the ambiguous `near.exonIdx`) so aggregators can key by gap without disambiguating sides
- New optional `Track.hiddenFeaturesByIntron(args)` contract: tracks return `HiddenFeatureBucket[]` (per-gap counts + optional feature ids). The viewer aggregates across every track once per render and surfaces totals via `TrackRenderArgs.hiddenByIntron` so a single track (the exon track by default) renders one indicator per gap rather than each track stacking its own
- `variantTrack` implements `hiddenFeaturesByIntron`; helper `variantIntronGap` exported for hosts that want to map intronic variants to their gap
- `exonTrack` paints a small pill+count badge per intron via a new `.vv-hidden-feature-mark` group, anchored to `--vv-intron-x-{N}` (so it slides with the gap) but at constant pixel size (the inter-exon `<g>` collapses to width 0 in spliced/protein). Opacity is `calc(1 - var(--vv-intron-scale))`, so the badge cross-fades opposite the polyline; the badge inherits the slice-12 transition curves and the mode-transitioning override
- Click on a badge fires `onFeatureClick(trackId, '__hidden_intron_{exonIdxA}_{exonIdxB}')`; bucket `featureIds` are aggregated so hosts can pop a list from the click. Reduced-motion override extended to zero badge transitions
- Playground `slot-system` scenario surfaces a click readout in the footer; Playwright spec `slice-15-hidden-features.spec.ts` pins the acceptance bar (badge fades in on `cds-spliced`, click fires with the documented id, badge lives inside the figure SVG for export-cleanness)

**Definition of done:**
- Hidden-feature indicators render as data marks (not chrome) at correct positions ✓
- Indicators are export-clean (live inside the figure SVG) ✓
- Click fires the documented callback ✓

---

### Slice 16 — Brush selection — **shipped**

Users can drag-select a range; tracks reflect the selection.

**Landed:**
- Shift+drag (or secondary-button drag) brush gesture in `useViewportInteractions`. The hook reads `shiftKey` / `button === 2` off the native PointerEvent before falling through to the drag/pinch path; `onContextMenu` suppresses the native menu only while a brush is in flight so right-click elsewhere keeps its default
- `brushRange` controlled prop on `<GeneGlyph>` (+ uncontrolled `defaultBrushRange` and `onBrushChange`); `interaction.brushRange` reaches every track `render` via the existing `TrackRenderArgs.interaction` channel
- Brush overlay rendered inside the figure SVG (export-clean) using `viewport.projectCdsRange` / `projectProteinRange`. Each touched exon contributes a rect inside `painter.placeInExonGroup` so the brush rides the live pan/zoom transform; cds-with-introns mode also fills intervening gaps via `placeInInterExon` so the brush reads as one continuous strip
- `variantTrack` paints an `is-in-brush` ring on every variant whose ruler position falls inside the brush range; helper `variantRulerPos` exported for hosts that want to mirror the same membership test (the slot-system scenario uses it for its "Selected N variants" readout)
- `GeneGlyphRef.fitTo({ kind: 'selection' })` reads the active brush range and zooms to it (clamped to natural bounds)
- Playground `slot-system` scenario surfaces the readout and a "Selection" zoom button; Playwright spec `slice-16-brush.spec.ts` pins the acceptance bar (brush rect renders, host count updates, shift-click clears, fitTo selection zooms)

**Definition of done:**
- Brush works smoothly with no jank ✓
- Host can use brushed range to drive its own UI ✓
- "Zoom to selection" example via imperative `fitTo({kind: 'selection'})` ✓

---

### Slice 17 — Overlay layer — **shipped**

Tooltips, "you are here" markers, transient UI floating above tracks.

**Landed:**
- `.vv-figure-wrap` wraps the figure SVG inside the existing `.vv-figure-row`; the overlay layer (`<div class="vv-overlay-layer" data-testid="gene-glyph-overlay-layer">`) is a DOM sibling of the SVG inside the wrap so `exportSVG()` (Slice 19) can serialise the figure cleanly. `pointer-events: none` on the layer keeps overlays hit-test-transparent unless an individual overlay opts in
- Tooltip target tracked in `<GeneGlyph>` from the existing `onFeatureHover` channel — independent of the controlled `hoveredFeatureId` prop so a host that drives hover state from a table row still gets working tooltips. An rAF loop converts the track's `resolveAnchor` (viewBox-x) into client px via `SVGSVGElement.getScreenCTM()` so the tooltip rides smoothly through pan/zoom transitions
- `renderTooltip?: (args: TooltipRenderArgs) => ReactNode | null` prop on `<GeneGlyph>`. `args.feature` is the track-resolved object via the new `Track.resolveFeature?` hook (variant/Pfam/InterPro each implement it); returning `null` suppresses the tooltip for a specific feature without disabling the system. ClinVar (Slice 21) inherits tooltip support automatically once it implements `resolveAnchor` / `resolveFeature` / `featureLabel`
- Default tooltip — when `renderTooltip` is omitted — renders the string returned by `Track.featureLabel?(data, featureId)`. Variant track returns `v.label`; Pfam/InterPro return `${shortName} (aaStart–aaEnd)`. Tracks that omit the hook simply suppress the default tooltip
- Tooltip CSS lives at the root of `styles.css`: 100ms `ease-out` fade-in keyframes per design §8. `[data-vv-reduce-motion]` and `@media (prefers-reduced-motion: reduce)` both snap to `opacity: 1` with `animation: none`
- Playground `TooltipDemoScenario` exercises variants + Pfam + InterPro on TP53; a checkbox swaps between the default label tooltip and a custom renderer that pulls richer detail off the resolved feature
- Playwright spec `slice-17-overlay.spec.ts` pins the contract (overlay is a sibling of the SVG, host renderer surfaces category, default renderer falls back to label, reduced-motion snaps fade). Unit spec `viewer-overlay.test.tsx` covers the same surface in JSDOM (with stubbed `getScreenCTM`)

**Definition of done:**
- Hover tooltips render at correct anchor points ✓
- Overlays don't appear in exported SVG (structurally outside the figure SVG) ✓
- Reduced-motion respected for overlay fade ✓

---

### Slice 18 — DataSource adapter pattern + async track loading — **shipped**

The infrastructure for pluggable backends.

**Landed:**
- `DataSource<TQuery, TResult>` interface (from Slice 2) is now the front door for async track data. `createCachedDataSource({id, cacheKey, query, freshness?, maxEntries?})` wraps a user `query` with an LRU cache keyed by `cacheKey` — two tracks given the same returned instance auto-share fetched data; the second call resolves from cache without re-running `query`. Failures evict so a subsequent caller can retry. Per-call `signal` aborts the *waiter*, not the shared underlying fetch, so one caller cancelling doesn't strand a peer
- Viewer fans loads out per track instead of one shared `Promise.all`, so a slow async source doesn't block fast tracks from rendering. Each track owns its own `AbortController`; viewport-driven re-loads cancel only that track's in-flight request rather than bouncing the whole stack
- Per-track lifecycle reported via `onTrackStateChange?: (trackId, state) => void` where `state` is `'loading' | 'ready' | 'error'`. `TrackLoadState` is exported from the package root
- Viewport range/mode changes mark the viewer `data-vv-stale=""` immediately, then debounce `track.load()` by `loadDebounceMs` (default 120ms; design §6.2). CSS desaturates feature glyphs (`saturate(0.5)` + `opacity 0.75`) during the stale window so the user sees that the displayed data is about to change. The debounce timer cancels on every new viewport change
- Default loading affordance: an SVG `<rect class="vv-loading-shimmer">` over each loading track's y-range with a 1200ms ease-in-out pulse. A 150ms `animation-delay` hides the shimmer for sub-frame loads (so synchronous tracks never flash), and the reduced-motion override snaps to a static muted fill. Shimmer rects carry `data-testid="gene-glyph-shimmer-${trackId}"` for spec-pinning
- New playground scenario `AsyncDataSourceScenario` exposes a configurable network delay, a query counter, and `onTrackStateChange` readouts for two variant tracks sharing one `createCachedDataSource` instance. The query counter makes the cache hit visible at a glance — one query per unique `(mode, range)` tuple, regardless of how many tracks consume the source
- Playwright spec `slice-18-async-loading.spec.ts` pins the contract (shimmer rect appears during load and clears once data resolves, two-track shared-source dedup, `data-vv-stale` toggling). Unit specs: `data-source.test.ts` covers cache sharing, no-cache-on-failure, abort-isolation, and LRU eviction; `viewer.test.tsx` adds Slice 18 cases for `onTrackStateChange` lifecycle, shimmer presence, stale-flag toggling, and shared-source single-call

**Definition of done:**
- Async track loads work without blocking the rest of the viewer ✓
- Cancellation works (no stale data races) ✓
- Two tracks with the same `DataSource` instance share fetched data ✓

---

### Slice 19 — Camera-ready export (SVG + PNG) — **shipped**

The "camera-ready vector graphics" goal lands.

**Landed:**
- `exportSVG(args?)` / `exportPNG({widthPx, ...})` on `GeneGlyphRef`. Both produce a self-contained file with no dependency on `@populationgenomics/gene-glyph/styles.css` — opens cleanly in Inkscape or Illustrator
- Implementation in `packages/gene-glyph/src/export.ts`: clones the live figure SVG into a hidden wrapper styled with the host's `gene-glyph` class so the CSS cascade resolves, then walks the tree to bake `getComputedStyle()` values back into SVG presentation attributes. Two-pass walk preserves the root's inline CSS variables (`--vv-exon-x-{N}` etc.) while children's transforms are read, then strips them
- Print theme on `[data-vv-print] .gene-glyph` (and the `[data-vv-print] .gene-glyph .vv-exon-rect` / `.vv-pfam-rect` / `.vv-interpro-rect` / `.vv-intron-polyline` stroke-uplift rules): white background, deeper category colours, heavier strokes, transitions zeroed so computed values land on the target frame. `theme: 'print'` (default) or `'current'`
- CSS-variable transforms (`translateX(var(--vv-exon-x-0)) scaleX(var(--vv-exon-scale-x-0, 1))`) collapse to concrete `transform="matrix(a b c d e f)"` SVG attributes. `var()` references survive nowhere in the output
- Painter export-mode discipline applied at serialise time, not draw time — `data-*` hooks, `class` hooks, `tabindex` / `role` on interior nodes, `onclick` handlers, `vv-loading-shimmer` rects, and the inline `style` (including the cursor: pointer hooks variant track sets) all stripped. Root keeps `role="img"` / `aria-label` / `viewBox` / `preserveAspectRatio`
- `<title>` + `<desc>` injected at the front of the SVG; default text is `${geneSymbol} (${transcriptId}) — ${aaLength} aa` and `gene-glyph figure of ${geneSymbol} (${transcriptId}); view mode ${mode}.`. Hosts override via `args.ariaLabel` / `args.description`
- `<defs><style>@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');</style></defs>` injected by default so the SVG self-renders Inter when opened in a browser. `fontImport: 'none'` disables for hosts shipping their own font story
- Background rect painted as the first non-meta child when the figure's computed `background-color` resolves to a real colour (the print theme white). Without it the standalone SVG would carry the print colours but lose the white background once stripped of `vv-color-bg-surface`
- `exportPNG` rasterises the SVG via a hidden `<img>` + canvas. `widthPx` is the only resolution control (height derives from viewBox aspect); a white fillRect under `drawImage` avoids the journal-layout grey-on-transparent quirk
- Truncation arg (`'as-shown'` / `'expand'`) accepted on the surface API for forward compatibility — every currently-shipped track reports `didTruncate: false` so the two paths produce identical output today; the branch lights up when a truncating track lands (Slice 24 MAVE-heatmap is the likely first)
- Playground `ExportDemoScenario` exposes Download SVG / Download PNG buttons, theme picker, and a PNG-width input; the hidden Preview button stashes the latest SVG into the DOM so the Playwright spec can read it without intercepting downloads. Playwright spec `slice-19-export.spec.ts` pins (a) well-formedness + XML preamble + namespace + title/desc + Google Fonts + no `var()` leak + no `data-*` leak, (b) print vs current theme differ and print paints white, (c) per-exon transforms serialise as concrete `matrix(...)` attributes, (d) `exportPNG` produces a non-empty Blob at the requested width. Unit spec `export.test.ts` covers the structural surface JSDOM can verify (namespace, title/desc injection, data-* / class stripping, width derivation, font-import toggle, root-aria preservation)

**Definition of done:**
- SVG export passes well-formedness check and opens in Inkscape with no visual drift ✓
- PNG export at 2400px produces a high-quality figure suitable for a paper ✓ (widthPx routes through canvas at user-specified resolution; white background painted in)
- Print theme is visibly different from screen (white bg, deeper colours, heavier strokes) ✓

---

### Slice 20 — Convenience chrome exports — **shipped**

Pre-built chrome components for hosts that don't want to write their own.

**Landed:**
- `DefaultTrackChevron({item, collapsed, onToggle, label?})` in `packages/gene-glyph/src/chrome/default-track-chevron.tsx`. Pure presentational: renders a chevron button with the item's label, `aria-expanded` mirrors the `collapsed` prop, and the icon rotates 90° between states via a CSS transition zeroed out under `prefers-reduced-motion` / `[data-vv-reduce-motion]`. The host owns the collapse state and the matching `tracks` edit — the chevron has no opinion about what "collapsed" means
- `DefaultMinimap({viewerRef, width?, height?})` in `packages/gene-glyph/src/chrome/default-minimap.tsx`. Renders a full-gene SVG thumbnail (exons at the active mode's baseline, polylines across collapsed introns) with a draggable window rectangle and two edge handles. Drag the window → pan; drag a handle → zoom; click the background → jump to that location centred on the click. Polls viewer state via rAF on `getViewportInfo()` and writes back via the imperative `fitTo`
- `fitTo(target, options?)` and `zoomBy(factor, options?)` on `GeneGlyphRef` accept `{ animate?: boolean }`. `animate: false` skips the 350ms CSS transition (toggles `vv-no-transition` and runs the viewport `transitionTo` with `duration: 0`). DefaultMinimap drag/handle gestures use `animate: false` so the figure tracks the cursor in real time; click-to-jump uses the default animated path so reduced-motion handling stays consistent with the rest of the public API
- `ViewportInfo` gains `naturalRange` + `transcript` so chrome built on the ref can render the full-gene context without the host having to thread the transcript separately. `<DefaultMinimap>`'s only prop is `viewerRef`
- Built using only the public ref API and the slot system — no privileged access into `ViewportController` or layout internals
- Playground `DefaultChromeScenario` lives between async-data and export-demo; it puts chevrons on the variants / Pfam / InterPro entries and a minimap in the footer. The scenario demonstrates the host-side "collapse to stub" pattern: when collapsed, a fresh `Track` with the same id is mounted in place of the real track, returning shape-compatible empty data (`{variants: []}`, `{domains: []}`) and rendering nothing. Without the shape match, re-expand briefly renders the real track against the stub's data and crashes — the demo highlights why this matters
- Playwright spec `slice-20-default-chrome.spec.ts`: (a) chevron collapse hides the figure-side render; (b) chevron re-expand restores `aria-expanded='true'`; (c) minimap renders one rect per exon plus a window rect; (d) clicking the minimap background jumps the figure right; (e) dragging the window pans the figure; (f) dragging the right edge handle zooms in. Unit tests in `default-track-chevron.test.tsx` and `default-minimap.test.tsx` cover the chevron's toggle wiring and the minimap's structural surface (exon rects, handles, transcript-derived aria-label)

**Definition of done:**
- Hosts can drop in `<DefaultTrackChevron />` and `<DefaultMinimap />` and get functioning chrome with no extra code ✓
- Both components honour `prefers-reduced-motion` ✓ (chevron rotation transition + minimap click-to-jump's underlying `fitTo` both fall through to the shared CSS reduced-motion rules; the minimap intentionally adds no animations of its own that could bypass them)

---

## Phase 5: New data tracks

These are independent of each other and can be grabbed in parallel after Slice 18.

### Slice 21 — ClinVar track — **shipped**

**Landed:**
- `clinVarTrack({source, clusterPx?, height?, markRadius?})` in `packages/gene-glyph/src/tracks/clinvar-track.tsx`. `source` accepts either a static `ClinVarRecord[]` (curated fixtures, paper-report workflows) or a `DataSource<ViewportQuery, ClinVarRecord[]>` (live NCBI adapter or any host implementation). Records are projected through the host's `CoordinateMapper`; UTR / intergenic / intronic records fall to the unplaced bucket and never appear on the ribbon
- Density clustering via `clusterClinVar(placed, clusterPx)`: project each placement to live screen-x, sort, greedy-merge runs whose neighbour distance is below the threshold (default 14px). Clustering uses *live* screen-x so the user-visible density changes with zoom — fit-gene produces broad clusters around the R175/R248/R273/R282 hotspots, zooming into the DNA-binding domain breaks them apart. Singleton clusters render as a circle + tick (variant-track style); multi-member clusters render as a diamond with a member-count badge. Counter-scaling inside the exon group keeps both shapes circular regardless of the parent exon's scaleX
- Cluster fill colours by the strongest clinical significance present in the cluster (`pathogenic > likely_pathogenic > conflicting > VUS > likely_benign > benign > other`). Each bucket exposes a `--vv-clinvar-color-*` CSS variable so hosts can retheme without recompiling. `parseClinVarSignificance` normalises the multi-spelling upstream strings ("Pathogenic/Likely pathogenic", "Conflicting interpretations of pathogenicity", etc.) into the bucket on the way in
- Click-to-expand popover: clicking a multi-member cluster opens an in-figure popover listing every member sorted by significance; clicking a row fires the host's `onFeatureClick(memberId, 'clinvar')` and dismisses; clicking the figure-wide backdrop dismisses without firing. The popover anchors *above* the cluster's track with `popY = max(0, rect.yTop - innerH - 6)` so it stays inside the figure SVG even when ClinVar is the bottommost track — overflow:hidden on the figure SVG would otherwise clip a below-track popover and silently break hit-testing. Singleton marks bypass the popover and fire `onFeatureClick` directly
- `createClinVarDataSource({transcript, baseUrl?, pageSize?, fetchImpl?})` in `packages/gene-glyph/src/adapters/clinvar.ts`. Pages through NCBI eutils `esearch` (`{geneSymbol}[gene]`) and batches `esummary` calls at `pageSize` records each, parsing into `ClinVarRecord` with chromosome filtering against the transcript. The adapter wraps `createCachedDataSource` keyed by `transcript.transcriptId` — ClinVar data is gene-scoped, so mode and range changes never re-fetch. `fetchImpl` is injectable for tests and host-side proxying
- Playground `ClinVarDemoScenario` uses a curated `TP53_CLINVAR` fixture (real R-codon hotspot accessions, GRCh38 coordinates) so the e2e tests stay offline; production hosts wire `createClinVarDataSource` directly. The scenario also exercises the existing tooltip path (`renderTooltip` reads `Track.resolveFeature` for ClinVar records — no special-casing needed)
- Tooltip integration is automatic via `resolveAnchor` / `resolveFeature` / `featureLabel` (the contract foreshadowed in Slice 17). Hosts that don't supply a custom `renderTooltip` get the built-in label `"c.524G>A (Pathogenic) — Li-Fraumeni syndrome"`
- Unit tests in `clinvar-track.test.tsx` cover placement, clustering threshold behaviour at two zoom levels, dominant-significance pick, popover open/close, member-click firing, backdrop dismissal, and the significance parser. Adapter tests in `adapters/clinvar.test.ts` mock `fetch` to verify esearch pagination, esummary parsing, transcript-chromosome filtering, and the cacheKey-based skip on repeat queries. Playwright spec `slice-21-clinvar.spec.ts`: cluster renders with pathogenic colour, click opens popover with multiple rows, row click fires host callback + closes popover + updates last-clicked readout, backdrop click dismisses, deep zoom breaks the cluster apart

**Definition of done:**
- ClinVar variants render correctly on the gene ✓
- Cluster behaviour smooth across zoom levels ✓ (density threshold is in live screen-x so zoom changes density without re-coding the clustering pass)
- Click on cluster shows expansion overlay ✓ (popover anchored above the track, dismisses via member-click or backdrop)

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

### Slice 26 — Mini-map as standalone component + Overview track — **shipped**

**Landed:**
- `DefaultMinimap` from Slice 20 already takes the same `viewerRef: RefObject<GeneGlyphRef | null>` plus rAF poll on `getViewportInfo()` and `fitTo({ kind: 'range', range }, { animate: false })` write-back as the new overview track — the ref-machinery is shared by construction; the two components only differ on coordinate frame (minimap creates its own mini `ViewportController` scoped to its rendered width, overview shares the embedding figure's viewport)
- `overviewTrack({ viewerRef, height?, handlePx? })` — drop-in row of the track stack that draws the full gene at fit-gene scale across the figure width plus a draggable window rectangle, edge handles, and click-to-jump background. Lives inside the figure SVG, so `exportSVG()` / `exportPNG()` carry it
- The overview is a **wholly display-space artifact** built on its own mini-`ViewportController` pinned to fit-gene at the figure's width — it never reads the live figure's CSS-variable transforms, just the visible CDS range from `getViewportInfo()`. The window rectangle's position is pure `miniViewport.cdsToBaselineX(range[0..1])` math: linear in CDS bp (modulo the standard fit-gene gap layout), decoupled from the figure's "gaps don't scale" zoom quirks
- New `Track.renderMinimap?({ width, height, viewport, mapper, painter }): ReactNode | null` hook on the public `Track` interface. Tracks that have a meaningful thumbnail (the exon track ships with one out of the box) opt in; tracks without it are skipped silently. The overview track takes a `tracks: Track[]` config — typically the same tracks the host passes to `<GeneGlyph>` — and stacks each upstream track's `renderMinimap` output as one row inside its band. The host can pass a subset to show only some tracks in the minimap
- `Viewport.naturalRange()` and `Viewport.baselineXToRuler()` are now public on the `Viewport` interface (both were previously only on `ViewportController`). Minimap-side coord conversions (drag math, range clamping) reach for these via the public interface rather than the controller subclass
- Playground scenario `OverviewTrackDemoScenario` stacks the two widgets in a single section so a reader can drag both and compare; Playwright spec `slice-26-overview-track.spec.ts` covers pan / zoom / click-to-jump and asserts the overview's window rect is present in the figure SVG's serialised markup

**Resolved design questions:**
- *Trade-off between the two:* the overview occupies one row of the track stack and counts against `trackHeightBudget`; the minimap sits outside the stack (in the Footer slot) and adds its own height below the figure. Hosts pick the overview when the export needs to carry navigation context — figure-in-a-paper, where readers benefit from seeing the zoom window — and pick the minimap when only the figure body should land in the rasterised image. The contract is otherwise identical (drag-window-to-pan, drag-handle-to-zoom, click-background-to-jump)
- *Event isolation:* the overview's window rect and handles call `stopPropagation` on pointer-down so the figure SVG's drag-to-pan doesn't double-count the gesture. Pointermove / pointerup listeners are attached to `window` for the duration of a drag so the user can release outside the figure cleanly. The figure SVG element is captured at drag-start (in `dragRef.svg`) rather than re-derived from `event.target.ownerSVGElement` — window-level pointermoves fire on elements outside the figure where `ownerSVGElement` is null, which would otherwise collapse `clientToFigureX` to zero and freeze the gesture mid-drag

- *Window rectangle clipping:* the rect is clipped to the overview's `[0, width]` band rather than allowed to extend past the figure. When the user pans past the gene's 3' end, the raw window range extends past `width` (the mini-viewport's `cdsToBaselineX` extrapolates linearly past the last exon); without clipping, the rect's bounding box reports as off-figure and subsequent pointerdowns aimed at it miss because the visible portion has a different bounding box than the rendered rect

- *Why pure display-space:* an earlier iteration tried to read the figure's *actually-visible* baseline range via `screenToBaselineX(0)` / `screenToBaselineX(width)` so the rectangle would mirror the figure's gap-correction transforms. Direct user feedback ("the minimap should be a wholly display-space artifact"): coupling the minimap's coordinate system to the figure's rendering details is the wrong abstraction. The minimap operates on its own coordinate system and reports the *logical* CDS range; the figure's rendering quirks (gaps don't scale, partial-exon edges) belong to the figure, not the minimap
- *Coordinate math:* `clientToFigureX` prefers `getScreenCTM` for accurate mapping under aspect-ratio letterboxing, with a `getBoundingClientRect` ratio fallback for JSDOM (and any browser that returns a null CTM)

**Definition of done:**
- Both options work ✓
- Documentation makes clear the trade-off (overview track exports; minimap doesn't) ✓

---

### Slice 27 — Stacked variant view (Decipher-style) — **shipped**

**Landed:**
- `SymbolEncoding<T>` in `packages/gene-glyph/src/symbol-encoding.ts` describes the host-supplied mapping from feature → `{shape, fill, color?, lane?, radius?}`. `glyphPath(shape, r)` emits SVG path data for eight shapes (`circle`, `square`, `triangle-up`, `triangle-down`, `diamond`, `pentagon`, `cross`, `bar`), each inscribed in a circle of radius `r` so encodings can swap shape without resizing. Counter-scale wrappers (the same trick the variant dot uses) keep glyphs regular under per-exon scaleX. Default encodings ship for `ViewerVariant` (shape ← category, lane ← LoF / missense / synonymous / regulatory) and `ClinVarRecord` (shape ← clinical significance, lane ← path / vus / benign / conflicting)
- `variantTrack({ stackedVariantStyle })` and `clinVarTrack({ stackedVariantStyle })` flip into stacked mode. Both run their packing in `load()` so `height()` and `render()` agree on row count without re-projecting. `heightPolicy` becomes `'data-dependent'` only when stacked — the existing tick+dot and density-cluster paths stay `'fixed'`, so no consumer breaks. Hover lift, selection ring, and brush-in reuse the existing `vv-variant-*` / `vv-clinvar-*` interaction classes
- `packStackedVariants` / `packStackedClinVar` group placements by `encoding.lane()`, sort each group by baseline (fit-gene) screen-x, then greedy-assign each placement to the lowest local row whose previous occupant has cleared. Strict lane separation: items with different `lane()` keys never share a row. Packing uses *baseline* x (not live screen-x) so the row count is stable across pan and zoom — deep zoom only spreads glyphs apart
- Playground `StackedVariantsDemoScenario` shows the dense fixture (`TP53_DENSE_VARIANTS`, 60+ seeded synthetic entries with hotspot piles around codons 175 / 248 / 273) side-by-side in both styles, plus a third figure rendering the existing TP53 ClinVar fixture in stacked mode. Hosts can compare densities; the dense fixture is deterministic so visual snapshots and Playwright counts don't drift
- Playwright spec `slice-27-stacked-variants.spec.ts` pins: glyph-count parity between the two styles, ≥ 4 rows at hotspot positions, click-through wiring, and the ClinVar suppress-clustering invariant. Unit tests in `symbol-encoding.test.ts`, `variant-track.test.tsx`, and `clinvar-track.test.tsx` cover lane grouping, glyph paths, height growth, and stacked rendering

**Resolved design questions:**
- *Stack direction:* downward from the track top. Row 0 sits at `rect.yTop + topPad + r`; subsequent rows step downward by `2 * markRadius + 2`. The variant track sits below the exon track, so growing downward keeps the ribbon at the top edge and pushes deeper stacks away from it
- *Lane gap:* content-derived. Defaults to `2 * markRadius + 2` (glyph diameter + 2 px breathing room); host can override via `stackLanePx`
- *Cross-lane horizontal collisions:* lane separation is strict. Items with different `lane()` keys occupy disjoint row blocks even when their baseline-x positions don't overlap, so each row reads as a single category
- *ClinVar interaction:* stacked mode **suppresses** density-clustering. The whole point of stacking is to show every variant; clustering would defeat the purpose. Hosts that want both can use the default (cluster) style and switch on zoom
- *Brush range overlay:* per-glyph ring (reuses the existing `is-in-brush` CSS). A full-column highlight would conflict with hover-lift and selection-ring affordances

**Definition of done:**
- Both render styles available with no breaking changes to existing hosts ✓
- Stacked render handles 50+ variants in one viewport without occluding the exon ribbon ✓ (`TP53_DENSE_VARIANTS` fixture)
- Encoding API documented with worked defaults for `ViewerVariant` and `ClinVarRecord` ✓
- Playground side-by-side demonstrates the visual trade-off ✓

---

### Slice 28 — Coordinate ruler track — **shipped**

**Landed:**
- `scaleTrack({})` in `packages/gene-glyph/src/tracks/scale-track.tsx` — a fixed-height track that renders major + minor tick marks plus labels above the gene body. The host adds it to the `tracks` array (typically first) and the layout engine slots it directly above whatever comes next; no viewer or chrome changes required
- Mode-aware: CDS modes label in `bp`, protein mode labels in `aa`. Switching modes flips the ruler in lock-step with the figure's mode transition (same 450 ms ease-in-out-quart) because ticks ride per-exon CSS transforms
- Nice-number step picker exposed as `pickAutoStep(pxPerUnit, minSpacingPx, rulerLength)`. The ladder is `[1, 2, 5, 10, 20, 50, 100, …, 1_000_000]`; the picker promotes one rung at a time until the minimum on-screen label gap is satisfied, with a downward demotion path for pathologically short genes. Hosts can override with a literal `majorStep` (e.g. force every-100-bp ticks)
- Step calculation reads `viewport.baselineGeometry().pxPerBp` — fit-gene px-per-unit — *not* the live zoom. Tick steps therefore stay stable as the user zooms; the figure's CSS transforms move the ticks rather than the React tree re-emitting them, so there's no flicker
- Minor subdivisions (default 5 per major step) drawn shorter and unlabelled; `unitSuffix: 'last'` (default) appends the active unit to the highest visible label so the ruler reads as `… 1,150 bp` / `… 380 aa`
- Slot-system playground scenario picks up the ruler so the mode dropdown's effect on the figure is mirrored in the ruler row. Playwright spec `slice-28-scale-track.spec.ts` pins major-tick count, the unit-suffix invariant, the bp↔aa flip on mode change, and the per-exon-group invariant (every tick lives inside a `vv-exon-group`)

**Resolved design questions:**
- *Where does the ruler live?* As a `Track` rather than a chrome slot. Lets the existing layout engine + per-exon CSS-variable machinery do all the heavy lifting — pan, zoom, and mode transitions come for free, and the ruler is included in `exportSVG()` / `exportPNG()` automatically
- *Tick step against fit-gene or live zoom?* Fit-gene. Live-zoom-driven step would repop labels in/out on every wheel tick, which reads as flicker. The current behaviour mirrors how typical map UIs handle zoom-stable rulers
- *Intronic positions?* No ticks in inter-exon gaps. In `cds-with-introns` the gap carries the chevron decoration; sitting a number on top reads as wrong. In `cds-spliced` and `protein` the gap collapses so the question is moot. Walking ticks by *exon* (not by uniform ruler stride) keeps the contract simple
- *Major-tick label anchoring?* Anchored to a *global* ruler (1, step, 2·step, …) rather than the gene's first `cdsStart`. Reads as round numbers (100, 200, 500) regardless of where the CDS opens

**Definition of done:**
- Ruler renders major + minor ticks above the exon ribbon ✓
- Ticks pan and zoom smoothly without React re-render flicker ✓
- Mode switch in slot-system cross-fades bp ruler to aa ruler in lock-step with the figure ✓
- Playwright + unit tests pin tick count, label format, and mode flip ✓

---

### Slice 29 — Nucleotide + AA sequence tracks (zoom-gated) — **shipped**

**Motivation:**
At deep zoom (one bp ≳ 8 px / one aa ≳ 14 px) the figure has enough room
to show the actual residue letters under each exon. Two tracks — one for
genomic / CDS bp letters, one for the translated amino acid sequence —
turn the existing exon geometry into a readable sequence ladder when
the user zooms in.

**In scope:**
- `nucleotideTrack({ source, minPxPerBp? })` — renders single-character
  glyphs (A / C / G / T / N) anchored to each CDS bp position. `source`
  is a `DataSource` adapter (Slice 18) returning the CDS or pre-mRNA
  sequence as a string keyed by transcript id; `coordSystem: 'cds'` so
  letters track exon transforms identically to the ruler ticks
- `aaTrack({ source, minPxPerAa?, frame? })` — same shape, but
  per-codon: one letter every three bp in CDS mode, every bp in protein
  mode. Reads either from a supplied protein-sequence source or derives
  from the nucleotide track using the standard codon table; the
  derivation path is what the playground uses
- Zoom-gating: both tracks compute their visibility from
  `viewport.baselineGeometry().pxPerBp * liveZoom`. Below the threshold
  the track collapses to `height() === 0` and renders nothing — the
  layout engine then drops the row entirely (no empty gap). Above the
  threshold the row grows to `letterFontPx + topPad`
- Per-letter colour ramp: nucleotides use the conventional A=green,
  C=blue, G=orange, T=red palette (host-overridable); amino acids
  default to a chemistry-coloured palette (hydrophobic / polar /
  charged / aromatic / special) with a host override hook
- Mode-aware: protein mode hides the nucleotide track (CDS bp don't
  layout under the aa axis); CDS-spliced and CDS-with-introns show
  both. Intronic gaps in CDS-with-introns show no letters (no sequence
  data threaded through introns in v1)
- Playground scenario zooms in on TP53 codon 175 / 248 / 273 so a
  reader can see hotspot residues line up with the ClinVar lollipops

**Definition of done:**
- Below the threshold, neither track contributes height (asserted by
  playwright)
- Above the threshold, the letters land *exactly* under their bp / aa
  positions in all three modes (snapshot test against fit-gene +
  zoomed-in scales)
- Zoom-gating threshold configurable per-track and exposed in the
  factory's options; default is "letters readable" (≥ 8 px per bp / ≥
  14 px per aa)
- AA derivation handles non-multiple-of-three CDS lengths gracefully
  (truncate at the last whole codon, no crash)

---

### Slice 30 — Segment band track (categorical / boolean colour bands)

**Motivation:**
Several of the KIF21A annotations are full-row colour bands keyed by
position: Predicted NMD Escape (boolean per exon), Regional Missense
Constraint (categorical segments along the protein axis), Secondary
Structure (α-helix / β-sheet / loop runs). They share a primitive: a
non-overlapping series of `{start, end, category}` intervals coloured
by a host-supplied palette.

**In scope:**
- `segmentBandTrack({ source, coordSystem, palette, heightPx?,
  showLabels? })` factory in `packages/gene-glyph/src/tracks/`
- `source` returns `Array<{start, end, category, label?}>` in the
  configured `coordSystem` (`'cds'` or `'protein'`). The track packs
  these to one row (overlaps are an input error; surfaced via an
  optional `onOverlapWarning` callback rather than thrown)
- Rendering is one `<rect>` per segment, filled from `palette[category]`
  via the existing per-exon CSS-variable transforms. `coordSystem`
  drives whether the rects sit on the CDS axis or the protein axis,
  same as every other track
- Optional inline labels: when `showLabels` is set and a segment is
  wide enough (`segmentWidthPx >= minLabelWidthPx`), render the label
  centred inside the segment with the standard counter-scale wrapper
  so the text doesn't squash under zoom
- Hover + click parity: `onFeatureClick` fires with the segment id;
  hover lift uses the same `vv-hover` CSS the variant track already
  registers
- Three demo scenarios in the playground:
  1. NMD escape on TP53 (boolean: escapes ⇄ doesn't escape)
  2. RMC on a constraint-rich gene (4-way categorical)
  3. Secondary structure derived from a DSSP-shaped fixture (3-way:
     helix / sheet / loop)

**Definition of done:**
- A single factory produces all three of the boolean / categorical /
  multi-class band rendering above with no per-track-type branching in
  the library
- Track stays correctly aligned through pan, zoom, and mode
  transitions (assertion: bp 100 of an RMC segment lines up with the
  same column in the ruler track and the exon ribbon)
- Palette is type-safe — the source's `category` field's literal-union
  type is what's keyed into `palette`, so an unknown category is a
  compile error, not a render fallback

---

### Slice 31 — Numeric profile track (per-position histogram / heatmap) — **shipped**

**Motivation:**
Conservation scores and gnomAD variant frequencies are dense numeric
signals along the position axis. The KIF21A figure shows them two
ways: as a vertical-density heatmap (Conservation — colour intensity
encodes a per-position score) and as a histogram (gnomAD Missense — an
area-fill encodes per-position variant count). Both share one
primitive: a per-position numeric value mapped to either a bar height
or a colour ramp.

**In scope:**
- `profileTrack({ source, coordSystem, render, heightPx, colorRamp?,
  yScale? })` factory. `source` returns `Array<{position, value}>` or
  a callable `(position) => value | null` for sparse signals
- `render: 'histogram' | 'heatmap'` selects the visual: histogram
  draws an SVG `<path>` area-fill with a baseline at the row's
  midline; heatmap draws one full-height rect per position coloured
  via `colorRamp(value)`. Both reuse per-exon CSS transforms so the
  profile pans and zooms in lock-step with the figure
- `yScale: 'linear' | 'log' | { domain, scale }` controls histogram
  bar heights. `colorRamp` is a `(value) => string` (host owns the
  scale); a sensible viridis default ships for heatmap
- Aggregation: when the live zoom is dense enough that several
  positions land in one pixel column, the track aggregates by the
  configured `aggregate: 'max' | 'mean' | 'sum'` (default: `max` for
  heatmap, `sum` for histogram). Without aggregation the histogram
  would alias at zoom-out; with aggregation the silhouette stays
  faithful to the underlying signal
- Two playground scenarios:
  1. Conservation heatmap (TP53 PhyloP scores from a fixture)
  2. gnomAD missense histogram (TP53 missense variant density per aa
     position, derived from the existing TP53 variant fixture)

**Definition of done:**
- The same `profileTrack` factory renders both Conservation-style
  heatmap and gnomAD-style histogram with no library branching beyond
  the `render` discriminator
- Aggregation preserves the silhouette of the raw signal across the
  full zoom range (snapshot test at fit-gene + 2× + 5× zoom)
- `colorRamp` and `yScale` are pure functions — no track-local state
  — so the same track can be reused with a different palette per
  host

---

### Slice 32 — Compact variant-tick track (single-row lollipop / sparse marker)

**Motivation:**
gnomAD LoF / Homozygous LoF / Homozygous Missense and DECIPHER
variants in the KIF21A figure are all rendered as compact vertical
ticks: a single thin coloured line per variant at its codon, no
stacking, no per-glyph chrome. This is the existing variant track
stripped down: same packing logic, same hover semantics, but a much
smaller per-mark footprint so several variant categories can stack as
adjacent thin rows above the gene body.

**In scope:**
- `tickVariantTrack({ source, coordSystem, encoding, heightPx?,
  thicknessPx? })` factory — distinct from `variantTrack` because
  enough of the rendering and packing logic diverges that a flag on
  the existing factory would multiply complexity rather than reduce
  it (no stacked-into-rows packing — single row by construction —
  and no glyph shapes — just rects)
- `encoding: SymbolEncoding<T>` reused from Slice 27, but only
  `color` and `lane?` are consulted; `shape` / `radius` are ignored.
  Variants land as single thin rects (height = `heightPx`, width =
  `thicknessPx`) anchored to the variant's position
- Optional lane sub-row mode: when `encoding.lane()` returns a key,
  variants in different lanes get separate horizontal *slots* within
  the same row (offset by `lanePxOffset`) so e.g. heterozygous vs
  homozygous don't pile on the same x-column. Default: no lane
  separation (truly single-row)
- Click / hover: identical to `variantTrack` — same overlay tooltip
  surface, same `onFeatureClick` plumbing
- Playground scenario adds a stack of `tickVariantTrack` rows above
  the gene body for the KIF21A-style panel: gnomAD missense (yellow,
  thin), gnomAD LoF (red), gnomAD homozygous LoF (red, dotted), all
  fed from the existing TP53 variant fixture filtered by category

**Definition of done:**
- A single-figure scenario shows four `tickVariantTrack` rows above
  the gene body without exceeding the existing playground
  trackHeightBudget
- Tick positions match the variant's `cdsPosition` / `aaPosition` to
  within ±1 px across the zoom range (snapshot + Playwright)
- Hover and click parity with the existing variant track — same
  tooltip layout, same selection ring
- Bundle-size impact: ≤ 2 KB gzipped added to the core lib (the new
  track shares ~80% of its code path with `variantTrack` via a
  small `renderMark` callback)

---

### Slice 33 — Remove the animation system (event-driven redraws only) — **shipped**

**Motivation:**
Animation is concentrated in three files (`viewer.tsx`,
`use-viewport-interactions.ts`, `viewport.ts`) plus a handful of CSS
rules, but the *bugs* it produces have outpaced the *value* it adds.
The recent week shipped the infinite-loop-on-spliced-mode crash, the
intron-gap-shrinks-with-zoom regression, the off-by-K ribbon shift in
`cds-with-introns` deep zoom, and the rAF leash / storm-detector
machinery (Slice 33 retires its callers, so the leash itself can stay
as quiet diagnostics infrastructure). Every one of those bugs is in
the interpolated-state-vs-committed-state seam.

A read of the actual coupling (file:line audit) shows the animation
layer is loosely attached: the public `GeneGlyphRef` exposes zero
animation concepts, `getInterpolatedRange` isn't exported,
`reprojectRange` is pure coord math (mode switches don't need
animation to be *correct*), the layout engine + gesture interactions
never read transitioning state, and tests touch only CSS class toggles
or easing curve math — no semantic behaviour is gated on animation.
The single non-trivial dependency is overview-track's rAF poller,
which reads the interpolated range so the minimap window eases in
step with the figure; without animation, that window updates per
React render instead, which is one frame behind at 60 fps (visually
imperceptible).

Removing the animation layer first, then *considering* re-adding it
as a thin CSS-only opt-in later, is a meaningful simplification —
not a vibes-based "let's start over". The visual losses are pure
cosmetics that can be re-added in isolation.

**In scope (deletions):**
- `viewport.ts` — collapse `transitionTo()` into `setRange()`, drop
  `getInterpolatedRange()`, drop `_transition` / `TransitionSchedule`,
  drop `DEFAULT_TRANSITION_MS` / `MODE_TRANSITION_MS` exports
- `viewer.tsx` — drop `transitioning`, `modeTransitioning`,
  `noTransition` states + their timers / refs / cleanup; drop
  `bumpTick` (the layout `useMemo` keys on `viewportRange` /
  `mode` directly); collapse the mode-transition `useLayoutEffect`
  to a synchronous `viewport.setMode(mode)`
- `use-viewport-interactions.ts` — drop every `setNoTransition` call
  (drag, wheel, keyboard, fitTo) and the prop itself
- `styles.css` — delete `.vv-no-transition` rule cluster, delete
  `.vv-mode-transitioning` overrides, delete the always-on
  `transition` rules on `.vv-exon-group` / `.vv-intron-decoration`
  (the rules they override remain, just without the trigger)
- rAF pollers retire: `overview-track.tsx`, `default-minimap.tsx`,
  `slot-system.tsx`, `interaction-demo.tsx` — each replaces its
  `leashedRaf(...)` block with a `useSyncExternalStore` (or simpler:
  a `viewport.subscribe`-style hook) that re-renders on committed
  range / mode change. The `debug-leash.ts` helper module *stays* —
  it's diagnostics infrastructure for any future tight-loop hot
  spots, with no callers post-slice
- `viewer.tooltip-anchor` rAF retires similarly: tooltip position
  recomputes on the same React render cycle that produces the
  committed viewport state

**In scope (test updates):**
- `viewer.test.tsx`: drop the `vv-mode-transitioning` /
  `vv-transitioning` class-toggle assertions (5 tests)
- `viewer-interactions.test.tsx`: drop the "keyboard pan/zoom
  animates" expectation (one assertion: `vv-no-transition` absence)
- `viewport.test.ts`: drop the `transitionTo` interpolation tests
  (2 tests: "snaps committed range and reports interpolated
  values", "transitionTo can be interrupted")
- Playwright: any e2e that waited `await page.waitForTimeout(500)`
  for transitions to settle can drop the wait — the figure jumps
  instantly to the new state

**Out of scope (left for a follow-up if wanted):**
- Re-adding the `fitTo` smooth-zoom curve as a CSS-only transition
  on `.vv-exon-group` (no JS state, no rAF — just a `transition`
  rule that the publish() naturally rides on)
- Re-adding the mode-transition cross-fade with the 450ms
  ease-in-out-quart curve (same shape — one extra CSS class
  toggled via `useLayoutEffect`, no JS interpolation)
- Whichever of the above gets re-added must keep the rAF pollers
  out — the chrome reads committed state only, with the visual
  smoothness coming from the browser, not from JS

**Definition of done:**
- `git grep -i transition` in `packages/gene-glyph/src/` returns
  zero references to the deleted symbols (`transitionTo`,
  `getInterpolatedRange`, `modeTransitioning`, `noTransition`,
  `bumpTick`, `MODE_TRANSITION_MS`, `DEFAULT_TRANSITION_MS`,
  `vv-no-transition`, `vv-mode-transitioning`, `vv-transitioning`)
- Zero `requestAnimationFrame` calls in the published package
  outside `debug-leash.ts` (which has no callers but remains as
  diagnostics infrastructure)
- `GeneGlyphRef` surface unchanged — hosts that called `fitTo` /
  `zoomBy` see the figure jump instead of ease, but the API
  contract is identical (no version bump required for hosts)
- Every existing e2e test passes after dropping its
  `waitForTimeout` for transition settle; new e2e asserts
  fitTo lands the committed range synchronously
- LOC delta in `packages/gene-glyph/src/`: net ≥ 300 lines deleted
  (the audit identifies ~67 unique references across the deletions
  above; each is typically a 2–5 line stanza)
- Hand-test: pan + zoom + mode switch in every playground
  scenario without console warnings, the spliced-CDS-deep-zoom
  crash from this week stays not-reproducible, intron geometry
  stays stable across zoom

---

### Slices 34–37 — User-supplied variants track (tracer-bullet stack) — **shipped**

The detailed scope, in-scope/out-of-scope bullets, and definition of
done for each of these four slices now live on the Jira tickets:

- Slice 34 — User-supplied variants from `?variants=` URL parameter →
  [RD-1125](https://cpg-populationanalysis.atlassian.net/browse/RD-1125)
- Slice 35 — Variant selection + full-figure drop-line range overlay →
  [RD-1126](https://cpg-populationanalysis.atlassian.net/browse/RD-1126)
- Slice 36 — VariantValidator integration for HGVS variants →
  [RD-1127](https://cpg-populationanalysis.atlassian.net/browse/RD-1127)
- Slice 37 — Variant-entry modal (V hotkey) →
  [RD-1128](https://cpg-populationanalysis.atlassian.net/browse/RD-1128)

Tracer-bullet shape: Slice 34 ships the URL → bare-track render path;
35 layers selection and the drop-line overlay; 36 routes HGVS through
VariantValidator; 37 closes the loop with a keyboard-driven entry
modal.

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
- Slice 26 is a polish slice; can land any time after Slice 20. **Shipped.**
- Slice 27 (stacked variant view) is a render-style add-on; lands cleanly after any of Slices 21–25 are in (more interesting once there are multiple variant-bearing tracks to demonstrate).

A two-person team could split: one drives the render path (Slices 1–13), the other follows behind with infrastructure (Slices 16–20) and then peels off data tracks in parallel.
