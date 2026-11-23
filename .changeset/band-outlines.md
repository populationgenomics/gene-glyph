---
'@populationgenomics/gene-glyph': minor
---

`segmentBandTrack` draws a 1 px outline around each band, so touching or overlapping bands with the same fill read as separate bands. The default colour is the `--vv-segment-band-outline` CSS variable, falling back to a translucent dark edge (`rgba(15, 23, 42, 0.45)`) that darkens any fill. The new `outline` option takes a colour, or `null` for the previous outline-free bars.

The default outline colour is declared in the default, print and dark-theme blocks of `styles.css`, and `toJSON()` includes `outline`.
