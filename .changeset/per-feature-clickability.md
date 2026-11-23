---
'@populationgenomics/gene-glyph': minor
---

New prop `isFeatureClickable(featureId, trackId)` says which features can be clicked. Only those get the pointer cursor, `role="button"` and activation on click, Enter and Space; the rest stay hoverable but are not buttons. Without the prop every feature is clickable when `onFeatureClick` is given, as before.

- Variant ticks (tick and stacked styles) and segment bands keep a tab stop whether or not they are clickable, so keyboard users can reach every feature and its tooltip; one the host keeps unclickable is a named graphic (`role="img"`).
- The hidden-feature badges take a tab stop only when clickable.
- Each unplaced chip holds its own control: a `<button>` when the feature is clickable, else a focusable `<span>`, in place of `role="button"` on the `<li>`.
- Tracks read the predicate as `TrackRenderArgs.isFeatureClickable`. The viewer never reports a click on a feature the host keeps unclickable, so a track that does not read it yet (the ClinVar track, whose marks still render as buttons) cannot fire `onFeatureClick` for one either.
