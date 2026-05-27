# @populationgenomics/gene-glyph

Gene-level annotation viewer for React with multi-coordinate alignment,
pluggable data tracks, and camera-ready vector export.

- **Live playground**: [populationgenomics.github.io/gene-glyph](https://populationgenomics.github.io/gene-glyph/)
- **Repository**: [github.com/populationgenomics/gene-glyph](https://github.com/populationgenomics/gene-glyph)
- **Changelog**: [`CHANGELOG.md`](https://github.com/populationgenomics/gene-glyph/blob/main/CHANGELOG.md)

## Install

```sh
npm install @populationgenomics/gene-glyph
```

Peer deps: `react`, `react-dom` (>=18, <20).

## Minimal usage

```tsx
import { GeneGlyph, exonTrack, variantTrack } from '@populationgenomics/gene-glyph';
import '@populationgenomics/gene-glyph/styles.css';

export function MyPage({ transcript, variants }) {
  return (
    <GeneGlyph
      transcript={transcript}
      tracks={[exonTrack({}), variantTrack({ source: variants })]}
    />
  );
}
```

The viewer is a compound component — tracks, slots, and controlled state
plug in around the core element.

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

## Documentation

See the [repository README](https://github.com/populationgenomics/gene-glyph#readme)
for the longer overview, including track folding with summary representations,
and the playground for runnable scenarios covering ClinVar, gnomAD, sequence,
and user-supplied variant tracks.

## License

MIT. See [`LICENSE`](./LICENSE).
