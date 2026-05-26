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
| `selected`      | Variant id (e.g. `17-7675236-A-G`)                                  | _absent_       | Pre-select a variant. The detail card opens and the matching marker draws its selection ring. Survives chip toggles: if the selected variant gets filtered out, the card hides until the matching chip is re-enabled.           |
| `collapsed`     | CSV of group ids                                                    | see "Collapse" | Override the set of folded ClinVar groups. The param's _presence_ (even empty: `?collapsed=`) overrides the default; only its absence falls back to the default-collapsed state.                                                |
| `hide`          | CSV of track ids (see below)                                        | _empty_        | Tracks to omit from the figure entirely.                                                                                                                                                                                        |

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
suppresses them even when zoomed in.

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
switchers, group fold, variant selection) update the URL via
`history.replaceState`. Back/forward navigation is unaffected — the
browser's history stack stays clean.

## Examples

- PTEN at compact density, with benign and likely-benign filtered out
  and the nucleotide + aa rows hidden:

      embed.html?transcript=ENST00000371953&density=compact&excluded=benign,likely_benign&hide=nucleotide,aa

- TP53 in protein mode with a specific variant selected:

      embed.html?transcript=ENST00000269305&mode=protein&selected=17-7675236-A-G

- CFTR with everything expanded (no collapsed groups) and a
  no-VUS-no-conflicting view:

      embed.html?transcript=ENST00000003084&collapsed=&excluded=uncertain_significance,conflicting
