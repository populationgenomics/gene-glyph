import type {
  CdsPosition,
  CoordinateMapper,
  Exon,
  GenomicPosition,
  Transcript,
} from './types.js';

export function createCoordinateMapper(transcript: Transcript): CoordinateMapper {
  const exons = transcript.exons;
  const strand = transcript.strand;
  const cdsLength = transcript.cdsLength;

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

  function exonicGenomicToCPos(exon: Exon, pos: number): number {
    return strand === '+'
      ? exon.cdsStart + (pos - exon.genomicStart)
      : exon.cdsStart + (exon.genomicEnd - pos);
  }

  function exonicCdsToGenomic(exon: Exon, cPos: number): number {
    return strand === '+'
      ? exon.genomicStart + (cPos - exon.cdsStart)
      : exon.genomicEnd - (cPos - exon.cdsStart);
  }

  function genomicToCds(chr: string, pos: number): CdsPosition | null {
    const exonHit = findExonByGenomic(chr, pos);
    if (exonHit) {
      const exon = exons[exonHit.exonIdx]!;
      return { cPos: exonicGenomicToCPos(exon, pos), offset: 0 };
    }
    // Intronic: locate the bracketing exon pair (transcript order).
    for (let i = 0; i < exons.length - 1; i++) {
      const a = exons[i]!;
      const b = exons[i + 1]!;
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
        return { cPos: a.cdsEnd, offset: distFromUpstream };
      }
      return { cPos: b.cdsStart, offset: -distToDownstream };
    }
    return null;
  }

  function cdsToGenomic(cPos: number, offset: number): GenomicPosition | null {
    if (offset === 0) {
      const exonHit = findExonByCds(cPos);
      if (!exonHit) return null;
      const exon = exons[exonHit.exonIdx]!;
      return { chr: exon.chr, pos: exonicCdsToGenomic(exon, cPos) };
    }
    // Intronic anchor: find the exon whose edge matches (cPos, sign(offset)).
    // Positive offset -> anchored on upstream exon's cdsEnd.
    // Negative offset -> anchored on downstream exon's cdsStart.
    for (let i = 0; i < exons.length; i++) {
      const exon = exons[i]!;
      if (offset > 0 && exon.cdsEnd === cPos && i < exons.length - 1) {
        const pos = strand === '+' ? exon.genomicEnd + offset : exon.genomicStart - offset;
        return { chr: exon.chr, pos };
      }
      if (offset < 0 && exon.cdsStart === cPos && i > 0) {
        const dist = -offset;
        const pos = strand === '+' ? exon.genomicStart - dist : exon.genomicEnd + dist;
        return { chr: exon.chr, pos };
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

  return {
    transcript,
    genomicToCds,
    cdsToGenomic,
    cdsToProtein,
    proteinToCds,
    findExonByCds,
    findExonByGenomic,
  };
}
