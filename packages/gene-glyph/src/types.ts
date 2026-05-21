import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Domain types — the public data contract.
// ---------------------------------------------------------------------------

export interface Exon {
  number: number;
  cdsStart: number;
  cdsEnd: number;
  genomicStart: number;
  genomicEnd: number;
  chr: string;
}

export interface Transcript {
  geneSymbol: string;
  transcriptId: string;
  isManeSelect?: boolean;
  cdsLength: number;
  strand: '+' | '-';
  exons: Exon[];
}

export type ProteinDomainEntryType =
  | 'domain'
  | 'family'
  | 'repeat'
  | 'homologous_superfamily'
  | 'conserved_site'
  | 'active_site'
  | 'binding_site'
  | 'ptm'
  | 'unspecified';

export interface ProteinDomain {
  aaStart: number;
  aaEnd: number;
  source: string;
  sourceId: string;
  shortName: string;
  description: string;
  entryType: ProteinDomainEntryType;
}

export interface ProteinAnnotations {
  uniprotAcc: string;
  length: number;
  alphafoldId?: string;
  domains: ProteinDomain[];
}

export type VariantCategory =
  | 'missense'
  | 'nonsense'
  | 'synonymous'
  | 'frameshift'
  | 'inframe_indel'
  | 'splice'
  | 'start_lost'
  | 'stop_lost'
  | 'regulatory'
  | 'utr'
  | 'intronic'
  | 'structural'
  | 'other'
  | 'unknown';

/** A position in one of the three biological coordinate systems. The
 *  tagged union lets callers hand any-coord-typed data straight to the
 *  viewport's projection methods without a `(viewport.mode, coordSystem)`
 *  branch on the caller side — the dispatch happens once inside
 *  {@link Viewport.toScreen} / {@link Viewport.toBaselineX}, not at every
 *  callsite that needs to place a feature. */
export type Position =
  | { kind: 'cds'; cPos: number; offset: number }
  | { kind: 'protein'; aa: number }
  | { kind: 'genomic'; chr: string; pos: number };

/** Coord payload carried by ViewerVariant. Same shape as {@link Position}
 *  by design — host data adapters produce variants in any coord system,
 *  and tracks hand them straight to the viewport without translation. */
export type VariantCoord = Position;

export interface ViewerVariant {
  id: string;
  label: string;
  coord: VariantCoord;
  category: VariantCategory;
  meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Data sources
// ---------------------------------------------------------------------------

export interface ViewportQuery {
  mode: ViewMode;
  range: readonly [number, number];
}

export type DataSourceFreshness = 'on-viewport-change' | 'sticky' | 'realtime';

export interface DataSource<TQuery, TResult> {
  readonly id: string;
  cacheKey(query: TQuery): string;
  query(query: TQuery, signal: AbortSignal): Promise<TResult>;
  freshness?: DataSourceFreshness;
}

export function isDataSource<TQuery, TResult>(
  value: unknown,
): value is DataSource<TQuery, TResult> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { query?: unknown }).query === 'function' &&
    typeof (value as { id?: unknown }).id === 'string'
  );
}

/** Per-track load lifecycle reported via `onTrackStateChange`. Hosts use this
 *  to drive their own loading UI or telemetry. The viewer renders a default
 *  shimmer affordance over the track's y-range while `state === 'loading'`,
 *  and desaturates feature fills via `[data-vv-stale]` during the
 *  pre-`track.load` debounce window. Slice 18. */
export type TrackLoadState = 'loading' | 'ready' | 'error';

// ---------------------------------------------------------------------------
// Viewport types
// ---------------------------------------------------------------------------

export type ViewMode = 'genome' | 'transcript' | 'protein';

/** Default-binding profile applied to user gestures on the figure. `standard`
 *  enables drag-pan, wheel-pan, Cmd/Ctrl+wheel-zoom, pinch-zoom, and keyboard;
 *  `embed` is the same set minus wheel-zoom (so the viewer doesn't fight a
 *  scrolling host page); `fullscreen` is the same as `standard` for now and
 *  exists as a hook for later (e.g. modal viewers that opt into wheel-zoom
 *  without modifiers). */
export type InteractionMode = 'standard' | 'embed' | 'fullscreen';

/** Tag passed to `onViewportChange` so hosts can distinguish user gestures
 *  from programmatic updates (e.g. for telemetry or undo stacks). */
export type ViewportChangeReason =
  | 'drag'
  | 'wheel'
  | 'wheel-zoom'
  | 'pinch'
  | 'keyboard'
  | 'imperative';

export type CoordSystem = 'genomic' | 'cds' | 'protein';

export interface CdsPosition {
  cPos: number;
  offset: number;
}

/** A region of the gene marked for *soft* (display-only) collapse. The
 *  endpoints are given in HGVS c. coordinates — `cPos` is the bracketing
 *  exonic CDS bp, and `offset` is the intronic offset (`+N` past an exon's
 *  3' end, `-N` before an exon's 5' end; `0` for exonic positions). Soft
 *  collapse renders the named range at a fixed pixel budget while leaving
 *  the surrounding linear regions to scale with zoom — that's what
 *  produces the splice-site-aware genome view.
 *
 *  Spec semantics:
 *  - In `genome` mode, every region in the spec becomes a fixed-budget
 *    intron-bulk segment. Linear flanks around it (the bp between an
 *    exon edge and the spec's nearest collapse boundary) scale with zoom.
 *  - In `transcript` / `protein` modes, intronic spec entries are
 *    subsumed by the mode's hard collapse and don't affect rendering.
 *  - Endpoints are inclusive: `start` is the first compressed bp,
 *    `end` is the last. */
export interface CollapsedRegion {
  start: CdsPosition;
  end: CdsPosition;
}

export interface GenomicPosition {
  chr: string;
  pos: number;
}

export interface RangeSegment {
  xStart: number;
  xEnd: number;
  exonIdx: number;
}

/** Description of one range fragment that the projection couldn't render in
 *  the visible-exon frame. `intronic` carries the bracketing exon pair so a
 *  track that aggregates hidden-feature counts (Slice 15) can index by intron
 *  gap; `out-of-bounds` carries no extra detail. */
export type DroppedRange =
  | { kind: 'intronic'; exonIdxA: number; exonIdxB: number }
  | { kind: 'out-of-bounds' };

export interface RangeProjection {
  segments: RangeSegment[];
  droppedIntronicCount: number;
  droppedExonicCount: number;
  droppedRanges: DroppedRange[];
}

/** Hidden-feature count contributed by one track for one intron gap (Slice
 *  15). The viewer sums these across tracks and surfaces the totals to the
 *  exon track as `TrackRenderArgs.hiddenByIntron` so the exon track can render
 *  a single count badge per gap. `featureIds` is optional metadata for hosts
 *  that want to drive a popover from the click callback. */
export interface HiddenFeatureBucket {
  exonIdxA: number;
  exonIdxB: number;
  count: number;
  featureIds?: string[];
}

export type AnchorTarget =
  | { kind: 'feature'; trackId: string; featureId: string }
  | { kind: 'intron-boundary'; exonIdx: number; side: 'donor' | 'acceptor' }
  | { kind: 'protein-aa'; aa: number }
  | { kind: 'cds-pos'; cPos: number; offset?: number }
  | { kind: 'genomic-pos'; chr: string; pos: number };

export interface ScreenPoint {
  x: number;
  y: number;
}

/** Args passed to {@link GeneGlyphProps.renderTooltip}. Slice 17 ships hover
 *  tooltips as the first overlay kind; future overlay anchors (intron
 *  boundaries, "you are here" markers) reuse the same `point` contract. */
export interface TooltipRenderArgs {
  trackId: string;
  featureId: string;
  /** Track-specific feature payload, resolved via
   *  {@link Track.resolveFeature}. `undefined` when the track does not
   *  implement the hook. */
  feature: unknown;
  /** Anchor position in figure-SVG viewBox units; viewer converts to client
   *  pixels for overlay placement. Hosts rarely need this — included for
   *  symmetry with imperative overlay APIs landing in later slices. */
  point: ScreenPoint;
}

export interface CoordinateMapper {
  readonly transcript: Transcript;
  genomicToCds(chr: string, pos: number): CdsPosition | null;
  cdsToGenomic(cPos: number, offset: number): GenomicPosition | null;
  cdsToProtein(cPos: number): number | null;
  proteinToCds(aa: number): number;
  findExonByCds(cPos: number): { exonIdx: number } | null;
  findExonByGenomic(chr: string, pos: number): { exonIdx: number } | null;
  /** Reduce a {@link Position} (any coord system) to a CDS `(cPos, offset)`
   *  pair. Returns `null` for genomic positions that don't land on the
   *  transcript. Lets callers stop hand-rolling the same
   *  `switch (coord.kind)` reduction at every site that needs a unified
   *  CDS view of a tagged coord. */
  resolveCds(pos: Position): CdsPosition | null;
}

/** Per-exon rectangle in baseline screen-x. Exposed to tracks via
 *  {@link Viewport.baselineGeometry}; tracks render features against this
 *  frame so React never reissues SVG attribute widths on pan or zoom — only
 *  the wrapping `<g>` transforms change, and CSS transitions those. */
export interface ExonBaseline {
  exonIdx: number;
  xStart: number;
  xEnd: number;
  width: number;
}

export interface GapBaseline {
  exonIdxA: number;
  exonIdxB: number;
  xStart: number;
  xEnd: number;
  width: number;
  /** Phase 3: scale behaviour of this gap under zoom. `'fixed-budget'`
   *  means the gap stays at its baseline pixel width regardless of
   *  zoom (the soft-collapsed bulk-intron case). `'linear'` means it
   *  scales with the surrounding exon content (transcript mode's 1bp
   *  transition; protein mode's zero-width gap). Optional for
   *  backwards compat — buildSegments falls back to inferring from
   *  the global `gapPx` when unset. */
  scaleRule?: 'linear' | 'fixed-budget';
}

/** Phase 3: per-intron flank piece — the linear-scale region of an
 *  intron immediately adjacent to its bracketing exons. Donor flanks
 *  sit on the upstream-exon side of the intron (5' end); acceptor
 *  flanks on the downstream-exon side (3' end). Each flank carries
 *  the bp count it covers so {@link buildSegments} can map ruler
 *  positions through it. */
export interface FlankBaseline {
  intronIdx: number;
  side: 'donor' | 'acceptor';
  bp: number;
  xStart: number;
  xEnd: number;
  width: number;
}

export interface BaselineGeometry {
  exons: ExonBaseline[];
  gaps: GapBaseline[];
  /** Phase 3: per-intron linear-scale flank pieces. Empty (or
   *  undefined) when no soft-collapse spec is in effect. In genome
   *  mode with the default spec, each intron contributes a donor and
   *  acceptor flank so the 10bp splice-site sequence scales with the
   *  surrounding exon content while the bulk between them stays at a
   *  fixed pixel budget. */
  flanks?: FlankBaseline[];
  pxPerBp: number;
  gapPx: number;
  totalWidth: number;
}

export interface Viewport {
  readonly mode: ViewMode;
  readonly intronScale: number;
  /** Visible ruler range. Derived from {@link baselineWindow} via the
   *  segment walk — round-trip-exact for windows whose endpoints sit in
   *  exonic regions; snaps to the nearest cell-boundary when an endpoint
   *  sits inside a fixed-budget gap (where the synthetic ruler has zero
   *  span and the inverse is ambiguous). */
  readonly range: readonly [number, number];
  readonly width: number;
  /** Natural fit-gene ruler range for the active mode. CDS bp in CDS
   *  modes, aa in protein mode. Stable until the mode or transcript
   *  changes; chrome / minimap code uses it as the thumbnail span. */
  naturalRange(): readonly [number, number];
  /** Canonical viewport state in display (baseline) coordinates: `[S_lo,
   *  S_hi]` in fit-gene baseline-x. The figure renders this slice of the
   *  baseline to current-x `[0, width]`. Pan / zoom operate on this state
   *  directly so the gesture math doesn't round-trip through the ruler. */
  baselineWindow(): readonly [number, number];

  /** Project a {@link Position} (any coord system) onto current screen-x.
   *  Returns `null` when the position can't be placed in the active mode
   *  — intronic offsets, genomic positions outside any exon, or positions
   *  panned out of the current viewport. The single entry point replaces
   *  the three-door `cdsToScreen` / `proteinToScreen` / `genomicToScreen`
   *  trio for callers that carry tagged coords. */
  toScreen(pos: Position): number | null;
  /** Project a {@link Position} onto fit-gene baseline-x. Same null
   *  contract as {@link toScreen}, but never returns null because of
   *  out-of-viewport — only for unplaceable coords (intronic offsets,
   *  off-transcript genomic positions). Tracks rendering against the
   *  baseline-x frame use this to anchor features. */
  toBaselineX(pos: Position): number | null;

  cdsToScreen(cPos: number, offset: number): number | null;
  proteinToScreen(aa: number): number | null;
  genomicToScreen(chr: string, pos: number): number | null;

  /** Project a current screen-x back into a {@link Position} of the
   *  requested coord system. Inverse of {@link toScreen}; the two paths
   *  share the same ruler conversion so the round-trip can't diverge.
   *  Returns `null` for off-figure x or unresolvable positions. The
   *  return type narrows to the requested kind so callers don't have
   *  to re-check `.kind`. */
  screenToPosition<K extends 'cds' | 'protein' | 'genomic'>(
    x: number,
    kind: K,
  ): Extract<Position, { kind: K }> | null;
  screenToCds(x: number): CdsPosition | null;
  screenToProtein(x: number): number | null;
  screenToGenomic(x: number): GenomicPosition | null;

  /** Ruler → baseline screen-x. CDS bp in CDS modes, aa in protein mode.
   *  Always returns a finite value (extrapolates past the gene's edges). */
  cdsToBaselineX(rulerPos: number): number;
  /** Inverse of {@link cdsToBaselineX}. CDS bp in CDS modes, aa in protein
   *  mode. Fractional; callers round if they want a discrete ruler value.
   *  Slice 26 surfaced this on the public interface so direct-manipulation
   *  chrome embedded as a track (overviewTrack) can map cursor positions
   *  back to ruler coords without reaching for the controller subclass. */
  baselineXToRuler(x: number): number;
  /** Live screen-x → baseline screen-x. The figure renders exons via per-
   *  exon CSS transforms that aren't a uniform scale (inter-exon gaps stay
   *  at their baseline pixel width regardless of zoom — see the publish
   *  comment in {@link ViewportController.publish}); the live-to-baseline
   *  mapping therefore isn't just `(currentX / zoom + S_lo)`. Slice 26
   *  exposes this on the public interface so the overview track can mark
   *  the *actually-visible* baseline range, including past-the-gene-end
   *  padding zones. Extrapolates linearly past the last exon. */
  screenToBaselineX(currentX: number): number;
  /** Live scale factor applied to exon-body baseline pixels — the screen
   *  width that 1 baseline-px of exon takes at the current zoom. In modes
   *  without fixed-budget elements this is `width / visibleBaselineSpan`.
   *  In genome mode it diverges from the screen-space `zoomFactor()` when
   *  the visible window contains any fixed-budget gap budget: gap pixels
   *  stay at their fixed budget, so exon content scales up to consume the
   *  remaining screen pixels. Pan / wheel-pan use this to make 1 viewbox-
   *  px of drag move exon content by exactly 1 px on screen (gap content
   *  shifts at 1:1 baseline = `1/exonScale` of a screen-px, lagging
   *  slightly — the intentional consequence of the fixed-budget design). */
  exonScale(): number;
  /** Local screen-to-baseline scale at a given current-x — the screen
   *  width that 1 baseline-px takes at this *specific* point on the
   *  figure. In modes with a uniform mapping this equals `exonScale()`
   *  everywhere; in `genome` mode it returns the exon scale inside
   *  exon segments, 1 inside a fixed-budget gap bulk, and the padding
   *  scale in the 5'/3' padding zone. Pan uses this to make a Δviewbox
   *  drag move the baseline UNDER THE CURSOR by exactly Δviewbox
   *  pixels — so whatever the user grabs stays under their pointer. */
  localScreenScaleAt(currentX: number): number;
  /** Viewport-independent geometry at fit-gene zoom. Tracks render against
   *  this frame; the wrapping exon/intron `<g>` elements carry the live
   *  translate + scale derived from the current range. */
  baselineGeometry(): BaselineGeometry;

  projectCdsRange(start: number, end: number): RangeProjection;
  projectProteinRange(aaStart: number, aaEnd: number): RangeProjection;
  projectGenomicRange(chr: string, start: number, end: number): RangeProjection;

  resolveAnchor(target: AnchorTarget): ScreenPoint | null;
}

// ---------------------------------------------------------------------------
// Track abstractions
// ---------------------------------------------------------------------------

export type HeightPolicy = 'fixed' | 'data-dependent' | 'zoom-dependent';

export interface TrackRect {
  yTop: number;
  yBottom: number;
}

export interface TrackHeightHint {
  maxPx: number;
}

export interface TrackHeightResult {
  px: number;
  didTruncate: boolean;
  droppedCount?: number;
}

export interface InteractionState {
  hoveredFeatureId: string | null;
  selectedFeatureIds: ReadonlySet<string>;
  brushRange: readonly [number, number] | null;
}

export interface TrackLoadArgs {
  viewport: Viewport;
  mapper: CoordinateMapper;
  signal: AbortSignal;
  /** ProteinAnnotations passed to `<GeneGlyph>` as the `protein` prop, or
   *  `null` when the host didn't provide one. Protein-coord tracks (Pfam,
   *  InterPro, AlphaMissense, MAVE) read their data from here instead of
   *  taking it as track config — the host already knows where the protein
   *  record lives for the chosen transcript, so requiring tracks to
   *  redeclare it would be ceremony without payoff. */
  protein: ProteinAnnotations | null;
}

export interface TrackHeightArgs<TData> {
  data: TData | null;
  viewport: Viewport;
  hint: TrackHeightHint;
}

/** Args passed to {@link Track.renderMinimap}. The minimap is a pure
 *  display-space artifact: the track is handed a target width and height
 *  in pixels and asked to render its content at fit-gene scale, decoupled
 *  from the figure's live zoom / pan / CSS-variable transforms. Tracks
 *  that have no meaningful thumbnail (overlay-only tracks, the overview
 *  track itself) omit the hook and the host minimap skips them. Slice 26. */
export interface MinimapRenderArgs<TData> {
  data: TData;
  /** Target width in viewBox pixels. The track should fill `[0, width]`
   *  on the x axis. */
  width: number;
  /** Target height in viewBox pixels. The track should fill `[0, height]`
   *  on the y axis. */
  height: number;
  /** Pre-built mini-viewport at the target width, pinned to fit-gene zoom
   *  in the current mode. Tracks can use its `baselineGeometry()` to read
   *  per-exon screen positions and widths without recomputing them. */
  viewport: Viewport;
  mapper: CoordinateMapper;
  painter: Painter;
}

export interface TrackRenderArgs<TData> {
  data: TData;
  rect: TrackRect;
  viewport: Viewport;
  mapper: CoordinateMapper;
  interaction: InteractionState;
  painter: Painter;
  /** Per-intron-gap counts of features hidden by the current viewport. The
   *  viewer aggregates {@link Track.hiddenFeaturesByIntron} across every track
   *  and passes the totals here so a single track (the exon track by default)
   *  can render one indicator per gap rather than each track stacking its own.
   *  Keys are `${exonIdxA}:${exonIdxB}`. Optional so tests can construct
   *  render-args without a viewer; production renders always receive a map
   *  (empty when no track contributes). */
  hiddenByIntron?: ReadonlyMap<string, HiddenFeatureBucket>;
  /** Fires when the cursor enters or leaves a feature in this track; pass
   *  `null` for leave. Tracks wire this onto the per-feature `<g>` they
   *  render. The viewer maps it onto the host's `onHover` prop. */
  onFeatureHover?: (featureId: string | null) => void;
  /** Fires when a feature in this track is clicked. The viewer maps it onto
   *  the host's `onFeatureClick` prop. */
  onFeatureClick?: (featureId: string) => void;
}

export interface HiddenFeaturesArgs<TData> {
  data: TData;
  viewport: Viewport;
  mapper: CoordinateMapper;
}

export interface Track<TConfig = unknown, TData = unknown> {
  readonly id: string;
  /** Optional human-readable label surfaced to gutter render-props via the
   *  {@link GutterItem} for this track. When a track sits inside a
   *  {@link TrackGroup} (e.g. the entry-type sub-tracks emitted by
   *  `interProTrack`), the label conveys the sub-track's category so a
   *  multi-level gutter can render the nesting structure. Hosts can render
   *  the label however they like — italic small-caps for entry-types,
   *  bold for primary tracks — by branching on `kind` / `item.id` in the
   *  render-prop. */
  readonly label?: string;
  readonly coordSystem: CoordSystem;
  readonly heightPolicy: HeightPolicy;
  load(args: TrackLoadArgs): Promise<TData>;
  height(args: TrackHeightArgs<TData>): TrackHeightResult;
  /** Per-intron-gap hidden-feature counts contributed by this track. The
   *  viewer aggregates these across tracks and exposes the totals via
   *  {@link TrackRenderArgs.hiddenByIntron}; tracks that don't drop features
   *  in collapsed introns can omit this. */
  hiddenFeaturesByIntron?(args: HiddenFeaturesArgs<TData>): HiddenFeatureBucket[];
  render(args: TrackRenderArgs<TData>): ReactNode;
  /** Optional minimap representation of this track at a fixed pixel size,
   *  decoupled from the figure's live viewport. The overview track (and
   *  any host-supplied minimap chrome) invokes this to compose a
   *  display-space thumbnail of the track stack — exons appear at
   *  fit-gene baseline, features (variants, domains, etc.) at the same
   *  scale. Tracks that don't have a useful thumbnail (the overview track
   *  itself, overlay-only tracks) omit this hook. Slice 26. */
  renderMinimap?(args: MinimapRenderArgs<TData>): ReactNode | null;
  /** Optional DOM rendered below the figure SVG (e.g., unplaced-feature
   *  lists). Lives in a sibling `<div class="vv-below">` outside the figure
   *  so it never leaks into export. Slice 7 introduces formal slots; this
   *  hook keeps the below-figure surface simple until then. */
  renderBelow?(args: TrackRenderArgs<TData>): ReactNode | null;
  resolveAnchor?(data: TData, anchorId: string, viewport: Viewport): ScreenPoint | null;
  /** Resolve the track-specific feature object for `featureId`. The viewer
   *  passes the returned value to host-supplied
   *  {@link GeneGlyphProps.renderTooltip} so hosts can render rich tooltips
   *  without re-resolving from their own data. Slice 17. */
  resolveFeature?(data: TData, featureId: string): unknown;
  /** Short label for the viewer's built-in tooltip. Used when the host has
   *  not supplied {@link GeneGlyphProps.renderTooltip}. Returning `null`
   *  (or omitting the hook) suppresses the default tooltip. Slice 17. */
  featureLabel?(data: TData, featureId: string): string | null;
  toJSON(): TConfig;
}

export interface TrackGroup {
  kind: 'group';
  id: string;
  label: string;
  defaultExpanded?: boolean;
  gapAbove?: number;
  heightBudget?: number;
  tracks: Track[];
}

export type TrackOrGroup = Track | TrackGroup;

export function isTrackGroup(item: TrackOrGroup): item is TrackGroup {
  return (item as TrackGroup).kind === 'group';
}

// ---------------------------------------------------------------------------
// Painter
// ---------------------------------------------------------------------------

export interface DrawRectArgs {
  x: number;
  y: number;
  width: number;
  height: number;
  rx?: number;
  ry?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  vectorEffect?: string;
  className?: string;
  onClick?: () => void;
  key?: string | number;
}

export interface DrawLineArgs {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke?: string;
  strokeWidth?: number;
  className?: string;
  key?: string | number;
}

export interface DrawTextArgs {
  x: number;
  y: number;
  text: string;
  fontSize?: number;
  fill?: string;
  textAnchor?: 'start' | 'middle' | 'end';
  dominantBaseline?: 'auto' | 'middle' | 'hanging' | 'central';
  className?: string;
  key?: string | number;
}

export interface DrawPathArgs {
  d: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  className?: string;
  key?: string | number;
}

export interface DrawCircleArgs {
  cx: number;
  cy: number;
  r: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  className?: string;
  key?: string | number;
}

export interface GroupArgs {
  className?: string;
  style?: Record<string, string | number>;
  children: ReactNode;
  key?: string | number;
}

export type PainterMode = 'screen' | 'export';

export interface Painter {
  readonly mode: PainterMode;
  placeInExonGroup(exonIdx: number, content: ReactNode): ReactNode;
  placeInInterExon(exonIdxA: number, exonIdxB: number, content: ReactNode): ReactNode;
  placeAbsolute(x: number, y: number, content: ReactNode): ReactNode;
  drawRect(args: DrawRectArgs): ReactNode;
  drawLine(args: DrawLineArgs): ReactNode;
  drawText(args: DrawTextArgs): ReactNode;
  drawPath(args: DrawPathArgs): ReactNode;
  drawCircle(args: DrawCircleArgs): ReactNode;
  group(args: GroupArgs): ReactNode;
  color(varName: string, fallback?: string): string;
}
