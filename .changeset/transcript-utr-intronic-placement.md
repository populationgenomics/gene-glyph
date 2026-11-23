---
'@populationgenomics/gene-glyph': minor
---

Variants and bands outside the CDS are drawn in genome and transcript modes.

- `Transcript` takes optional `utr5Exons` and `utr3Exons` (`UtrExon[]`: `number`, `chr`, `genomicStart`, `genomicEnd`) for exons wholly in a UTR. They are drawn in the first exon's 5' cap and the last exon's 3' cap, beside that exon's own `utr5Bp` / `utr3Bp` part. UTR positions sit on the c. ruler as `cPos = 1 - N` for c.-N and `cdsLength + N` for c.*N.
- New `CoordinateMapper` methods map the whole transcript, UTRs included: `genomicToTranscript(chr, pos)`, `transcriptToGenomic(cPos, offset)` and `resolveTranscript(pos)`. `genomicToCds`, `cdsToGenomic` and `resolveCds` keep their coding-part-only behaviour.
- New `Viewport` methods: `placePosition(pos): ExonPlacement | null` (where a feature is drawn: UTR positions in the caps, intronic ones on the exon edge they are anchored on, with `intronSide`; nothing outside the coding parts in protein mode) and `baselineXToScreen(baselineX)`.
- Rendering changes for data hosts already pass: `variantTrack` draws UTR variants at their position in the caps, and intronic variants on their exon edge with a marker pointing into the intron; their hover text and accessible name add the c. position, e.g. `c.441+5G>A (c.441+5)`. `projectCdsRange` / `projectGenomicRange` include UTR bases, so bands draw over them in the caps, and a genomic band wholly inside an intron draws as a marker on the nearer exon edge. Features the figure now draws leave the "Unplaced" lists and the hidden-feature badges; everything still not drawn (off the transcript, intronic offsets not on an exon edge, and in protein mode anything outside the coding parts) keeps them. These are additive rendering changes, not API changes.
- `VariantPlacement` gains `intronSide`, `VariantTrackData` gains `intronic`. `variantTrack` and `segmentBandTrack` take a `label`; when more than one track lists unplaced features, the viewer wraps each list in a group named for its track.
- The `Painter` argument types gain optional fields: `DrawRectArgs.fillOpacity` / `strokeOpacity`, `DrawPathArgs.vectorEffect`, and on `GroupArgs` a feature id, attributes, an accessible name, a tab stop and pointer, focus and key handlers.
- New exports: `formatCdsPosition(pos, cdsLength)`, `UtrExon`, `ExonPlacement`.
