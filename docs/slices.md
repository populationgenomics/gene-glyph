# gene-glyph — Implementation Slices

Tracer-bullet vertical slices ordered to deliver visible value incrementally. Each slice ends with a runnable demonstration in `apps/playground` and a defined acceptance bar.

Slices 1–18 deliver the cutover-ready package. Slices 19–24 deliver the post-cutover feature wishlist.

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

### Slice 10 — CSS-driven hover lift + selection feedback

Polish on per-feature micro-interactions; locks in the discipline of "all motion via `transform` on wrappers."

**In scope:**
- Audit all track render functions to ensure motion is via wrapping `<g>` transform, not via attribute interpolation
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

### Slice 11 — Lit-manager adapter + cutover

Replace `GeneSchematic.tsx` in lit-manager with `<GeneGlyph>`.

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

### Slice 12 — Mode transitions (CDS ↔ spliced ↔ protein)

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

### Slice 13 — Hidden-feature indicators

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

### Slice 14 — Brush selection

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

### Slice 15 — Overlay layer

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

### Slice 16 — DataSource adapter pattern + async track loading

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

### Slice 17 — Camera-ready export (SVG + PNG)

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

### Slice 18 — Convenience chrome exports

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

These are independent of each other and can be grabbed in parallel after Slice 16.

### Slice 19 — ClinVar track

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

### Slice 20 — gnomAD track

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

### Slice 21 — AlphaMissense track

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

### Slice 22 — MAVE track

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

### Slice 23 — User annotation track

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

### Slice 24 — Mini-map as standalone component + Overview track

Two final pieces of polish.

**In scope:**
- `DefaultMinimap` already exists from Slice 18; ensure it shares the imperative-ref machinery cleanly
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
- Migration guide for lit-manager (referenced from Slice 11)
- CONTRIBUTING.md covering yalc workflow, animation discipline, painter abstraction rules

### CI / quality gates
- All slices keep CI green
- Visual regression snapshots updated as part of each slice's PR
- Bundle-size budget enforced post-Slice 11 (target: <50KB gzipped for the core lib)

### Versioning milestones
- `0.1.0` — after Slice 3 (first real render)
- `0.5.0` — after Slice 10 (parity render path complete, no cutover yet)
- `1.0.0` — Slice 11 (lit-manager cutover)
- `1.x` — subsequent slices (additive features, no breaking changes)

---

## Notes on parallelisation

- Slices 1–11 are mostly sequential (each builds on the previous render path).
- Slice 12 (mode transitions) blocks new tracks that need to respect modes (Slices 20, 21).
- Slices 16, 17, 18 unblock independent work.
- Slices 19–23 (data tracks) are all parallel after Slice 16.
- Slice 24 is a polish slice; can land any time after Slice 18.

A two-person team could split: one drives the render path (Slices 1–11), the other follows behind with infrastructure (Slices 14–18) and then peels off data tracks in parallel.
