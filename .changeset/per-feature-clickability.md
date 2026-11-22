---
'@populationgenomics/gene-glyph': minor
---

New prop `isFeatureClickable(featureId, trackId)` says which features can be clicked. Only those get the pointer cursor, `role="button"`, a tab stop, and activation on click, Enter and Space; the rest stay hoverable but are not buttons. Without the prop every feature is clickable when `onFeatureClick` is given, as before, and with no `onFeatureClick` no feature is a button (previously every variant was marked `role="button"` regardless). Variants (tick and stacked), segment bands, unplaced chips and the hidden-feature badges follow it; tracks read it as `TrackRenderArgs.isFeatureClickable`. The viewer never reports a click on a feature the host keeps unclickable, so a track that does not read it yet (the ClinVar track, whose marks still render as buttons) cannot fire `onFeatureClick` for one either.
