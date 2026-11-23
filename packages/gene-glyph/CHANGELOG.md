# @populationgenomics/gene-glyph

## 1.2.0

### Minor Changes

- 3ce4158: `segmentBandTrack` draws a 1 px outline around each band, so touching or overlapping bands with the same fill read as separate bands. The default colour is the `--vv-segment-band-outline` CSS variable, falling back to a translucent dark edge (`rgba(15, 23, 42, 0.45)`) that darkens any fill. The new `outline` option takes a colour, or `null` for the previous outline-free bars.
  
  The default outline colour is declared in the default, print and dark-theme blocks of `styles.css`, and `toJSON()` includes `outline`.
- f066ce8: `segmentBandTrack` draws overlapping bands in stacked rows instead of painting them over each other, so each stays visible, hoverable and clickable. Rows are packed greedily in span order (bands on adjacent bases share a row; genomic bands on different chromosomes never stack), each row is `heightPx` tall with 2 px between rows, and the track's height grows to fit (`heightPolicy` is now `'data-dependent'`). `SegmentBandTrackData` gains `rows` (feature id to row) and `rowCount`. `onOverlapWarning` still fires once per overlapping pair, for hosts whose data should never overlap.
- 9e7b371: `Exon` takes an optional `blocks: AlignmentBlock[]` for a transcript that aligns to the genome with indels. Each block is an ungapped run of the exon's coding part, `{cdsStart, genomicStart, length}`, listed in transcript order, with `genomicStart` the run's lowest coordinate on either strand. With blocks, every genomic <-> c. mapping goes through them: `genomicToCds` returns `null` for a genomic base the transcript lacks, `cdsToGenomic` returns `null` for a c. position the genome lacks, and genomic variants and genomic band spans are placed accordingly (a band across a c. gap covers the transcript-only bases with it). `createCoordinateMapper` throws on blocks that overlap, are out of transcript order, or reach outside their exon. Exons without blocks map linearly, as before.
  
  The mapper exposes the result as `CoordinateMapper.mappedExons` (`MappedExon[]`, each with its `AlignedRun`s), computed once per mapper; the viewport reads it rather than recomputing.
- da875ef: No hover text uses the native `title` attribute or an SVG `<title>` any more; every hover surface goes through the viewer's tooltip.
  
  - The built-in header's MANE badge, the unplaced chips, and Pfam / InterPro domains (rects and labels) open the viewer's tooltip and fire `onHover`. Header hovers use `trackId` `HEADER_TOOLTIP_TRACK_ID` and `featureId` `'mane-select'`. Domains carry their full name as `aria-label`; the AlphaFold link has an `aria-label`.
  - Tooltips open on keyboard focus as well as hover, ClinVar marks included. The MANE badge takes a tab stop and is named "MANE Select transcript"; each Pfam / InterPro domain takes one tab stop.
  - `TooltipRenderArgs` gains optional `label` (the built-in text) and `anchor` (the hovered surface's box in viewport pixels, `TooltipAnchor`). The viewer always sets both.
  - New prop `renderTooltipPanel(args)`: the viewer draws no tooltip of its own and mounts what the host returns, so a host can render every hover surface with its own tooltip component placed against `args.anchor`. The viewer still keeps one tooltip open at a time.
  - Escape dismisses the open tooltip; it stays shut until the pointer reaches another surface.
  - `TrackRenderArgs.onFeatureHover` takes an optional anchor element for surfaces outside the figure SVG.
- b02dc28: New prop `isFeatureClickable(featureId, trackId)` says which features can be clicked. Only those get the pointer cursor, `role="button"` and activation on click, Enter and Space; the rest stay hoverable but are not buttons. Without the prop every feature is clickable when `onFeatureClick` is given, as before.
  
  - Variant ticks (tick and stacked styles) and segment bands keep a tab stop whether or not they are clickable, so keyboard users can reach every feature and its tooltip; one the host keeps unclickable is a named graphic (`role="img"`).
  - The hidden-feature badges take a tab stop only when clickable.
  - Each unplaced chip holds its own control: a `<button>` when the feature is clickable, else a focusable `<span>`, in place of `role="button"` on the `<li>`.
  - Tracks read the predicate as `TrackRenderArgs.isFeatureClickable`. The viewer never reports a click on a feature the host keeps unclickable, so a track that does not read it yet (the ClinVar track, whose marks still render as buttons) cannot fire `onFeatureClick` for one either.
- 0245c5c: Variants and bands outside the CDS are drawn in genome and transcript modes.
  
  - `Transcript` takes optional `utr5Exons` and `utr3Exons` (`UtrExon[]`: `number`, `chr`, `genomicStart`, `genomicEnd`) for exons wholly in a UTR. They are drawn in the first exon's 5' cap and the last exon's 3' cap, beside that exon's own `utr5Bp` / `utr3Bp` part. UTR positions sit on the c. ruler as `cPos = 1 - N` for c.-N and `cdsLength + N` for c.*N.
  - New `CoordinateMapper` methods map the whole transcript, UTRs included: `genomicToTranscript(chr, pos)`, `transcriptToGenomic(cPos, offset)` and `resolveTranscript(pos)`. `genomicToCds`, `cdsToGenomic` and `resolveCds` keep their coding-part-only behaviour.
  - New `Viewport` methods: `placePosition(pos): ExonPlacement | null` (where a feature is drawn: UTR positions in the caps, intronic ones on the exon edge they are anchored on, with `intronSide`; nothing outside the coding parts in protein mode) and `baselineXToScreen(baselineX)`.
  - Rendering changes for data hosts already pass: `variantTrack` draws UTR variants at their position in the caps, and intronic variants on their exon edge with a marker pointing into the intron; their hover text and accessible name add the c. position, e.g. `c.441+5G>A (c.441+5)`. `projectCdsRange` / `projectGenomicRange` include UTR bases, so bands draw over them in the caps, and a genomic band wholly inside an intron draws as a marker on the nearer exon edge. Features the figure now draws leave the "Unplaced" lists and the hidden-feature badges; everything still not drawn (off the transcript, intronic offsets not on an exon edge, and in protein mode anything outside the coding parts) keeps them. These are additive rendering changes, not API changes.
  - `VariantPlacement` gains `intronSide`, `VariantTrackData` gains `intronic`. `variantTrack` and `segmentBandTrack` take a `label`; when more than one track lists unplaced features, the viewer wraps each list in a group named for its track.
  - The `Painter` argument types gain optional fields: `DrawRectArgs.fillOpacity` / `strokeOpacity`, `DrawPathArgs.vectorEffect`, and on `GroupArgs` a feature id, attributes, an accessible name, a tab stop and pointer, focus and key handlers.
  - New exports: `formatCdsPosition(pos, cdsLength)`, `UtrExon`, `ExonPlacement`.

### Patch Changes

- 9a41058: The hidden-feature badge on a collapsed intron names the exons on either side by `Exon.number`, not by their position in `transcript.exons`, so a transcript that leaves exons out (an exon wholly in a UTR, say) keeps its own numbering.

## 1.1.1

### Patch Changes

- 7065bff: Publish to the public npm registry (npmjs.org) via trusted publishing, with provenance. Consumers that mapped `@populationgenomics` to CPG's Artifact Registry in `.npmrc` can drop that mapping.

## 1.1.0

### Minor Changes

- ffbc77d: `segmentBandTrack` accepts `coordSystem: 'genomic'`. Each datum then carries a `chr` alongside `start` / `end` (1-based inclusive genomic positions, `start <= end` on either strand), typed as `GenomicSegmentBandDatum`; `chr` must equal the transcript's `Exon.chr` exactly. A span draws over the coding exon bases it covers, one piece per exon, in every view mode; intronic parts and parts outside the coding exons (UTR, flanking sequence, another chromosome) are not drawn. `SegmentBandTrackConfig` is now a union of `CodingSegmentBandTrackConfig` (`'cds' | 'protein'`) and `GenomicSegmentBandTrackConfig`; the shared fields are exported as `SegmentBandTrackOptions`, and `SegmentBandTrackData` takes the datum type as a second parameter.
  
  Band tracks in every coordinate system now:
  
  - show the standard tooltip on hover and report clicks through `GeneGlyph`'s `onFeatureClick` (feature id = the datum's `id`, or a fallback built from the span, category and, for genomic bands, `chr`);
  - list bands that draw nothing in the current view below the figure as "Unplaced (N)" chips, like the variant track;
  - report an overlap with any earlier span still open, not only the previous one.
  
  In protein mode, a CDS or genomic range covering only the downstream bases of a codon split across an exon junction now draws at that codon's cell instead of nothing.

## 1.0.1

### Patch Changes

- b73742a: Add `[data-vv-reduce-motion]` attribute hook in the stylesheet that mirrors the existing `@media (prefers-reduced-motion: reduce)` rule. Hosts can set this attribute on any ancestor of a `<GeneGlyph>` to force animations off for testing or for app-level motion preferences that don't propagate through OS media queries (Slice 12).
