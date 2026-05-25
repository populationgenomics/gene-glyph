import { Fragment, type ReactNode } from 'react';
import { resolveSequence } from '../data-source.js';
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

/** Bases for the donor and acceptor flank of one intron, both written
 *  5′→3′. `donor[0]` is the bp immediately after the upstream exon's
 *  3′ end (c.X+1); `acceptor[acceptor.length - 1]` is the bp
 *  immediately before the downstream exon's 5′ start (c.Y-1). Lengths
 *  should match the flank bp counts the viewport's collapsed-region
 *  spec assigns to this intron — any shortfall renders as `N`. */
export interface IntronicFlankBases {
  intronIdx: number;
  donor: string;
  acceptor: string;
}

/** Optional companion to {@link NucleotideSource} that supplies the
 *  intronic flank bases adjacent to each spliced intron. When wired,
 *  the track renders faint cells under the donor / acceptor flank
 *  ribbons so the visible sequence reads continuously across the
 *  splice junctions. */
export type IntronicFlankSource =
  | IntronicFlankBases[]
  | DataSource<{ transcriptId: string }, IntronicFlankBases[]>;

export interface NucleotideTrackConfig {
  id?: string;
  /** CDS sequence (5′→3′) keyed by transcript. */
  source: NucleotideSource;
  /** Optional intronic flank bases. When supplied, the track draws
   *  faint nucleotide cells over each donor / acceptor flank ribbon
   *  configured by the viewport's collapsed-region spec. */
  flankSource?: IntronicFlankSource;
  /** Opacity multiplier applied to the flank cell backgrounds and
   *  letter glyphs (so the flank readout reads visually subordinate to
   *  the exonic sequence). Default 0.45. */
  flankOpacity?: number;
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
  /** Intronic flank bases, keyed by intronIdx. Each entry stores the
   *  donor and acceptor strings, upper-cased. */
  flanks: Map<number, { donor: string; acceptor: string }>;
}

const DEFAULT_MIN_PX_PER_BP = 8;
const DEFAULT_LETTER_FONT_PX = 12;
const DEFAULT_TOP_PAD = 2;
const DEFAULT_FLANK_OPACITY = 0.45;

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
  const flankOpacity = config.flankOpacity ?? DEFAULT_FLANK_OPACITY;
  const palette = { ...DEFAULT_NT_PALETTE, ...(config.palette ?? {}) };
  const source = config.source;
  const flankSource = config.flankSource;

  return {
    id,
    coordSystem: 'cds',
    heightPolicy: 'zoom-dependent',

    async load({ mapper, signal }: TrackLoadArgs): Promise<NucleotideTrackData> {
      const seq = await resolveSequence(
        source,
        { transcriptId: mapper.transcript.transcriptId },
        signal,
      );
      const flanks = await resolveFlanks(
        flankSource,
        mapper.transcript.transcriptId,
        signal,
      );
      return { sequence: seq.toUpperCase(), flanks };
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
      // Cell N occupies ruler [N, N+1] in viewport.range's cell-edge
      // convention; it's visible whenever any part of that interval
      // overlaps the viewport. Widen the iteration by one cell on each
      // side so partial cells at the figure edges (and any float drift in
      // `lo`/`hi` that lands a strictly-visible cell just past the
      // floor/ceil boundary) still get drawn — the SVG's overflow clip
      // handles the off-screen surplus.
      const startBp = Math.max(1, Math.floor(lo) - 1);
      const endBp = Math.min(mapper.transcript.cdsLength, Math.ceil(hi) + 1);

      const lettersByExon = new Map<number, ReactNode[]>();
      const yBaseline = rect.yTop + topPad + letterFontPx * 0.85;
      const trackHeight = rect.yBottom - rect.yTop;
      const cellHalfWidth = baseline.pxPerBp / 2;

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
          <Fragment key={`nt-${pos}`}>
            {/* Per-cell background. Spans the cell's full pxPerBp width
             *  in baseline coords; the exon group's scaleX expands it to
             *  current screen px. Cells tile across the figure so the
             *  sequence visually reaches both edges — the half-cell that
             *  would otherwise be empty at the leftmost / rightmost
             *  visible cells is filled by that cell's background (the
             *  off-screen half is clipped by the SVG's overflow:hidden). */}
            <rect
              className="vv-nt-cell"
              x={localX - cellHalfWidth}
              y={rect.yTop}
              width={baseline.pxPerBp}
              height={trackHeight}
              fill={fill}
              fillOpacity={0.18}
              data-vv-cds-pos={pos}
            />
            <g
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
            </g>
          </Fragment>,
        );
        lettersByExon.set(hit.exonIdx, arr);
      }

      // Intronic flank cells. Each flank in baseline.flanks has a known
      // bp count and baseline-x range; we render bp-by-bp inside the
      // adjacent exon group (donor → upstream exon's group at local x ≥
      // eb.width; acceptor → downstream exon's group at local x < 0).
      // Cells fade to `flankOpacity` so the intronic readout stays
      // visually subordinate to the exonic sequence.
      if (data.flanks.size > 0) {
        const [sLo, sHi] = viewport.baselineWindow();
        for (const flank of baseline.flanks ?? []) {
          if (flank.xEnd <= sLo || flank.xStart >= sHi) continue;
          const flankBases = data.flanks.get(flank.intronIdx);
          if (!flankBases) continue;
          const baseString =
            flank.side === 'donor' ? flankBases.donor : flankBases.acceptor;
          const hostExonIdx =
            flank.side === 'donor' ? flank.intronIdx : flank.intronIdx + 1;
          const hostEb = exonByIdx.get(hostExonIdx);
          if (!hostEb) continue;
          // Donor cells sit in upstream-exon-local x starting at eb.width;
          // acceptor cells sit in downstream-exon-local x starting at
          // -flank.width. Either way, bp k of the flank string occupies
          // the local-x interval `[base + k*pxPerBp, base + (k+1)*pxPerBp]`.
          const baseLocalX =
            flank.side === 'donor' ? hostEb.width : -flank.width;
          const arr = lettersByExon.get(hostExonIdx) ?? [];
          for (let k = 0; k < flank.bp; k++) {
            const cellLeft = baseLocalX + k * baseline.pxPerBp;
            const cellCenter = cellLeft + cellHalfWidth;
            const letter = flankLetterAt(baseString, k);
            const fill = palette[letter] ?? palette.N;
            const cellKey = `nt-flank-${flank.intronIdx}-${flank.side}-${k}`;
            arr.push(
              <Fragment key={cellKey}>
                <rect
                  className="vv-nt-cell vv-nt-cell-flank"
                  x={cellLeft}
                  y={rect.yTop}
                  width={baseline.pxPerBp}
                  height={trackHeight}
                  fill={fill}
                  fillOpacity={0.18 * flankOpacity}
                  data-vv-intron-idx={flank.intronIdx}
                  data-vv-flank-side={flank.side}
                  data-vv-flank-offset={k}
                />
                <g
                  className="vv-nt-letter-wrap vv-nt-letter-wrap-flank"
                  style={{
                    transform:
                      `translateX(${cellCenter}px) ` +
                      `scaleX(calc(1 / var(--vv-exon-scale-x-${hostExonIdx}, 1)))`,
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
                    fillOpacity={flankOpacity}
                    className="vv-nt-letter vv-nt-letter-flank"
                    data-vv-nt={letter}
                    data-vv-intron-idx={flank.intronIdx}
                    data-vv-flank-side={flank.side}
                    data-vv-flank-offset={k}
                  >
                    {letter}
                  </text>
                </g>
              </Fragment>,
            );
          }
          lettersByExon.set(hostExonIdx, arr);
        }
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
        flankSource,
        flankOpacity,
        minPxPerBp,
        letterFontPx,
        topPad,
        palette: config.palette,
      };
    },
  };
}

function flankLetterAt(seq: string, idx: number): NucleotideLetter {
  if (idx < 0 || idx >= seq.length) return 'N';
  const ch = seq[idx]?.toUpperCase() ?? 'N';
  if (ch === 'A' || ch === 'C' || ch === 'G' || ch === 'T' || ch === 'U') {
    return ch;
  }
  return 'N';
}

async function resolveFlanks(
  source: IntronicFlankSource | undefined,
  transcriptId: string,
  signal: AbortSignal,
): Promise<Map<number, { donor: string; acceptor: string }>> {
  const out = new Map<number, { donor: string; acceptor: string }>();
  if (!source) return out;
  let entries: IntronicFlankBases[];
  if (Array.isArray(source)) {
    entries = source;
  } else if (isDataSource<{ transcriptId: string }, IntronicFlankBases[]>(source)) {
    entries = await source.query({ transcriptId }, signal);
  } else {
    return out;
  }
  for (const e of entries) {
    out.set(e.intronIdx, {
      donor: (e.donor ?? '').toUpperCase(),
      acceptor: (e.acceptor ?? '').toUpperCase(),
    });
  }
  return out;
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

