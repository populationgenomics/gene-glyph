---
'@populationgenomics/gene-glyph': minor
---

`segmentBandTrack` accepts `coordSystem: 'genomic'`. Each datum then carries a `chr` alongside `start` / `end` (1-based inclusive genomic positions, `start <= end` on either strand), typed as `GenomicSegmentBandDatum`. A span draws over the coding exon bases it covers, one piece per exon, in every view mode; intronic parts and parts outside the coding exons (UTR, flanking sequence, another chromosome) are not drawn, and a span with no coding base draws nothing. `SegmentBandTrackConfig` is now a union of `CodingSegmentBandTrackConfig` (`'cds' | 'protein'`) and `GenomicSegmentBandTrackConfig`; the shared fields are exported as `SegmentBandTrackOptions`.
