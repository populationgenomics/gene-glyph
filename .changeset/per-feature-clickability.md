---
'@populationgenomics/gene-glyph': minor
---

New prop `isFeatureClickable(featureId, trackId)` says which features can be clicked. Only those get the pointer cursor, `role="button"`, a tab stop, and activation on click, Enter and Space; the rest stay hoverable but are not buttons. Without the prop every feature is clickable when `onFeatureClick` is given, as before, and with no `onFeatureClick` no feature is a button (previously every variant was marked `role="button"` regardless). Applies to variants (tick and stacked), segment bands, unplaced chips and the hidden-feature badges; tracks read it as `TrackRenderArgs.isFeatureClickable`.
