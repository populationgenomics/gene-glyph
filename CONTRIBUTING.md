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
- **1.0.0** at lit-manager cutover (Slice 11).
- Strict semver from 1.0.

## Architecture conventions

These rules are load-bearing and have been chosen deliberately. See [`docs/design.md`](./docs/design.md) for the full reasoning.

### Motion lives in CSS, not JS

- All motion happens via `transform` on a wrapping `<g>` (or HTML `<div>`), never via SVG attribute interpolation. SVG attribute transitions are cross-browser inconsistent.
- Continuous state (zoom, pan, intronScale, per-exon offsets) lives as CSS custom properties on the SVG root, set by the `ViewportController`.
- Direct manipulation (drag, wheel) updates variables directly per pointer event, no transition class.
- Programmatic transitions (fit-to-feature, mode change) toggle a `vv-transitioning` class, set the new values, and listen for `transitionend`.
- The viewer never runs an `rAF` animation loop. If you find yourself reaching for one, reconsider whether the state can live in a CSS variable instead.

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
