import { Fragment, type ReactNode } from 'react';
import { resolveSequence } from '../data-source.js';
import {
  isDataSource,
  type CoordinateMapper,
  type DataSource,
  type ExonBaseline,
  type Track,
  type TrackHeightArgs,
  type TrackHeightResult,
  type TrackLoadArgs,
  type TrackRenderArgs,
  type Viewport,
} from '../types.js';
import { livePxPerUnit } from './nucleotide-track.js';

/** Protein sequence lookup, keyed by transcript id. The result is an
 *  IUPAC single-letter amino-acid string (1-indexed: position 1 is the
 *  first residue). Pass a plain string to skip the adapter ceremony
 *  when the host already has the sequence. */
export type ProteinSequenceSource =
  | string
  | DataSource<{ transcriptId: string }, string>;

/** Nucleotide source consumed for aa derivation. The aa track
 *  translates the CDS via the standard codon table when no protein
 *  source is supplied. */
export type NucleotideForAaSource =
  | string
  | DataSource<{ transcriptId: string }, string>;

export interface AaTrackConfig {
  id?: string;
  /** Direct protein sequence source. Takes precedence over
   *  {@link nucleotideSource}. */
  proteinSource?: ProteinSequenceSource;
  /** Nucleotide source used to derive the protein sequence via the
   *  standard codon table. Ignored when {@link proteinSource} is set. */
  nucleotideSource?: NucleotideForAaSource;
  /** Reading-frame offset (0/1/2 bp) applied before codon translation
   *  of the nucleotide source. Default 0 (CDS is in-frame from bp 1). */
  frame?: 0 | 1 | 2;
  /** Minimum live pixels per aa before the track unfurls. Default 14
   *  — enough room to read a single AA glyph. */
  minPxPerAa?: number;
  /** Letter font size in px. The track height is `letterFontPx +
   *  topPad`. Default 12. */
  letterFontPx?: number;
  /** Padding between the ribbon's bottom and the top of the letter
   *  row. Default 2. */
  topPad?: number;
  /** Override the default chemistry-coloured palette. Keyed by
   *  upper-case single-letter aa code; unknown letters fall back to
   *  the `X` colour. */
  palette?: Partial<Record<string, string>>;
}

export interface AaTrackData {
  /** Protein sequence (upper-case). Position 1 = first residue. */
  sequence: string;
}

const DEFAULT_MIN_PX_PER_AA = 14;
const DEFAULT_LETTER_FONT_PX = 12;
const DEFAULT_TOP_PAD = 2;

// Chemistry-coloured palette: hydrophobic / polar / acidic / basic /
// aromatic / cysteine / glycine / proline / stop / unknown. Hosts
// override per-letter via `palette`.
const DEFAULT_AA_PALETTE: Record<string, string> = {
  A: '#4caf50', V: '#4caf50', L: '#4caf50', I: '#4caf50', M: '#4caf50', // hydrophobic
  F: '#7b1fa2', W: '#7b1fa2', Y: '#7b1fa2', // aromatic
  S: '#0288d1', T: '#0288d1', N: '#0288d1', Q: '#0288d1', // polar
  D: '#c62828', E: '#c62828', // acidic
  K: '#1565c0', R: '#1565c0', H: '#1565c0', // basic
  C: '#f9a825', // cysteine
  G: '#616161', // glycine
  P: '#8d6e63', // proline
  '*': '#000000', // stop
  X: '#90a4ae', // unknown
};

/** Standard genetic code (TTT → F, etc.). Stop codons translate to
 *  `*`; any codon containing an `N` or unknown letter resolves to
 *  `X`. */
const CODON_TABLE: Record<string, string> = (() => {
  // Source: NCBI translation table 1.
  const t: Record<string, string> = {};
  const bases = ['T', 'C', 'A', 'G'];
  const aas =
    'FFLLSSSSYY**CC*W' + // T??
    'LLLLPPPPHHQQRRRR' + // C??
    'IIIMTTTTNNKKSSRR' + // A??
    'VVVVAAAADDEEGGGG'; // G??
  let i = 0;
  for (const b1 of bases) {
    for (const b2 of bases) {
      for (const b3 of bases) {
        t[b1 + b2 + b3] = aas[i++]!;
      }
    }
  }
  return t;
})();

/**
 * Slice 29 — per-aa letter glyphs under the exon ribbon. The track
 * collapses to zero height (and renders nothing) until the live zoom
 * gives each aa at least `minPxPerAa` (default 14) of on-screen
 * width. Above the threshold, one glyph appears per visible aa: in
 * CDS modes the letter sits at its codon's centre bp; in protein
 * mode it sits at the aa's baseline position.
 *
 * Derivation: when only a `nucleotideSource` is supplied, the track
 * translates the CDS via the standard codon table (frame-offset
 * configurable), truncating any trailing partial codon.
 */
export function aaTrack(
  config: AaTrackConfig,
): Track<AaTrackConfig, AaTrackData> {
  const id = config.id ?? 'aa-track';
  const minPxPerAa = config.minPxPerAa ?? DEFAULT_MIN_PX_PER_AA;
  const letterFontPx = config.letterFontPx ?? DEFAULT_LETTER_FONT_PX;
  const topPad = config.topPad ?? DEFAULT_TOP_PAD;
  const frame = config.frame ?? 0;
  const palette = { ...DEFAULT_AA_PALETTE, ...(config.palette ?? {}) };

  if (!config.proteinSource && !config.nucleotideSource) {
    throw new Error(
      'aaTrack: pass at least one of `proteinSource` or `nucleotideSource`',
    );
  }

  return {
    id,
    coordSystem: 'protein',
    heightPolicy: 'zoom-dependent',

    async load({ mapper, signal }: TrackLoadArgs): Promise<AaTrackData> {
      const tx = mapper.transcript.transcriptId;
      if (config.proteinSource !== undefined) {
        const seq = await resolveSequence(config.proteinSource, { transcriptId: tx }, signal);
        return { sequence: seq.toUpperCase() };
      }
      const nt = await resolveSequence(config.nucleotideSource!, { transcriptId: tx }, signal);
      return { sequence: translate(nt, frame) };
    },

    height({ viewport }: TrackHeightArgs<AaTrackData>): TrackHeightResult {
      if (livePxPerAa(viewport) < minPxPerAa) {
        return { px: 0, didTruncate: false };
      }
      return { px: letterFontPx + topPad, didTruncate: false };
    },

    render(args: TrackRenderArgs<AaTrackData>): ReactNode {
      const { data, rect, viewport, mapper, painter } = args;
      if (livePxPerAa(viewport) < minPxPerAa) return null;

      const baseline = viewport.baselineGeometry();
      const exonByIdx = new Map<number, ExonBaseline>();
      for (const eb of baseline.exons) exonByIdx.set(eb.exonIdx, eb);

      const lettersByExon = new Map<number, ReactNode[]>();
      const yBaseline = rect.yTop + topPad + letterFontPx * 0.85;
      const trackHeight = rect.yBottom - rect.yTop;
      // Each aa spans 3 CDS bp in CDS modes, or 1 aa-cell in protein mode.
      // Baseline `pxPerBp` is per-bp in CDS modes and per-aa in protein
      // mode, so the multiplier flips with the mode.
      const aaCellWidth =
        viewport.mode === 'protein' ? baseline.pxPerBp : 3 * baseline.pxPerBp;
      const aaCellHalfWidth = aaCellWidth / 2;

      const placements = collectAaPlacements(data.sequence, viewport, mapper);

      for (const { aa, letter, exonIdx, baselineX } of placements) {
        const eb = exonByIdx.get(exonIdx);
        if (!eb) continue;
        const localX = baselineX - eb.xStart;
        const fill = palette[letter] ?? palette.X;
        const arr = lettersByExon.get(exonIdx) ?? [];
        arr.push(
          <Fragment key={`aa-${aa}`}>
            {/* Per-aa cell background — same edge-tiling trick as the
             *  nucleotide track. */}
            <rect
              className="vv-aa-cell"
              x={localX - aaCellHalfWidth}
              y={rect.yTop}
              width={aaCellWidth}
              height={trackHeight}
              fill={fill}
              fillOpacity={0.18}
              data-vv-aa-pos={aa}
            />
            <g
              className="vv-aa-letter-wrap"
              style={{
                transform:
                  `translateX(${localX}px) ` +
                  `scaleX(calc(1 / var(--vv-exon-scale-x-${exonIdx}, 1)))`,
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
                className="vv-aa-letter"
                data-vv-aa={letter}
                data-vv-aa-pos={aa}
              >
                {letter}
              </text>
            </g>
          </Fragment>,
        );
        lettersByExon.set(exonIdx, arr);
      }

      const groups: ReactNode[] = [];
      for (const [exonIdx, letters] of lettersByExon) {
        groups.push(
          painter.placeInExonGroup(
            exonIdx,
            <Fragment key={`aa-exon-${exonIdx}`}>{letters}</Fragment>,
          ),
        );
      }

      return (
        <g className="vv-aa-track" data-vv-track-id={id} key={id}>
          {groups}
        </g>
      );
    },

    toJSON() {
      return {
        id,
        proteinSource: config.proteinSource,
        nucleotideSource: config.nucleotideSource,
        frame,
        minPxPerAa,
        letterFontPx,
        topPad,
        palette: config.palette,
      };
    },
  };
}

interface AaPlacement {
  aa: number;
  letter: string;
  exonIdx: number;
  baselineX: number;
}

function collectAaPlacements(
  sequence: string,
  viewport: Viewport,
  mapper: CoordinateMapper,
): AaPlacement[] {
  const [lo, hi] = viewport.range;
  const out: AaPlacement[] = [];
  if (viewport.mode === 'protein') {
    // Widen by one aa on each side so partial cells at the figure edges
    // still draw — the SVG's overflow clip culls the surplus.
    const aaLo = Math.max(1, Math.floor(lo) - 1);
    const aaHi = Math.min(sequence.length, Math.ceil(hi) + 1);
    for (let aa = aaLo; aa <= aaHi; aa++) {
      const cdsCenter = (aa - 1) * 3 + 2;
      const exonHit = mapper.findExonByCds(cdsCenter);
      if (!exonHit) continue;
      const baselineX = viewport.cdsToBaselineX(aa);
      out.push({
        aa,
        letter: sequence[aa - 1] ?? 'X',
        exonIdx: exonHit.exonIdx,
        baselineX,
      });
    }
    return out;
  }
  // CDS modes: range is in CDS bp. Codon i occupies bp [3i-2, 3i];
  // place the letter at the codon's centre bp (3i-1). The aa cell as a
  // whole spans ruler [3i-2, 3i+1] (cell-edge convention), so aa i is
  // (at least partially) visible iff 3i+1 > lo AND 3i-2 < hi — i.e.,
  // i > (lo-1)/3 AND i < (hi+2)/3. Widen by one aa on each side so float
  // drift and figure-edge partials still render.
  const firstAa = Math.max(1, Math.floor((lo - 1) / 3));
  const lastAa = Math.min(sequence.length, Math.ceil((hi + 2) / 3));
  for (let aa = firstAa; aa <= lastAa; aa++) {
    const cdsCenter = (aa - 1) * 3 + 2;
    if (cdsCenter > mapper.transcript.cdsLength) break;
    const exonHit = mapper.findExonByCds(cdsCenter);
    if (!exonHit) continue;
    const baselineX = viewport.cdsToBaselineX(cdsCenter);
    out.push({
      aa,
      letter: sequence[aa - 1] ?? 'X',
      exonIdx: exonHit.exonIdx,
      baselineX,
    });
  }
  return out;
}

/** Live pixels per aa, accounting for the active viewport mode. In
 *  CDS modes one aa spans three bp, so the px-per-bp scale is
 *  tripled; in protein mode the underlying pxPerBp already encodes
 *  px-per-aa. */
export function livePxPerAa(viewport: Viewport): number {
  const base = livePxPerUnit(viewport);
  return viewport.mode === 'protein' ? base : base * 3;
}

/** Translate a nucleotide string into single-letter aa codes via the
 *  standard genetic code. Any trailing partial codon (< 3 bp) is
 *  dropped — DOD says we never crash on non-multiple-of-three CDS
 *  lengths. */
export function translate(nt: string, frame: 0 | 1 | 2 = 0): string {
  const upper = nt.toUpperCase();
  const out: string[] = [];
  for (let i = frame; i + 3 <= upper.length; i += 3) {
    const codon = upper.slice(i, i + 3);
    out.push(CODON_TABLE[codon] ?? 'X');
  }
  return out.join('');
}

