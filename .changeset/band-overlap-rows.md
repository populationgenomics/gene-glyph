---
'@populationgenomics/gene-glyph': minor
---

`segmentBandTrack` draws overlapping bands in stacked rows instead of painting them over each other, so each stays visible, hoverable and clickable. Rows are packed greedily in span order (bands on adjacent bases share a row; genomic bands on different chromosomes never stack), each row is `heightPx` tall with 2 px between rows, and the track's height grows to fit (`heightPolicy` is now `'data-dependent'`). `SegmentBandTrackData` gains `rows` (feature id to row) and `rowCount`. `onOverlapWarning` still fires once per overlapping pair, for hosts whose data should never overlap.
