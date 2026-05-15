# gene-glyph

Gene-level annotation viewer for React with multi-coordinate alignment, pluggable data tracks, and camera-ready vector export.

> **Status**: pre-1.0. API is shaking out. See [`gene-glyph-design.md`](./docs/design.md) for the architecture, and the [`RD` Jira project](https://cpg-populationanalysis.atlassian.net/browse/RD-1058) for the slice tickets.

## Install

```sh
npm install @populationgenomics/gene-glyph
```

Peer deps: `react`, `react-dom` (>=18, <20).

## Minimal usage

```tsx
import { GeneGlyph } from '@populationgenomics/gene-glyph';
import '@populationgenomics/gene-glyph/styles.css';

export function MyPage() {
  return <GeneGlyph />;
}
```

The viewer is a compound component. Tracks, slots, and controlled state are added in later slices.

## Repo layout

```
packages/gene-glyph/    The published library
apps/playground/        Vite dev app with scenarios
.changeset/             Changesets used for releases
.github/workflows/      CI + release
```

## Development

```sh
npm install                 # install all workspaces
npm run dev:playground      # run the playground at http://localhost:5174
npm run build               # build the library
npm run test                # run unit tests
npm run lint                # eslint
npm run typecheck           # tsc --build
```

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for cross-repo iteration via yalc, release flow, and architecture conventions.

## License

MIT. See [`LICENSE`](./LICENSE).
