export { GeneGlyph } from './viewer.js';
export type {
  GeneGlyphProps,
  GeneGlyphRef,
  FitTarget,
  ViewportInfo,
  GutterItem,
  LeftGutterProps,
  RightGutterProps,
  HeaderProps,
  FooterProps,
} from './viewer.js';

export type {
  // Domain
  Exon,
  Transcript,
  ProteinAnnotations,
  ProteinDomain,
  ProteinDomainEntryType,
  ViewerVariant,
  VariantCategory,
  VariantCoord,
  // Data sources
  DataSource,
  DataSourceFreshness,
  ViewportQuery,
  // Viewport
  CoordSystem,
  ViewMode,
  InteractionMode,
  ViewportChangeReason,
  CdsPosition,
  GenomicPosition,
  RangeProjection,
  RangeSegment,
  DroppedRange,
  HiddenFeatureBucket,
  HiddenFeaturesArgs,
  AnchorTarget,
  ScreenPoint,
  TooltipRenderArgs,
  CoordinateMapper,
  Viewport,
  // Tracks
  Track,
  TrackGroup,
  TrackOrGroup,
  TrackRect,
  TrackHeightHint,
  TrackHeightResult,
  TrackLoadArgs,
  TrackHeightArgs,
  TrackRenderArgs,
  HeightPolicy,
  InteractionState,
  TrackLoadState,
  // Painter
  Painter,
  PainterMode,
  DrawRectArgs,
  DrawLineArgs,
  DrawTextArgs,
  DrawPathArgs,
  DrawCircleArgs,
  GroupArgs,
} from './types.js';

export { isTrackGroup, isDataSource } from './types.js';

export { createCachedDataSource } from './data-source.js';
export type { CachedDataSourceOptions } from './data-source.js';

export { exportSvgString, exportPngBlob } from './export.js';
export type { ExportArgs, PrepareExportInput } from './export.js';

export { createCoordinateMapper } from './coordinate-mapper.js';
export {
  ViewportController,
  DEFAULT_TRANSITION_MS,
  DEFAULT_MAX_ZOOM,
  VIEWPORT_PAN_PADDING,
} from './viewport.js';
export type {
  ViewportControllerInit,
  TransitionTarget,
  TransitionOptions,
} from './viewport.js';
export { layoutTracks } from './layout-engine.js';
export type { LayoutEngineArgs, LayoutItem, LayoutResult } from './layout-engine.js';
export { createSvgPainter } from './painter/svg-painter.js';
export type { SvgPainterOptions } from './painter/svg-painter.js';
export { exonTrack } from './tracks/exon-track.js';
export type { ExonTrackConfig } from './tracks/exon-track.js';
export {
  variantTrack,
  partitionVariants,
  variantIntronGap,
  variantRulerPos,
} from './tracks/variant-track.js';
export type {
  VariantTrackConfig,
  VariantTrackData,
  VariantSource,
  VariantPlacement,
  VariantPartition,
} from './tracks/variant-track.js';
export { pfamTrack, domainHue, fitText } from './tracks/pfam-track.js';
export type { PfamTrackConfig, PfamTrackData } from './tracks/pfam-track.js';
export { interProTrack, interProEntryTypeLabel } from './tracks/interpro-track.js';
export type {
  InterProTrackConfig,
  InterProSubTrackData,
} from './tracks/interpro-track.js';
export { packLanes } from './pack-lanes.js';
export type { LaneInput, PackedItem, PackResult } from './pack-lanes.js';
