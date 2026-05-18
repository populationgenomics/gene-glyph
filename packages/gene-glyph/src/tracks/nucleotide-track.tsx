import { Fragment, type ReactNode } from 'react';
import {
  isDataSource,
  type DataSource,
  type ExonBaseline,
  type Track,
  type TrackHeightArgs,
  type TrackHeightResult,
  type TrackLoadArgs,
  type TrackRenderArgs,
  type Viewport,
} from '../types.js';

/** Per-transcript CDS sequence lookup. The source returns the
 *  concatenated CDS string (A/C/G/T/N) for a given `transcriptId` —
 *  position 1 of the string corresponds to CDS bp 1. Pass a plain
 *  string to skip the adapter ceremony when the host already has the
 *  sequence in hand. */
export type NucleotideSource =
  | string
  | DataSource<{ transcriptId: string }, string>;

export type NucleotideLetter = 'A' | 'C' | 'G' | 'T' | 'N' | 'U';

export interface NucleotideTrackConfig {
  id?: string;
  /** CDS sequence (5′→3′) keyed by transcript. */
  source: NucleotideSource;
  /** Minimum live pixels per CDS bp before the track unfurls. Below
   *  this the track reports `height === 0` and renders nothing.
   *  Default 8 — enough room to read a single ACGT glyph. */
  minPxPerBp?: number;
  /** Letter font size in px. The track height is `letterFontPx +
   *  topPad`. Default 12. */
  letterFontPx?: number;
  /** Padding between the exon ribbon's bottom and the top of the
   *  letter row. Default 2. */
  topPad?: number;
  /** Override the default A/C/G/T/N palette. Keyed by upper-case
   *  letter; any unknown letter falls back to the `N` colour. */
  palette?: Partial<Record<NucleotideLetter, string>>;
}

export interface NucleotideTrackData {
  /** CDS sequence (upper-case). May be shorter than `cdsLength` when
   *  the source returned a truncated string; positions past the end
   *  render as `N`. */
  sequence: string;
}

const DEFAULT_MIN_PX_PER_BP = 8;
const DEFAULT_LETTER_FONT_PX = 12;
const DEFAULT_TOP_PAD = 2;

const DEFAULT_NT_PALETTE: Record<NucleotideLetter, string> = {
  A: '#2e7d32',
  C: '#1565c0',
  G: '#ef6c00',
  T: '#c62828',
  U: '#c62828',
  N: '#90a4ae',
};

/**
 * Slice 29 — per-bp nucleotide letters anchored under the exon
 * ribbon. The track collapses to zero height (and renders nothing)
 * until the live zoom exceeds `minPxPerBp`, at which point one glyph
 * appears per visible CDS bp. Letters ride per-exon CSS transforms
 * via the standard counter-scale wrapper so the on-screen font stays
 * crisp regardless of zoom level.
 *
 * Protein mode hides the track entirely (`height === 0`) because CDS
 * bp don't lay out under the aa axis.
 */
export function nucleotideTrack(
  config: NucleotideTrackConfig,
): Track<NucleotideTrackConfig, NucleotideTrackData> {
  const id = config.id ?? 'nucleotide-track';
  const minPxPerBp = config.minPxPerBp ?? DEFAULT_MIN_PX_PER_BP;
  const letterFontPx = config.letterFontPx ?? DEFAULT_LETTER_FONT_PX;
  const topPad = config.topPad ?? DEFAULT_TOP_PAD;
  const palette = { ...DEFAULT_NT_PALETTE, ...(config.palette ?? {}) };
  const source = config.source;

  return {
    id,
    coordSystem: 'cds',
    heightPolicy: 'zoom-dependent',

    async load({ mapper, signal }: TrackLoadArgs): Promise<NucleotideTrackData> {
      const seq = await resolveSequence(source, mapper.transcript.transcriptId, signal);
      return { sequence: seq.toUpperCase() };
    },

    height({ viewport }: TrackHeightArgs<NucleotideTrackData>): TrackHeightResult {
      if (viewport.mode === 'protein') return { px: 0, didTruncate: false };
      if (livePxPerUnit(viewport) < minPxPerBp) {
        return { px: 0, didTruncate: false };
      }
      return { px: letterFontPx + topPad, didTruncate: false };
    },

    render(args: TrackRenderArgs<NucleotideTrackData>): ReactNode {
      const { data, rect, viewport, mapper, painter } = args;
      if (viewport.mode === 'protein') return null;
      if (livePxPerUnit(viewport) < minPxPerBp) return null;

      const baseline = viewport.baselineGeometry();
      const exonByIdx = new Map<number, ExonBaseline>();
      for (const eb of baseline.exons) exonByIdx.set(eb.exonIdx, eb);

      const [lo, hi] = viewport.range;
      const startBp = Math.max(1, Math.floor(lo));
      const endBp = Math.min(mapper.transcript.cdsLength, Math.ceil(hi));

      const lettersByExon = new Map<number, ReactNode[]>();
      const yBaseline = rect.yTop + topPad + letterFontPx * 0.85;

      for (let pos = startBp; pos <= endBp; pos++) {
        const hit = mapper.findExonByCds(pos);
        if (!hit) continue;
        const eb = exonByIdx.get(hit.exonIdx);
        if (!eb) continue;
        const letter = letterAt(data.sequence, pos);
        const baselineX = viewport.cdsToBaselineX(pos);
        const localX = baselineX - eb.xStart;
        const fill = palette[letter] ?? palette.N;
        const arr = lettersByExon.get(hit.exonIdx) ?? [];
        arr.push(
          <g
            key={`nt-${pos}`}
            className="vv-nt-letter-wrap"
            style={{
              transform:
                `translateX(${localX}px) ` +
                `scaleX(calc(1 / var(--vv-exon-scale-x-${hit.exonIdx}, 1)))`,
              transformOrigin: '0 0',
            }}
          >
            <text
              x={0}
              y={yBaseline}
              textAnchor="middle"
              fontSize={letterFontPx}
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              fill={fill}
              className="vv-nt-letter"
              data-vv-nt={letter}
              data-vv-cds-pos={pos}
            >
              {letter}
            </text>
          </g>,
        );
        lettersByExon.set(hit.exonIdx, arr);
      }

      const groups: ReactNode[] = [];
      for (const [exonIdx, letters] of lettersByExon) {
        groups.push(
          painter.placeInExonGroup(
            exonIdx,
            <Fragment key={`nt-exon-${exonIdx}`}>{letters}</Fragment>,
          ),
        );
      }

      return (
        <g className="vv-nucleotide-track" data-vv-track-id={id} key={id}>
          {groups}
        </g>
      );
    },

    toJSON() {
      return {
        id,
        source,
        minPxPerBp,
        letterFontPx,
        topPad,
        palette: config.palette,
      };
    },
  };
}

/** Live pixels per ruler unit (CDS bp in CDS modes, aa in protein
 *  mode). Computed against the public viewport API only — the
 *  current range's baseline-x span vs. the figure width. */
export function livePxPerUnit(viewport: Viewport): number {
  const [lo, hi] = viewport.range;
  const span = viewport.cdsToBaselineX(hi) - viewport.cdsToBaselineX(lo);
  if (span <= 0) return 0;
  const liveZoom = viewport.width / span;
  return viewport.baselineGeometry().pxPerBp * liveZoom;
}

function letterAt(seq: string, cdsPos: number): NucleotideLetter {
  if (cdsPos < 1 || cdsPos > seq.length) return 'N';
  const ch = seq[cdsPos - 1];
  if (ch === 'A' || ch === 'C' || ch === 'G' || ch === 'T' || ch === 'U') {
    return ch;
  }
  return 'N';
}

async function resolveSequence(
  source: NucleotideSource,
  transcriptId: string,
  signal: AbortSignal,
): Promise<string> {
  if (typeof source === 'string') return source;
  if (isDataSource<{ transcriptId: string }, string>(source)) {
    return source.query({ transcriptId }, signal);
  }
  return '';
}
