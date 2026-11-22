---
'@populationgenomics/gene-glyph': minor
---

Variants and bands outside the CDS are drawn in genome and transcript modes.

- `Transcript` takes optional `utr5Exons` and `utr3Exons` (`UtrExon[]`: `number`, `chr`, `genomicStart`, `genomicEnd`) for exons wholly in a UTR. They are drawn in the first exon's 5' cap and the last exon's 3' cap, after that exon's own `utr5Bp` / `utr3Bp` part. UTR positions sit on the c. ruler as `cPos = 1 - N` for c.-N and `cdsLength + N` for c.*N, and the mapper now maps genomic positions in the first exon's 5' UTR part, the last exon's 3' UTR part and UTR-only exons to them, and intronic positions between UTR exons to `{cPos, offset}` on their edges.
- `projectCdsRange` and `projectGenomicRange` draw the UTR bases of a range in the UTR caps (not in protein mode).
- `variantTrack` draws UTR variants at their position in the caps, and intronic variants on the edge of the exon their c. position is anchored on, with a marker pointing into the intron; their hover text and accessible name add the c. position, e.g. `c.441+5G>A (c.441+5)`. `VariantPlacement` gains `intronSide`, `VariantTrackData` gains `intronic`. Protein mode still lists UTR and intronic variants as unplaced, and only they count toward the hidden-feature badges on collapsed introns.
- `segmentBandTrack` draws a genomic span wholly inside an intron as a marker on the nearer exon edge.
- Only features off the transcript (another chromosome, beyond its ends) are listed as unplaced. `variantTrack` and `segmentBandTrack` take a `label`; when several tracks list unplaced features, each list is headed `Unplaced in <label> (N)` and each chip's accessible name ends with the label (`TrackRenderArgs.trackName`).
- New export: `formatCdsPosition(pos, cdsLength)`.
