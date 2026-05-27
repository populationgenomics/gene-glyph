# gene-glyph — Implementation Slices

Tracer-bullet vertical slices ordered to deliver visible value incrementally. Each slice ends with a runnable demonstration in `apps/playground` and a defined acceptance bar.

Slices 1–20 deliver the cutover-ready package. Slices 21–27 deliver the post-cutover feature wishlist.

---

## Phase 1: Foundation

### Slice 1 — Repo bootstrap

Set up the repository and CI so subsequent slices have a place to land.

**Shipped.**
---

### Slice 2 — Core abstractions (no rendering)

The internal scaffolding everything else builds on. No visible UI yet.

**Shipped.**
---

## Phase 2: Parity render path

### Slice 3 — Exon track + first real render

The first slice that renders something users would recognise.

**Shipped.**
---

### Slice 4 — Variant track + interaction

Variants render and respond to host-driven hover/selection/click.

**Shipped.**
---

### Slice 5 — Pfam track + protein-range fragmentation

First track to exercise the range-projection-returns-segments machinery.

**Shipped.**
---

### Slice 6 — InterPro track + groups + LeftGutter

Track groups and gutter slots come online together because they're co-dependent for IPR rendering.

**Shipped.**
---

### Slice 7 — Slot system completion

Header, Footer, and RightGutter; locks in the compound-component API.

**Shipped.**
---

### Slice 8 — Imperative ref API + basic fitTo

Hosts can drive viewport state programmatically without managing every prop.

**Shipped.**
---

### Slice 9 — Pan + zoom interaction handlers

Wire up the default interaction bindings; viewer becomes interactive.

**Shipped.**
---

### Slice 10 — Smooth pan internals (stable geometry + viewport-only transforms)

Make pan / zoom / mode transitions actually glide. Slice 9 surfaced two related bugs that share a single root cause: **track geometry is recomputed against the current viewport range on every render**.

- During an animated `fitTo` / `zoomBy`, per-exon widths change because `pxPerBp` depends on the visible-bp total; the wrapping `.vv-exon-group` `<g>` slides via CSS transform while React snaps its children to new local coords mid-flight (the "content jumps inside the animated frame" symptom Slice 9 worked around by snapping keyboard pans).
- During a drag, `exon-track` clips each exon's CDS range to `[rangeLo, rangeHi]` and recomputes the rect width from the clipped endpoints. Edge exons reshape continuously instead of sliding off-figure (the "popping at the ends" symptom). The same `clipCdsToScreen` helper is mirrored in Pfam / InterPro tracks.
- `ViewportController.publish` compounds it by falling back to `xStart = 0` for fully-hidden exons, so as an exon transitions from partially visible to off-figure its `--vv-exon-x-{N}` snaps to the figure's left edge rather than continuing past it.

Both symptoms go away if geometry stops being viewport-dependent and clipping moves to the rendering layer.

**Shipped.**
---

### Slice 11 — Playwright browser tests (backfill + going-forward)

JSDOM-only coverage misses the visual coordination the design relies on — CSS transitions, layout reflow under width changes, pinch gestures, intron-vs-exon animation alignment. Stand up Playwright so we can exercise the rendered playground, then backfill tests for every slice already on `main`.

**Shipped.**
---

### Slice 12 — CSS-driven hover lift + selection feedback

Polish on per-feature micro-interactions; locks in the discipline of "all motion via `transform` on wrappers." (Previously Slice 10; now follows Slice 10 — smooth pan internals — and Slice 11 — Playwright backfill.)

**Shipped.**
---

## Phase 3: Cutover

### Slice 13 — Lit-manager adapter + cutover

Replace `GeneSchematic.tsx` in lit-manager with `<GeneGlyph>`.

**Shipped.**
---

## Phase 4: Post-cutover features

### Slice 14 — Mode transitions (CDS ↔ spliced ↔ protein) — **shipped**

The first feature the rewrite was for. Modes are viewport projections, not separate render paths.

**Shipped.**
---

### Slice 15 — Hidden-feature indicators — **shipped**

Tracks that care surface counts of features dropped by current viewport.

**Shipped.**
---

### Slice 16 — Brush selection — **shipped**

Users can drag-select a range; tracks reflect the selection.

**Shipped.**
---

### Slice 17 — Overlay layer — **shipped**

Tooltips, "you are here" markers, transient UI floating above tracks.

**Shipped.**
---

### Slice 18 — DataSource adapter pattern + async track loading — **shipped**

The infrastructure for pluggable backends.

**Shipped.**
---

### Slice 19 — Camera-ready export (SVG + PNG) — **shipped**

The "camera-ready vector graphics" goal lands.

**Shipped.**
---

### Slice 20 — Convenience chrome exports — **shipped**

Pre-built chrome components for hosts that don't want to write their own.

**Shipped.**
---

## Phase 5: New data tracks

These are independent of each other and can be grabbed in parallel after Slice 18.

### Slice 21 — ClinVar track — **shipped**

**Shipped.**
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

**Shipped.**
---

### Slice 27 — Stacked variant view (Decipher-style) — **shipped**

**Shipped.**
---

### Slice 28 — Coordinate ruler track — **shipped**

**Shipped.**
---

### Slice 29 — Nucleotide + AA sequence tracks (zoom-gated) — **shipped**

**Shipped.**
---

### Slice 30 — Segment band track (categorical / boolean colour bands) — **shipped**

Scope and definition of done live on
[RD-1134](https://cpg-populationanalysis.atlassian.net/browse/RD-1134).
RMC (Slice 40) consumes this as its rendering surface.

---

### Slice 31 — Numeric profile track (per-position histogram / heatmap) — **shipped**

**Shipped.**
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

**Shipped.**
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

### Slices 38–40 — DECIPHER-aligned variant rendering (tracer-bullet stack) — **shipped**

The detailed scope, in-scope/out-of-scope bullets, and definition of
done for each of these three slices live on the Jira tickets:

- Slice 38 — `ViewerVariant.consequence` foundation →
  [RD-1135](https://cpg-populationanalysis.atlassian.net/browse/RD-1135)
- Slice 39 — DECIPHER-aligned ClinVar glyph encoding →
  [RD-1136](https://cpg-populationanalysis.atlassian.net/browse/RD-1136)
- Slice 40 — Regional Missense Constraint via gnomAD GraphQL →
  [RD-1137](https://cpg-populationanalysis.atlassian.net/browse/RD-1137)

Tracer-bullet shape: Slice 38 plumbs the raw VEP consequence onto
`ViewerVariant`; 39 introduces a DECIPHER-aligned `ClinVar` symbol
encoding (consequence-class colour + truncating-vs-not shape); 40
consumes Slice 30's `segmentBandTrack` to render the RMC strip from
gnomAD's `gnomad_v2_regional_missense_constraint` field.

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
The 0.x milestones were never tagged — development ran straight through to
the lit-manager cutover (Slice 13) and beyond.
- `1.0.0` — current. Slices 1–40 shipped: full parity render path, the
  lit-manager cutover, post-cutover feature work (mode transitions, brush
  selection, overlay layer, DataSource adapter, exports, ClinVar/RMC/
  stacked variant view, user-supplied variants, DECIPHER-aligned encoding).
  See [`CHANGELOG.md`](../CHANGELOG.md).
- `1.x` — subsequent slices (additive features, no breaking changes).

---

## Notes on parallelisation

- Slices 1–13 are mostly sequential (each builds on the previous render path).
- Slice 14 (mode transitions) blocks new tracks that need to respect modes (Slices 22, 23).
- Slices 18, 19, 20 unblock independent work.
- Slices 21–25 (data tracks) are all parallel after Slice 18.
- Slice 26 is a polish slice; can land any time after Slice 20. **Shipped.**
- Slice 27 (stacked variant view) is a render-style add-on; lands cleanly after any of Slices 21–25 are in (more interesting once there are multiple variant-bearing tracks to demonstrate).

A two-person team could split: one drives the render path (Slices 1–13), the other follows behind with infrastructure (Slices 16–20) and then peels off data tracks in parallel.
