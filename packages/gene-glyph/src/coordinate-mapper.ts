import type {
  CdsPosition,
  CollapsedRegion,
  CoordinateMapper,
  Exon,
  GenomicPosition,
  Position,
  Transcript,
} from './types.js';

/** Default soft-collapse spec — one region per intron, compressing
 *  everything except the first `flankBp` and last `flankBp` of each
 *  intron. The 10bp default matches the conventional "splice-site
 *  preservation" window so the donor / acceptor consensus sequences
 *  stay linear under zoom while the deep-intron bulk stays at a
 *  fixed pixel budget. Hosts can pass their own
 *  `collapsedRegions` prop to override this — leaving an intronic
 *  range out of the spec keeps it linear (i.e., expanded); adding a
 *  range covering exonic bp compresses that too. */
export function defaultCollapsedRegions(transcript: Transcript, flankBp = 10): CollapsedRegion[] {
  const regions: CollapsedRegion[] = [];
  for (let i = 0; i < transcript.exons.length - 1; i++) {
    const upstream = transcript.exons[i]!;
    const downstream = transcript.exons[i + 1]!;
    regions.push({
      // c.{upstream.cdsEnd}+(flankBp+1) — first bp past the donor flank.
      start: { cPos: upstream.cdsEnd, offset: flankBp + 1 },
      // c.{downstream.cdsStart}-(flankBp+1) — last bp before the acceptor flank.
      end: { cPos: downstream.cdsStart, offset: -(flankBp + 1) },
    });
  }
  return regions;
}

/** An ungapped run of transcribed bases: `length` bases from ruler
 *  position `rulerStart` (c. position in CDS modes), aligned to the genome
 *  from `genomicStart`, its lowest coordinate on either strand. */
export interface AlignedRun {
  rulerStart: number;
  genomicStart: number;
  length: number;
}

/** An exon as the coordinate mapper and the viewport's range projection
 *  see it: its transcribed span in genomic and c. coordinates, and the
 *  runs that align the two. `exonIdx` indexes `transcript.exons`. */
export interface MappedExon {
  exonIdx: number;
  chr: string;
  genomicStart: number;
  genomicEnd: number;
  rulerStart: number;
  rulerEnd: number;
  /** Runs in transcript order. */
  runs: readonly AlignedRun[];
}

/** The transcript's exons in transcript order, each with the runs that
 *  align it to the genome. Throws on {@link Exon.blocks} that are out of
 *  order, overlap, or reach outside their exon. */
export function mapExons(transcript: Transcript): MappedExon[] {
  return transcript.exons.map((exon, exonIdx) => ({
    exonIdx,
    chr: exon.chr,
    genomicStart: exon.genomicStart,
    genomicEnd: exon.genomicEnd,
    rulerStart: exon.cdsStart,
    rulerEnd: exon.cdsEnd,
    runs: codingRuns(exon, transcript.strand),
  }));
}

function codingRuns(exon: Exon, strand: '+' | '-'): AlignedRun[] {
  if (exon.blocks === undefined) {
    return [
      {
        rulerStart: exon.cdsStart,
        genomicStart: exon.genomicStart,
        length: exon.cdsEnd - exon.cdsStart + 1,
      },
    ];
  }
  const where = `exon ${exon.number}`;
  if (exon.blocks.length === 0) {
    throw new Error(`${where}: blocks is empty; omit it for an exon without indels`);
  }
  const runs: AlignedRun[] = [];
  for (const block of exon.blocks) {
    const { cdsStart, genomicStart, length } = block;
    if (!Number.isInteger(length) || length < 1) {
      throw new Error(`${where}: block at c.${cdsStart} has length ${length}`);
    }
    if (cdsStart < exon.cdsStart || cdsStart + length - 1 > exon.cdsEnd) {
      throw new Error(
        `${where}: block c.${cdsStart}+${length} lies outside c.${exon.cdsStart}-${exon.cdsEnd}`,
      );
    }
    if (genomicStart < exon.genomicStart || genomicStart + length - 1 > exon.genomicEnd) {
      throw new Error(
        `${where}: block at genomic ${genomicStart}+${length} lies outside ` +
          `${exon.genomicStart}-${exon.genomicEnd}`,
      );
    }
    const prev = runs[runs.length - 1];
    if (prev) {
      const afterInCds = cdsStart > prev.rulerStart + prev.length - 1;
      const afterOnGenome =
        strand === '+'
          ? genomicStart > prev.genomicStart + prev.length - 1
          : genomicStart + length - 1 < prev.genomicStart;
      if (!afterInCds || !afterOnGenome) {
        throw new Error(
          `${where}: block at c.${cdsStart} overlaps or precedes the block before it ` +
            `(blocks are listed in transcript order)`,
        );
      }
    }
    runs.push({ rulerStart: cdsStart, genomicStart, length });
  }
  return runs;
}

/** Genomic position of ruler position `r` in `run`, or `null` when the run
 *  does not hold `r`. */
export function runRulerToGenomic(run: AlignedRun, r: number, strand: '+' | '-'): number | null {
  const k = r - run.rulerStart;
  if (k < 0 || k >= run.length) return null;
  return strand === '+' ? run.genomicStart + k : run.genomicStart + run.length - 1 - k;
}

/** Ruler position of genomic position `g` in `run`, or `null` when the run
 *  does not hold `g`. */
export function runGenomicToRuler(run: AlignedRun, g: number, strand: '+' | '-'): number | null {
  const k = g - run.genomicStart;
  if (k < 0 || k >= run.length) return null;
  return strand === '+' ? run.rulerStart + k : run.rulerStart + run.length - 1 - k;
}

export function createCoordinateMapper(transcript: Transcript): CoordinateMapper {
  const exons = transcript.exons;
  const strand = transcript.strand;
  const cdsLength = transcript.cdsLength;
  const mapped = mapExons(transcript);

  function findExonByCds(cPos: number): { exonIdx: number } | null {
    for (let i = 0; i < exons.length; i++) {
      const e = exons[i]!;
      if (cPos >= e.cdsStart && cPos <= e.cdsEnd) return { exonIdx: i };
    }
    return null;
  }

  function findExonByGenomic(chr: string, pos: number): { exonIdx: number } | null {
    for (let i = 0; i < exons.length; i++) {
      const e = exons[i]!;
      if (e.chr === chr && pos >= e.genomicStart && pos <= e.genomicEnd) {
        return { exonIdx: i };
      }
    }
    return null;
  }

  function genomicToCds(chr: string, pos: number): CdsPosition | null {
    for (const m of mapped) {
      if (m.chr !== chr || pos < m.genomicStart || pos > m.genomicEnd) continue;
      for (const run of m.runs) {
        const r = runGenomicToRuler(run, pos, strand);
        if (r !== null) return { cPos: r, offset: 0 };
      }
      return null;
    }
    // Intronic: locate the bracketing exon pair (transcript order).
    for (let i = 0; i < mapped.length - 1; i++) {
      const a = mapped[i]!;
      const b = mapped[i + 1]!;
      if (a.chr !== chr || b.chr !== chr) continue;

      // `a` is the upstream exon in transcript order; `b` is downstream.
      // Compute intron genomic bounds and per-side distances.
      let inIntron = false;
      let distFromUpstream = 0;
      let distToDownstream = 0;
      if (strand === '+') {
        if (pos > a.genomicEnd && pos < b.genomicStart) {
          inIntron = true;
          distFromUpstream = pos - a.genomicEnd;
          distToDownstream = b.genomicStart - pos;
        }
      } else {
        if (pos > b.genomicEnd && pos < a.genomicStart) {
          inIntron = true;
          distFromUpstream = a.genomicStart - pos;
          distToDownstream = pos - b.genomicEnd;
        }
      }
      if (!inIntron) continue;

      if (distFromUpstream <= distToDownstream) {
        return { cPos: a.rulerEnd, offset: distFromUpstream };
      }
      return { cPos: b.rulerStart, offset: -distToDownstream };
    }
    return null;
  }

  function cdsToGenomic(cPos: number, offset: number): GenomicPosition | null {
    if (offset === 0) {
      for (const m of mapped) {
        if (cPos < m.rulerStart || cPos > m.rulerEnd) continue;
        for (const run of m.runs) {
          const g = runRulerToGenomic(run, cPos, strand);
          if (g !== null) return { chr: m.chr, pos: g };
        }
        return null;
      }
      return null;
    }
    // Intronic anchor: find the exon whose edge matches (cPos, sign(offset)).
    // Positive offset -> anchored on upstream exon's 3' end.
    // Negative offset -> anchored on downstream exon's 5' end.
    for (let i = 0; i < mapped.length; i++) {
      const m = mapped[i]!;
      if (offset > 0 && m.rulerEnd === cPos && i < mapped.length - 1) {
        const pos = strand === '+' ? m.genomicEnd + offset : m.genomicStart - offset;
        return { chr: m.chr, pos };
      }
      if (offset < 0 && m.rulerStart === cPos && i > 0) {
        const dist = -offset;
        const pos = strand === '+' ? m.genomicStart - dist : m.genomicEnd + dist;
        return { chr: m.chr, pos };
      }
    }
    return null;
  }

  function cdsToProtein(cPos: number): number | null {
    if (cPos < 1 || cPos > cdsLength) return null;
    return Math.ceil(cPos / 3);
  }

  function proteinToCds(aa: number): number {
    return (aa - 1) * 3 + 1;
  }

  function resolveCds(pos: Position): CdsPosition | null {
    switch (pos.kind) {
      case 'cds':
        return { cPos: pos.cPos, offset: pos.offset };
      case 'protein':
        // Codon-centre bp. Aa N's canonical CDS position is the middle bp
        // of its codon — bp 3N-1 — so {kind:'protein', aa:N} co-locates
        // with the aa-track letter glyph (which renders at the codon's
        // centre in CDS modes) and with a scale tick at that same bp.
        // {@link proteinToCds} remains available as the codon's *first*
        // bp (3N-2) for range bracket math, where you want the lo-bound
        // to cover the whole codon.
        return { cPos: (pos.aa - 1) * 3 + 2, offset: 0 };
      case 'genomic':
        return genomicToCds(pos.chr, pos.pos);
    }
  }

  return {
    transcript,
    genomicToCds,
    cdsToGenomic,
    cdsToProtein,
    proteinToCds,
    findExonByCds,
    findExonByGenomic,
    resolveCds,
  };
}
