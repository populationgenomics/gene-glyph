---
'@populationgenomics/gene-glyph': minor
---

`segmentBandTrack` accepts `coordSystem: 'genomic'`. Each datum then carries a `chr` alongside `start` / `end` (1-based inclusive genomic positions, `start <= end` on either strand), typed as `GenomicSegmentBandDatum`; `chr` must equal the transcript's `Exon.chr` exactly. A span draws over the coding exon bases it covers, one piece per exon, in every view mode; intronic parts and parts outside the coding exons (UTR, flanking sequence, another chromosome) are not drawn. `SegmentBandTrackConfig` is now a union of `CodingSegmentBandTrackConfig` (`'cds' | 'protein'`) and `GenomicSegmentBandTrackConfig`; the shared fields are exported as `SegmentBandTrackOptions`, and `SegmentBandTrackData` takes the datum type as a second parameter.

Band tracks in every coordinate system now:

- show the standard tooltip on hover and report clicks through `GeneGlyph`'s `onFeatureClick` (feature id = the datum's `id`, or a fallback built from the span, category and, for genomic bands, `chr`);
- list bands that draw nothing in the current view below the figure as "Unplaced (N)" chips, like the variant track;
- report an overlap with any earlier span still open, not only the previous one.

In protein mode, a CDS or genomic range covering only the downstream bases of a codon split across an exon junction now draws at that codon's cell instead of nothing.
