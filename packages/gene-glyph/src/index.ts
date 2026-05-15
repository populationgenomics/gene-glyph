export { GeneGlyph } from './viewer.js';
export type { GeneGlyphProps } from './viewer.js';

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
  CdsPosition,
  GenomicPosition,
  RangeProjection,
  RangeSegment,
  DroppedRange,
  AnchorTarget,
  ScreenPoint,
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

export { createCoordinateMapper } from './coordinate-mapper.js';
export { ViewportController } from './viewport.js';
export type { ViewportControllerInit } from './viewport.js';
export { layoutTracks } from './layout-engine.js';
export type { LayoutEngineArgs, LayoutItem, LayoutResult } from './layout-engine.js';
export { createSvgPainter } from './painter/svg-painter.js';
export type { SvgPainterOptions } from './painter/svg-painter.js';
export { exonTrack } from './tracks/exon-track.js';
export type { ExonTrackConfig } from './tracks/exon-track.js';
export { variantTrack, partitionVariants } from './tracks/variant-track.js';
export type {
  VariantTrackConfig,
  VariantTrackData,
  VariantSource,
  VariantPlacement,
  VariantPartition,
} from './tracks/variant-track.js';
