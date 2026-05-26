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

### Slices 38–40 — DECIPHER-aligned variant rendering (tracer-bullet stack)

**Motivation:**
DECIPHER's variant legend encodes three independent axes on every
glyph — colour by consequence class (4 buckets), shape by truncating-
or-not (square / triangle), and fill state by pathogenicity (filled-
dark / open / filled-grey) — plus a separate Regional Missense
Constraint strip along the protein. Our current ClinVar render
re-encodes significance on the glyph, which is redundant with the
per-significance sub-track decomposition we already ship in EmbedView
and the live-data scenario; collapsing that redundancy in favour of
the consequence/truncating axes brings the figure in line with the
field standard and increases information density per row. DECIPHER's
fill-state axis is intentionally out of scope — it is already encoded
by track placement (which significance sub-track a variant lives in),
so re-encoding it on the glyph would conflict with the existing
channel rather than add to it.

---

### Slice 38 — `ViewerVariant.consequence` foundation — **shipped**

**Motivation:**
The 14-value `VariantCategory` enum coarsens VEP's consequence
vocabulary in a way that loses the LOF-splice / splice-region
distinction (both collapse to a single `splice` value). Carrying the
raw VEP term on the variant lets downstream encodings make faithful
fine-grained colour choices without enum churn.

**In scope:**
- Add optional `consequence?: string` to `ViewerVariant` in
  `packages/gene-glyph/src/types.ts` (raw VEP term, e.g.
  `splice_donor_variant`)
- `apps/playground/src/lib/gnomad.ts`: pass gnomAD's
  `major_consequence` through to `ViewerVariant.consequence` wherever
  a `ViewerVariant` is produced
- No encoding consumers yet — Slice 39 is the first reader

**Definition of done:**
- `ViewerVariant.consequence` is populated on every variant produced
  by the gnomAD adapter that has a non-null `major_consequence`
- Type-level: existing `ViewerVariant` callers compile unchanged
- No visual diff — the field is plumbed but unused at render time

---

### Slice 39 — DECIPHER-aligned ClinVar glyph encoding — **shipped**

**Motivation:**
Inside a per-significance ClinVar sub-track, every glyph today carries
the same shape and colour (because `defaultClinVarSymbolEncoding`
re-encodes significance, which is also what selects the sub-track).
Replacing that with a DECIPHER-aligned encoding turns each sub-track
into a mini consequence-distribution view.

**In scope:**
- New `decipherClinVarSymbolEncoding` named export in
  `packages/gene-glyph/src/symbol-encoding.ts`, alongside the existing
  `defaultClinVarSymbolEncoding` (kept for callers that still want a
  single-strip significance-on-glyph render — `clinvar-demo.tsx`
  scenario)
- Bucket mapping (colour, from `major_consequence` on
  `ClinVarRecord.meta`):
  - **Likely LOF (red):** `stop_gained`, `frameshift_variant`,
    `splice_donor_variant`, `splice_acceptor_variant`, `start_lost`,
    `stop_lost`, `transcript_ablation`
  - **Protein Changing (yellow/olive):** `missense_variant`,
    `inframe_insertion`, `inframe_deletion`,
    `protein_altering_variant`
  - **Splice region (magenta):** `splice_region_variant`,
    `splice_polypyrimidine_tract_variant`,
    `splice_donor_5th_base_variant`, `splice_donor_region_variant`
  - **Synonymous (dark green):** `synonymous_variant`,
    `stop_retained_variant`, `start_retained_variant`
  - **Fallback grey:** anything else (UTR, intronic, regulatory,
    non-coding, …)
- Four new CSS vars + fallbacks:
  `--vv-decipher-color-{lof,protein-changing,splice-region,synonymous}`
- Shape mapping: **square** for `stop_gained` only (DECIPHER: "the
  location of protein truncating codons"); **`triangle-up`** for
  everything else, including frameshift (frameshift's position is the
  indel, not the downstream stop)
- `lane(r)` returns the consequence bucket id;
  `laneOrder: ['lof', 'protein-changing', 'splice-region',
  'synonymous', 'other']` (top-to-bottom severity)
- Wire-up: `apps/playground/src/scenarios/live-data-demo.tsx` and
  `apps/playground/src/embed/EmbedView.tsx` swap
  `defaultClinVarSymbolEncoding` for the new export in the `subgroup`
  factory. `clinvar-demo.tsx` (single-strip) keeps the existing
  encoding

**Out of scope:**
- DECIPHER's fill-state axis (filled-dark / open / filled-grey by
  pathogenicity) — redundant with our per-significance sub-track
  decomposition
- Applying the same encoding to the generic `variantTrack`
  (`ViewerVariant`) — Slice 38 makes this trivial whenever wanted,
  but it isn't in this slice's scope

**Definition of done:**
- A ClinVar sub-track in EmbedView visibly shows the four colour
  buckets and the square-vs-triangle split at glyph-level
- Existing `clinvar-track.test.tsx` snapshots / lane-key expectations
  updated for the new encoding where applicable; the old encoding's
  tests stay green
- Unit tests cover the full bucket / shape mapping table including
  the fallback path

---

### Slice 40 — Regional Missense Constraint via gnomAD GraphQL — **shipped**

**Motivation:**
DECIPHER's RMC strip shows missense intolerance along the protein
in five obs/exp bins (plus grey for non-significant). gnomAD's public
GraphQL exposes the same data on `gene.gnomad_v2_regional_missense_
constraint`, keyed on the canonical transcript and reported in protein
coords (`aa_start`/`aa_stop`), which lets us sidestep the GRCh37↔
GRCh38 build mismatch entirely by ignoring the genomic chr/start/stop.

**Depends on:** Slice 30 (`segmentBandTrack`). RMC is a categorical
band — six-way palette (`intol-1` … `intol-5` + `not-significant`) —
so it should ship as a `segmentBandTrack` consumer, not a parallel
track factory.

**In scope:**
- gnomAD adapter (`apps/playground/src/lib/gnomad.ts`) gains a
  `gnomad_v2_regional_missense_constraint { regions { aa_start
  aa_stop obs_exp p_value } }` field in the gene query
- `parseAaStart('Lys2009') → 2009` helper handling all 20 three-letter
  codes (and `Ter` / `Sec` / `Pyl` for completeness)
- New `rmcDataSource({ geneSymbol })` returns
  `Array<{ start, end, category }>` in `coordSystem: 'protein'`, where
  `category` is one of `'intol-1' | 'intol-2' | 'intol-3' | 'intol-4'
  | 'intol-5' | 'not-significant'` derived from `obs_exp` and
  `p_value`:
  - `p_value > 0.001` → `'not-significant'` (grey) — overrides bins
  - `obs_exp ≤ 0.2` → `intol-1` (red)
  - `0.2 < obs_exp ≤ 0.4` → `intol-2` (orange)
  - `0.4 < obs_exp ≤ 0.6` → `intol-3` (gold)
  - `0.6 < obs_exp ≤ 0.8` → `intol-4` (yellow-green)
  - `obs_exp > 0.8` → `intol-5` (light green)
- New playground scenario (and EmbedView toggle) renders the source
  through `segmentBandTrack` with the six-bin palette. Visible in
  protein, transcript, and genome modes via the existing CDS↔genomic
  mapper (the same projection path used by protein-coord ClinVar
  variants)
- Empty-state handling: many genes return null regions from gnomAD;
  the track renders a "No RMC available for this gene" stub rather
  than an empty strip

**Out of scope:**
- gnomAD v4 RMC — the v2-only constraint comes from gnomAD; revisit
  if/when a v4 field appears in the schema
- Liftover — sidestepped by using `aa_start`/`aa_stop` protein coords
  directly

**Definition of done:**
- RMC strip displays for a constraint-rich test gene (e.g. SCN1A)
  with the five intolerance bins and grey non-significant regions
- aa_start string parser handles all canonical three-letter codes
  (unit tests)
- Bin assignment from (obs_exp, p_value) is fully covered by unit
  tests including boundary values and the p_value override
- Genes with no RMC data (e.g. MECP2) render the empty-state stub
  without console errors

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
