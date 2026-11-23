---
'@populationgenomics/gene-glyph': minor
---

`Exon` takes an optional `blocks: AlignmentBlock[]` for a transcript that aligns to the genome with indels. Each block is an ungapped run of the exon's coding part, `{cdsStart, genomicStart, length}`, listed in transcript order, with `genomicStart` the run's lowest coordinate on either strand. With blocks, every genomic <-> c. mapping goes through them: `genomicToCds` returns `null` for a genomic base the transcript lacks, `cdsToGenomic` returns `null` for a c. position the genome lacks, and genomic variants and genomic band spans are placed accordingly (a band across a c. gap covers the transcript-only bases with it). `createCoordinateMapper` throws on blocks that overlap, are out of transcript order, or reach outside their exon. Exons without blocks map linearly, as before.

The mapper exposes the result as `CoordinateMapper.mappedExons` (`MappedExon[]`, each with its `AlignedRun`s), computed once per mapper; the viewport reads it rather than recomputing.
