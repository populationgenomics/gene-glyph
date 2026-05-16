# Contributing

## Setup

```sh
npm install
npm run build
npm run test
```

Node 20+ required; the workspace uses npm workspaces.

## Cross-repo iteration (using gene-glyph from a consumer)

When iterating on gene-glyph alongside a consumer (e.g. lit-manager), use **yalc** rather than `npm link` — it behaves like a published package and avoids symlink-induced peer-dep issues.

In `gene-glyph`:

```sh
cd packages/gene-glyph
npm run build
npx yalc publish
```

In the consumer (e.g. `lit-manager/frontend`):

```sh
npx yalc add @populationgenomics/gene-glyph
```

After each gene-glyph change, repeat `npm run build && npx yalc push` in the package directory and the consumer's local copy refreshes automatically.

When done, in the consumer:

```sh
npx yalc remove @populationgenomics/gene-glyph
npm install
```

## Releases

We use [Changesets](https://github.com/changesets/changesets).

1. For any user-facing change, run `npm run changeset` and describe the change.
2. Commit the generated `.changeset/*.md` file alongside the code change.
3. On merge to `main`, the release workflow opens a "Version Packages" PR.
4. Merging that PR publishes to npm.

Versioning:
- **0.x** while the API is shaking out — break freely.
- **1.0.0** at lit-manager cutover (Slice 13).
- Strict semver from 1.0.

## Testing

Three layers of tests:

- **Unit / integration (JSDOM)** — `npm run test` runs the Vitest suite across all workspaces (102+ tests covering coordinate math, layout, tracks, viewer wiring, gesture handlers).
- **Browser end-to-end (Playwright + Chromium)** — `npm run test:e2e` boots the playground via Vite, drives Chromium, and asserts each slice's acceptance bar against the rendered figure. Tests live under `apps/playground/tests/e2e/`.
- **CI** — both layers run on every push and PR (`.github/workflows/ci.yml`). The Playwright job uploads its HTML report and `test-results/` as artifacts on failure.

### Working with Playwright

```sh
# First time only — pull the Chromium binary.
npx playwright install chromium

# Run the whole browser suite (auto-starts and kills Vite).
npm run test:e2e

# Run one file, headed, so you can see what's happening.
npm run test:e2e:debug -- tests/e2e/slice-9-interactions.spec.ts

# Re-record any failing visual snapshots after a deliberate UI change.
npm run test:e2e -- --update-snapshots
```

### Slice convention

Every new slice ships with at least one Playwright test pinning its acceptance bar — added to `apps/playground/tests/e2e/slice-N-*.spec.ts`. Bugs caught in playground iteration land alongside a regression test in the same file. This convention is documented in `docs/slices.md` (Slice 11, RD-1085).

## Architecture conventions

These rules are load-bearing and have been chosen deliberately. See [`docs/design.md`](./docs/design.md) for the full reasoning.

### Motion lives in CSS, not JS

- All motion happens via `transform` on a wrapping `<g>` (or HTML `<div>`), never via SVG attribute interpolation. SVG attribute transitions are cross-browser inconsistent.
- Continuous state (zoom, pan, intronScale, per-exon offsets) lives as CSS custom properties on the SVG root, set by the `ViewportController`.
- Direct manipulation (drag, wheel) updates variables directly per pointer event, no transition class.
- Programmatic transitions (fit-to-feature, mode change) toggle a `vv-transitioning` class, set the new values, and listen for `transitionend`.
- The viewer never runs an `rAF` animation loop. If you find yourself reaching for one, reconsider whether the state can live in a CSS variable instead.

### Baseline geometry: tracks render in fit-gene coordinates (Slice 10)

Each exon owns a stable `(xStart, width)` in **baseline screen-x** — the pixel
positions it would occupy at fit-gene zoom (`range = naturalRange`). Read this
from `viewport.baselineGeometry()`. Tracks place features in that frame; the
exon's wrapping `<g>` carries the live translate + scale.

The contract for a well-behaved track:

- **Rect widths and `x` attributes are computed from baseline geometry once
  and don't change on pan or zoom.** The wrapping `<g>` element's CSS
  variables (`--vv-exon-x-{N}`, `--vv-exon-scale-x-{N}`) carry the motion.
- **Use `placeInExonGroup(exonIdx, …)` for any feature that belongs to an
  exon.** The painter wraps it in a `<g>` that applies the live transform.
- **Use `placeInInterExon(a, b, …)` for any feature that lives in the gap
  between two exons.** Same idea, with `--vv-intron-x-{N}` and
  `--vv-intron-scale-x-{N}` driving the transform.
- **The figure SVG clips off-figure content via `overflow: hidden`.** Don't
  filter exons by visibility — every exon stays in the DOM and slides cleanly
  past the edge during pan / zoom.
- **Strokes inside scaled groups get `vector-effect="non-scaling-stroke"`** so
  the visual width doesn't change with zoom.
- **Circles (variant dots, selection rings) need a counter-scale** — wrap
  them in a `<g>` with `transform: scaleX(calc(1 / var(--vv-exon-scale-x-{N},
  1)))` so the horizontal scale of the parent exon group doesn't turn them
  into ellipses.
- **Labels inside an exon group also need counter-scale** so the parent
  scaleX doesn't horizontally stretch the glyphs. The Pfam / InterPro tracks
  pick the segment containing the domain's midpoint to host the label and
  apply the counter-scale there.

The smoke check: drag-pan the interaction-demo back and forth. The edge
exons should slide off-figure as solid rectangles — no continuous reshape,
no `width` recompute mid-gesture. The `slice-10-smooth-pan` Playwright spec
pins this contract.

### Tracks are plain objects, not React components

- Implement the `Track<TConfig, TData>` interface; construct via factory functions.
- Tracks have `load`, `height`, `render`, optional `resolveAnchor`, and `toJSON`.
- Tracks are mode-agnostic. The `Viewport` returns `null` for features that aren't visible in the current mode; tracks just skip null results.

### The figure SVG is the export boundary

- All chrome (toolbars, buttons, chevrons, minimap) is host-rendered, supplied through named slots (`<GeneGlyph.Header>` etc.). Slots are React-DOM siblings of the figure SVG, not children — they structurally cannot leak into export.
- `exportSVG()` is `figureSvg.outerHTML` plus painter cleanup. No filtering of "widget" elements.

### Painter abstraction

- Tracks render via a `Painter` interface (`drawRect`, `drawLine`, `drawText`, …). The SVG implementation returns React.ReactNode. A future Canvas implementation would mutate a Canvas context.
- Tracks never write SVG JSX directly; they go through the painter so future backends remain feasible.

## Code style

- Prettier handles formatting (`npx prettier --write .`).
- ESLint handles correctness (`npm run lint`).
- TypeScript strict mode; no `any` without a written justification in a comment.
