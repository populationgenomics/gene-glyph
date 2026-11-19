# @populationgenomics/gene-glyph

## 1.0.1

### Patch Changes

- b73742a: Add `[data-vv-reduce-motion]` attribute hook in the stylesheet that mirrors the existing `@media (prefers-reduced-motion: reduce)` rule. Hosts can set this attribute on any ancestor of a `<GeneGlyph>` to force animations off for testing or for app-level motion preferences that don't propagate through OS media queries (Slice 12).
