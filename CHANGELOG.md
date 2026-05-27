# Changelog

All notable changes to `@populationgenomics/gene-glyph` are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
the package follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] — 2026-05-27

First tagged release. Cumulative summary of the slice work tracked in
[`docs/slices.md`](docs/slices.md) and the
[`RD` Jira project](https://cpg-populationanalysis.atlassian.net/browse/RD-1058).

### Render path

- Compound `<GeneGlyph>` viewer with slot system, left/right gutter, header
  and footer.
- Imperative ref API: `fitTo`, viewport queries, hover/select control.
- Multi-coordinate alignment (CDS, spliced, protein) with mode transitions
  and hidden-feature indicators.
- Pan + zoom with stable geometry and viewport-only transforms; keyboard
  pan via display-offset shift.
- Brush selection and overlay layer for figure-level annotations.
- Camera-ready SVG and PNG export.
- CSS-driven hover lift and selection feedback.

### Tracks

- `exonTrack`, `variantTrack`, `pfamTrack`, `interProTrack` — core
  annotation tracks.
- `clinVarTrack` with stacked/Decipher-style variant view, ClinVar gold-star
  filtering, and DECIPHER-aligned glyph encoding driven by VEP
  `consequence`.
- `coordinateRulerTrack` and zoom-gated nucleotide / amino-acid sequence
  tracks.
- `segmentBandTrack` for categorical / boolean colour bands (consumed by
  the Regional Missense Constraint strip).
- Numeric profile track for per-position histograms / heatmaps.
- User-supplied variants pipeline: `?variants=` URL parameter, drop-line
  selection overlay, VariantValidator integration for HGVS input, V-hotkey
  variant-entry modal.

### Data sources

- `DataSource` adapter pattern with async track loading and freshness
  tokens.
- Mini-map as standalone component plus the overview track.
- gnomAD GraphQL adapter for Regional Missense Constraint (v2
  `gnomad_v2_regional_missense_constraint`).

### Chrome

- `DefaultTrackChevron`, `DefaultMinimap` exports for hosts that want the
  default chrome.
- Group folding with summary representation; collapsed groups keep their
  header row even without a summary track.

[unreleased]: https://github.com/populationgenomics/gene-glyph/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/populationgenomics/gene-glyph/releases/tag/v1.0.0
