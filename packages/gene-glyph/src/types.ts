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

export type VariantCoord =
  | { kind: 'cds'; cPos: number; offset: number }
  | { kind: 'protein'; aa: number }
  | { kind: 'genomic'; chr: string; pos: number };

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

// ---------------------------------------------------------------------------
// Viewport types
// ---------------------------------------------------------------------------

export type ViewMode = 'cds-with-introns' | 'cds-spliced' | 'protein';

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

export interface GenomicPosition {
  chr: string;
  pos: number;
}

export interface RangeSegment {
  xStart: number;
  xEnd: number;
  exonIdx: number;
}

export interface DroppedRange {
  kind: 'intronic' | 'out-of-bounds';
  near?: { exonIdx: number };
}

export interface RangeProjection {
  segments: RangeSegment[];
  droppedIntronicCount: number;
  droppedExonicCount: number;
  droppedRanges: DroppedRange[];
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

export interface CoordinateMapper {
  readonly transcript: Transcript;
  genomicToCds(chr: string, pos: number): CdsPosition | null;
  cdsToGenomic(cPos: number, offset: number): GenomicPosition | null;
  cdsToProtein(cPos: number): number | null;
  proteinToCds(aa: number): number;
  findExonByCds(cPos: number): { exonIdx: number } | null;
  findExonByGenomic(chr: string, pos: number): { exonIdx: number } | null;
}

export interface Viewport {
  readonly mode: ViewMode;
  readonly intronScale: number;
  readonly range: readonly [number, number];
  readonly width: number;

  cdsToScreen(cPos: number, offset: number): number | null;
  proteinToScreen(aa: number): number | null;
  genomicToScreen(chr: string, pos: number): number | null;

  screenToCds(x: number): CdsPosition | null;
  screenToProtein(x: number): number | null;
  screenToGenomic(x: number): GenomicPosition | null;

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

export interface TrackRenderArgs<TData> {
  data: TData;
  rect: TrackRect;
  viewport: Viewport;
  mapper: CoordinateMapper;
  interaction: InteractionState;
  painter: Painter;
  /** Fires when the cursor enters or leaves a feature in this track; pass
   *  `null` for leave. Tracks wire this onto the per-feature `<g>` they
   *  render. The viewer maps it onto the host's `onHover` prop. */
  onFeatureHover?: (featureId: string | null) => void;
  /** Fires when a feature in this track is clicked. The viewer maps it onto
   *  the host's `onFeatureClick` prop. */
  onFeatureClick?: (featureId: string) => void;
}

export interface Track<TConfig = unknown, TData = unknown> {
  readonly id: string;
  readonly coordSystem: CoordSystem;
  readonly heightPolicy: HeightPolicy;
  load(args: TrackLoadArgs): Promise<TData>;
  height(args: TrackHeightArgs<TData>): TrackHeightResult;
  render(args: TrackRenderArgs<TData>): ReactNode;
  /** Optional DOM rendered below the figure SVG (e.g., unplaced-feature
   *  lists). Lives in a sibling `<div class="vv-below">` outside the figure
   *  so it never leaks into export. Slice 7 introduces formal slots; this
   *  hook keeps the below-figure surface simple until then. */
  renderBelow?(args: TrackRenderArgs<TData>): ReactNode | null;
  resolveAnchor?(data: TData, anchorId: string, viewport: Viewport): ScreenPoint | null;
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
