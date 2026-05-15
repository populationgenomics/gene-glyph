import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createCoordinateMapper } from './coordinate-mapper.js';
import { layoutTracks } from './layout-engine.js';
import { createSvgPainter } from './painter/svg-painter.js';
import { exonTrack } from './tracks/exon-track.js';
import {
  isTrackGroup,
  type InteractionState,
  type ProteinAnnotations,
  type Track,
  type TrackOrGroup,
  type Transcript,
  type ViewMode,
} from './types.js';
import { ViewportController } from './viewport.js';

export interface GeneGlyphProps {
  transcript: Transcript;
  protein?: ProteinAnnotations | null;
  /** Track list, ordered top to bottom. Defaults to a single `exonTrack`. */
  tracks?: TrackOrGroup[];
  /** Logical width of the figure SVG in viewBox units. Default 1000. */
  width?: number;
  /** Initial view mode. Default `cds-with-introns`. */
  mode?: ViewMode;
  /** Maximum vertical height budget for the track stack. Default 200. */
  trackHeightBudget?: number;
  /** Controlled-prop: feature id currently hovered by the host (e.g., from a
   *  table row). Tracks render the matching feature with a hover lift. */
  hoveredFeatureId?: string | null;
  /** Controlled-prop: feature ids currently selected by the host. Tracks
   *  render the matching features with a selection ring. Accepts a Set or any
   *  iterable for ergonomic callers. */
  selectedFeatureIds?: ReadonlySet<string> | Iterable<string>;
  /** Fires when the cursor enters a feature (with featureId) or leaves all
   *  features (`null`). The originating track id is passed for hosts that
   *  multiplex over tracks. */
  onHover?: (featureId: string | null, trackId: string) => void;
  /** Fires when a feature is clicked. */
  onFeatureClick?: (featureId: string, trackId: string) => void;
  className?: string;
  children?: ReactNode;
}

function flattenTracks(items: TrackOrGroup[]): Track[] {
  const out: Track[] = [];
  for (const item of items) {
    if (isTrackGroup(item)) {
      for (const t of item.tracks) out.push(t);
    } else {
      out.push(item);
    }
  }
  return out;
}

function toReadonlySet(ids: ReadonlySet<string> | Iterable<string> | undefined): ReadonlySet<string> {
  if (!ids) return EMPTY_SET;
  if (ids instanceof Set) return ids;
  return new Set(ids);
}

const EMPTY_SET: ReadonlySet<string> = new Set<string>();

export function GeneGlyph({
  transcript,
  protein,
  tracks,
  width = 1000,
  mode = 'cds-with-introns',
  trackHeightBudget = 200,
  hoveredFeatureId = null,
  selectedFeatureIds,
  onHover,
  onFeatureClick,
  className,
}: GeneGlyphProps) {
  const trackList = useMemo<TrackOrGroup[]>(
    () => (tracks && tracks.length > 0 ? tracks : [exonTrack({})]),
    [tracks],
  );
  const flatTracks = useMemo(() => flattenTracks(trackList), [trackList]);
  const mapper = useMemo(() => createCoordinateMapper(transcript), [transcript]);
  const viewport = useMemo(
    () => new ViewportController({ mapper, width, mode }),
    [mapper, width, mode],
  );
  const painter = useMemo(() => createSvgPainter({ mode: 'screen' }), []);

  const svgRef = useRef<SVGSVGElement | null>(null);
  useLayoutEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    viewport.attach(el);
    return () => viewport.detach();
  }, [viewport]);

  const [trackData, setTrackData] = useState<Map<string, unknown>>(() => new Map());
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    void Promise.all(
      flatTracks.map(async (t) => {
        const data = await t.load({ viewport, mapper, signal: controller.signal });
        return [t.id, data] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      setTrackData(new Map(entries));
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [flatTracks, viewport, mapper]);

  const layout = useMemo(
    () =>
      layoutTracks({
        tracks: trackList,
        viewport,
        data: trackData,
        totalHeightBudget: trackHeightBudget,
      }),
    [trackList, viewport, trackData, trackHeightBudget],
  );

  const totalHeight = Math.max(1, layout.totalHeight);

  const selectedSet = useMemo(() => toReadonlySet(selectedFeatureIds), [selectedFeatureIds]);
  const interaction = useMemo<InteractionState>(
    () => ({
      hoveredFeatureId,
      selectedFeatureIds: selectedSet,
      brushRange: null,
    }),
    [hoveredFeatureId, selectedSet],
  );

  const handleHover = useCallback(
    (trackId: string, featureId: string | null) => {
      onHover?.(featureId, trackId);
    },
    [onHover],
  );

  const handleClick = useCallback(
    (trackId: string, featureId: string) => {
      onFeatureClick?.(featureId, trackId);
    },
    [onFeatureClick],
  );

  const aaLength = Math.floor(transcript.cdsLength / 3);
  const aria = `${transcript.geneSymbol} (${transcript.transcriptId}) — ${aaLength} aa`;

  const trackRenderArgsFor = (t: Track) => {
    const rect = layout.trackRects.get(t.id);
    if (!rect) return null;
    const data = trackData.get(t.id);
    if (data === undefined) return null;
    return {
      data,
      rect,
      viewport,
      mapper,
      interaction,
      painter,
      onFeatureHover: (featureId: string | null) => handleHover(t.id, featureId),
      onFeatureClick: (featureId: string) => handleClick(t.id, featureId),
    };
  };

  const belowNodes: ReactNode[] = [];
  for (const t of flatTracks) {
    if (!t.renderBelow) continue;
    const args = trackRenderArgsFor(t);
    if (!args) continue;
    const node = t.renderBelow(args);
    if (node) belowNodes.push(<div key={t.id}>{node}</div>);
  }

  return (
    <div className={['gene-glyph', className].filter(Boolean).join(' ')} data-testid="gene-glyph">
      <GeneGlyphHeader transcript={transcript} protein={protein ?? null} />
      <svg
        ref={svgRef}
        className="vv-figure"
        viewBox={`0 0 ${width} ${totalHeight}`}
        preserveAspectRatio="xMidYMid meet"
        width="100%"
        height={totalHeight}
        role="img"
        aria-label={aria}
      >
        <title>{aria}</title>
        {flatTracks.map((t) => {
          const args = trackRenderArgsFor(t);
          if (!args) return null;
          return (
            <g key={t.id} data-vv-track-id={t.id}>
              {t.render(args)}
            </g>
          );
        })}
      </svg>
      {belowNodes.length > 0 && (
        <div className="vv-below" data-testid="gene-glyph-below">
          {belowNodes}
        </div>
      )}
    </div>
  );
}

interface HeaderProps {
  transcript: Transcript;
  protein: ProteinAnnotations | null;
}

function GeneGlyphHeader({ transcript, protein }: HeaderProps) {
  const cdsLen = Math.max(1, transcript.cdsLength);
  return (
    <div className="vv-header" data-testid="gene-glyph-header">
      <span className="vv-header-left">
        <span className="vv-gene-symbol">{transcript.geneSymbol}</span>
        <span className="vv-sep"> · </span>
        <span className="vv-transcript-id">{transcript.transcriptId}</span>
        {transcript.isManeSelect && (
          <>
            <span className="vv-sep"> · </span>
            <span className="vv-mane-badge" title="MANE Select transcript">
              MANE Select
            </span>
          </>
        )}
        {protein?.alphafoldId && (
          <>
            <span className="vv-sep"> · </span>
            <a
              className="vv-alphafold-link"
              href={`https://alphafold.ebi.ac.uk/entry/${protein.alphafoldId}`}
              target="_blank"
              rel="noopener noreferrer"
              title="Open AlphaFold structure"
            >
              AlphaFold ↗
            </a>
          </>
        )}
      </span>
      <span className="vv-header-right">
        <span className="vv-strand">{transcript.strand === '+' ? "5' →" : "← 5'"}</span>
        <span className="vv-sep"> · </span>
        <span className="vv-cds-length">{cdsLen.toLocaleString()} nt CDS</span>
      </span>
    </div>
  );
}
