# Embed view — query parameters

The embed view at `embed.html` renders a single gene figure pinned by a
transcript id, with its full visual state in the URL. Every selector that
the page exposes is mirrored to the query string so the same view can be
linked to from a report, an issue, or another dashboard.

## Required

| Param        | Values            | Notes                                                                                                  |
| ------------ | ----------------- | ------------------------------------------------------------------------------------------------------ |
| `transcript` | Ensembl `ENST…` id | The page renders an error when this is missing. Non-canonical ids are auto-redirected to the gene's canonical transcript unless `force=1` is also set. |

## Optional

Only values that differ from the defaults are written to the URL — a
freshly-opened, untouched embed reads as `?transcript=ENST…` with nothing
else.

| Param           | Values                                                              | Default        | Effect                                                                                                                                                                                                                          |
| --------------- | ------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `force`         | `1` / `true`                                                        | _absent_       | Disable the "redirect non-canonical → canonical" step. Use to view a specific non-canonical transcript verbatim.                                                                                                                |
| `mode`          | `genome` / `transcript` / `protein`                                 | `transcript`   | Initial view mode. `genome` adds the intron decoration / splice-site flanks; `transcript` collapses introns to zero-width junctions; `protein` lays out by amino-acid coordinates.                                              |
| `density`       | `compact` / `normal` / `roomy`                                      | `normal`       | Per-row pitch + marker radius for the stacked ClinVar tracks. `compact` ≈ half the vertical pitch of `normal`; `roomy` trades that back.                                                                                        |
| `excluded`      | CSV of clinical-significance values (see below)                     | _empty_        | Significance chips that start excluded. Plain-click a chip in the page toggles a single value; shift-click solos the chip within its row.                                                                                       |
| `excludedStars` | CSV of integers `0`–`4`                                             | _empty_        | Review-star chips that start excluded. `0` = no stars, `1`–`4` = 1–4 review stars.                                                                                                                                              |
| `excludedTypes` | CSV of variant-type values (see below)                              | _empty_        | Variant-type chips that start excluded. Each value maps a class of gnomAD `major_consequence` SO terms.                                                                                                                         |
| `selected`      | Variant id or 8-hex FNV-1a hash (see "Selection" below)              | _absent_       | Pre-select a variant. The detail card opens, the matching marker draws its selection ring, and a full-figure-height drop-line / range overlay highlights the variant's coordinate span. Survives chip toggles: if the selected variant gets filtered out, the card hides until the matching chip is re-enabled. |
| `collapsed`     | CSV of group ids                                                    | see "Collapse" | Override the set of folded ClinVar groups. The param's _presence_ (even empty: `?collapsed=`) overrides the default; only its absence falls back to the default-collapsed state.                                                |
| `hide`          | CSV of track ids (see below)                                        | _empty_        | Tracks to omit from the figure entirely.                                                                                                                                                                                        |
| `variants`      | CSV of user-supplied variants (see "User variants" below)            | _empty_        | Renders a purple-cross row of user variants between the exon and InterPro tracks. Empty value (or absent param) hides the row entirely.                                                                                          |

### Significance values (`excluded`)

`pathogenic`, `likely_pathogenic`, `uncertain_significance`,
`likely_benign`, `benign`, `conflicting`. Anything else in the CSV is
ignored.

### Variant-type values (`excludedTypes`)

Each value maps a coarse bucket of gnomAD's `major_consequence` SO
terms:

| Value           | gnomAD `major_consequence` mapping                                |
| --------------- | ------------------------------------------------------------------ |
| `missense`      | `missense_variant`                                                 |
| `nonsense`      | `stop_gained`, `stop_lost`, `start_lost`                           |
| `frameshift`    | `frameshift_variant`                                               |
| `splice`        | any `splice_*` (`splice_donor_variant`, `splice_acceptor_variant`, `splice_region_variant`, …) |
| `inframe_indel` | `inframe_insertion`, `inframe_deletion`                            |
| `synonymous`    | `synonymous_variant`, `stop_retained_variant`                      |
| `utr`           | `*_utr_variant`, `non_coding_transcript_exon_variant`              |
| `other`         | anything not matched above                                         |

### Track ids (`hide`)

`scale`, `exon`, `nucleotide`, `aa`, `interpro`, `clinvar`. The
`nucleotide` and `aa` tracks already collapse to zero height until live
`pxPerBp` / `pxPerAa` exceeds their unfurl threshold — `hide=nucleotide`
suppresses them even when zoomed in. The `user-variants` track has no
`hide` toggle: its visibility is governed by the `variants` parameter.

### User variants (`variants`)

The embed accepts a clinician-pasteable list of variants alongside
ClinVar. Format: one variant per entry, separated by `,` (URL) or
newlines (modal). Accepted forms:

| Form              | Example                | Notes                                       |
| ----------------- | ---------------------- | ------------------------------------------- |
| gnomAD canonical  | `17-7674212-C-A`       | Direct match against ClinVar id space.      |
| Tab-style         | `17:7674212C>T`        | Optional `chr` prefix, lowercase tolerated. |
| Dash-style        | `17:7674212-C-T`       | Same.                                       |
| HGVS transcript-relative | `c.524G>A`, `n.41A>G`, `p.Arg175His` | Routed through VariantValidator (GRCh38, transcript-set Ensembl). |

Each entry normalises to the gnomAD form `chr-pos-REF-ALT` (no `chr`
prefix) for internal use — both `?variants=17:7674212C>T` and
`?variants=17-7674212-C-T` produce the same id. Unparseable entries
collect into a footer note ("N variants couldn't be parsed: …") and
don't block the figure. HGVS resolution failures (VV unreachable, no
GRCh38 mapping, missing accession) fall into the same footer; all
canonical entries still render.

#### Editing in-page

Press `V` (or click the `+` button in the toolbar) to open the
spotlight-style **Edit variants** modal. The textarea pre-populates
with the current `?variants=` contents, one per line. `Cmd/Ctrl+Enter`
submits, `Esc` (or clicking outside) cancels. Submit replaces the
entire variant set — clearing the textarea then submitting removes
the row entirely.

The `V` hotkey is suppressed when an editable element (textarea,
text-shaped input, contentEditable) already has focus.

### Selection (`selected`)

`?selected=` accepts either the canonical variant id
(`17-7675236-A-G`) or its 8-hex FNV-1a hash (`a1b2c3d4`). New selections
emitted by the page use the hash form so long deletion ids stay short
in the URL; raw-canonical pre-Slice-35 share links keep working.
Selecting any variant (ClinVar or user-supplied) draws a full-figure
drop-line and range overlay tied to the variant's reference span;
SNVs degrade to a dashed vertical line, multi-bp variants to a
translucent rect spanning the affected range.

### Collapse default

When `collapsed` is absent, the page starts with the parent `ClinVar`
group _and_ all per-significance subgroups collapsed — so the figure
opens at one row per significance row showing the per-sig summary
butterflies. To open the embed with everything expanded, pass
`?collapsed=` (empty value). To open with a specific subset collapsed,
pass `collapsed=clinvar-group,clinvar-pathogenic`.

Group ids:

- `clinvar-group` — the parent ClinVar wrapper.
- `clinvar-pathogenic`, `clinvar-likely_pathogenic`,
  `clinvar-uncertain_significance`, `clinvar-likely_benign`,
  `clinvar-benign`, `clinvar-conflicting` — per-significance subgroups.

## Live URL sync

State changes inside the page (chip toggles, mode/density/track
switchers, group fold, variant selection, modal submit) update the URL
via `history.replaceState`. Back/forward navigation is unaffected —
the browser's history stack stays clean.

## Examples

- PTEN at compact density, with benign and likely-benign filtered out
  and the nucleotide + aa rows hidden:

      embed.html?transcript=ENST00000371953&density=compact&excluded=benign,likely_benign&hide=nucleotide,aa

- TP53 in protein mode with a specific variant selected:

      embed.html?transcript=ENST00000269305&mode=protein&selected=17-7675236-A-G

- CFTR with everything expanded (no collapsed groups) and a
  no-VUS-no-conflicting view:

      embed.html?transcript=ENST00000003084&collapsed=&excluded=uncertain_significance,conflicting

- TP53 with two user-supplied variants (one canonical, one HGVS routed
  through VariantValidator):

      embed.html?transcript=ENST00000269305&variants=17-7674212-C-T,c.524G%3EA
