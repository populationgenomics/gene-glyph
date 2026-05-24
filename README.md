# gene-glyph

Gene-level annotation viewer for React with multi-coordinate alignment, pluggable data tracks, and camera-ready vector export.

> **Status**: pre-1.0. API is shaking out. See [`gene-glyph-design.md`](./docs/design.md) for the architecture, and the [`RD` Jira project](https://cpg-populationanalysis.atlassian.net/browse/RD-1058) for the slice tickets.

**Live playground**: [populationgenomics.github.io/gene-glyph](https://populationgenomics.github.io/gene-glyph/) — built from `main` on every push.

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

## Folding a track group with a summary representation

Dense feature tracks (e.g., the full ClinVar set for BRCA1, ~12k records) can
recover their vertical real estate while staying visible by wrapping the
detail track in a `TrackGroup` that carries a `summaryTrack`. While the
group's id is in the viewer's `collapsedGroupIds` set, the figure swaps the
detail tracks for the summary track — one row instead of hundreds.

```tsx
import {
  GeneGlyph,
  clinVarTrack,
  clinVarSummaryTrack,
  defaultClinVarSymbolEncoding,
  exonTrack,
  DefaultTrackChevron,
} from '@populationgenomics/gene-glyph';
import type {
  GeneGlyphRef,
  GutterItem,
  TrackOrGroup,
} from '@populationgenomics/gene-glyph';
import { useRef, useState } from 'react';

export function MyPage({ transcript, records }) {
  const ref = useRef<GeneGlyphRef | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(
    () => new Set(['clinvar-group']),
  );
  const tracks: TrackOrGroup[] = [
    exonTrack({}),
    {
      kind: 'group',
      id: 'clinvar-group',
      label: 'ClinVar',
      tracks: [
        clinVarTrack({
          id: 'clinvar',
          source: records,
          stackedVariantStyle: defaultClinVarSymbolEncoding,
        }),
      ],
      summaryTrack: clinVarSummaryTrack({
        id: 'clinvar-summary',
        source: records,
      }),
    },
  ];

  return (
    <GeneGlyph
      ref={ref}
      transcript={transcript}
      tracks={tracks}
      collapsedGroupIds={collapsedGroups}
      onCollapsedGroupChange={setCollapsedGroups}
    >
      <GeneGlyph.LeftGutter width={140}>
        {(item: GutterItem) =>
          item.kind === 'group' ? (
            <DefaultTrackChevron
              item={item}
              collapsed={collapsedGroups.has(item.id)}
              onToggle={() => ref.current?.toggleGroup(item.id)}
            />
          ) : null
        }
      </GeneGlyph.LeftGutter>
    </GeneGlyph>
  );
}
```

`variantSummaryTrack` and `clinVarSummaryTrack` are the two summary
primitives shipped today; any `Track` satisfying the standard contract
works as a `summaryTrack`. Groups without a `summaryTrack` fall back to the
"remove rows" behaviour when folded.

## Default mouse / keyboard bindings

| Gesture | Action |
|---|---|
| Drag | Box-zoom: snap viewport to the dragged screen-x interval (live preview; `Esc` cancels) |
| Space + drag | Pan (Adobe Hand-tool pattern). Touch / pen drag pans without the modifier |
| Wheel | Pan horizontally (falls through to the page at the pan limit) |
| Cmd/Ctrl + wheel | Zoom, cursor-anchored |
| Pinch | Zoom, cursor-anchored |
| Shift + drag (or right-click drag) | Brush-select a range — surfaced via `onBrushChange` |
| Arrows / WASD | Pan / zoom |
| `1` | Fit gene |

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
