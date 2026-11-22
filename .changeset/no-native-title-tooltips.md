---
'@populationgenomics/gene-glyph': minor
---

No hover text uses the native `title` attribute or an SVG `<title>` any more; every hover surface goes through the viewer's tooltip.

- The built-in header's MANE badge, the unplaced chips, and Pfam / InterPro domains (rects and labels) open the viewer's tooltip and fire `onHover`. Header hovers use `trackId` `HEADER_TOOLTIP_TRACK_ID` and `featureId` `'mane-select'`. Domains carry their full name as `aria-label`; the AlphaFold link has an `aria-label`.
- `TooltipRenderArgs` gains `label` (the built-in text) and `anchor` (the hovered surface's box in viewport pixels, `TooltipAnchor`).
- New prop `renderTooltipPanel(args)`: the viewer draws no tooltip of its own and mounts what the host returns, so a host can render every hover surface with its own tooltip component placed against `args.anchor`. The viewer still keeps one tooltip open at a time.
- Escape dismisses the open tooltip; it stays shut until the pointer leaves that surface.
- `TrackRenderArgs.onFeatureHover` takes an optional anchor element for surfaces outside the figure SVG.
