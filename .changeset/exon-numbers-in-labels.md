---
'@populationgenomics/gene-glyph': patch
---

The hidden-feature badge on a collapsed intron names the exons on either side by `Exon.number`, not by their position in `transcript.exons`, so a transcript that leaves exons out (an exon wholly in a UTR, say) keeps its own numbering.
