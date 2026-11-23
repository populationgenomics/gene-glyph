import type {
  CdsPosition,
  CollapsedRegion,
  CoordinateMapper,
  AlignedRun,
  Exon,
  GenomicPosition,
  MappedExon,
  Position,
  Transcript,
  UtrExon,
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

/** Every exon of the transcript in transcript order — exons wholly in the
 *  5' UTR, the coding exons, exons wholly in the 3' UTR — each with the
 *  runs that align it to the genome. The first coding exon's 5' UTR part
 *  and the last one's 3' UTR part are runs of those exons. Throws on
 *  {@link Exon.blocks} that are out of order, overlap, or reach outside
 *  their exon, and on UTR-only exons that are out of transcript order or
 *  on another chromosome. */
export function mapExons(transcript: Transcript): MappedExon[] {
  const strand = transcript.strand;
  const coding = mapCodingParts(transcript);
  const lastIdx = coding.length - 1;
  if (lastIdx < 0) return coding;
  const utr5 = transcript.exons[0]!.utr5Bp ?? 0;
  if (utr5 > 0) {
    const m = coding[0]!;
    coding[0] = extendWith(m, {
      cdsStart: m.cdsStart - utr5,
      genomicStart: strand === '+' ? m.genomicStart - utr5 : m.genomicEnd + 1,
      length: utr5,
    });
  }
  const utr3 = transcript.exons[lastIdx]!.utr3Bp ?? 0;
  if (utr3 > 0) {
    const m = coding[lastIdx]!;
    coding[lastIdx] = extendWith(m, {
      cdsStart: m.cdsEnd + 1,
      genomicStart: strand === '+' ? m.genomicEnd + 1 : m.genomicStart - utr3,
      length: utr3,
    });
  }
  const first = coding[0]!;
  const last = coding[lastIdx]!;

  const before: MappedExon[] = [];
  let cursor = first.cdsStart;
  for (const e of [...(transcript.utr5Exons ?? [])].reverse()) {
    const m = utrOnly(e, 'utr5', first.exonIdx, cursor - utrLength(e));
    before.unshift(m);
    cursor = m.cdsStart;
  }
  const after: MappedExon[] = [];
  cursor = last.cdsEnd + 1;
  for (const e of transcript.utr3Exons ?? []) {
    const m = utrOnly(e, 'utr3', last.exonIdx, cursor);
    after.push(m);
    cursor = m.cdsEnd + 1;
  }

  const all = [...before, ...coding, ...after];
  for (let i = 1; i < all.length; i++) {
    const a = all[i - 1]!;
    const b = all[i]!;
    if (a.kind === 'coding' && b.kind === 'coding') continue;
    const utr = a.kind === 'coding' ? b : a;
    if (a.chr !== b.chr) {
      throw new Error(`UTR exon ${utr.number} is on ${utr.chr}, its neighbour on another chr`);
    }
    const inOrder = strand === '+' ? a.genomicEnd < b.genomicStart : b.genomicEnd < a.genomicStart;
    if (!inOrder) {
      throw new Error(
        `UTR exon ${utr.number} overlaps or is out of transcript order with exon ` +
          `${a === utr ? b.number : a.number}`,
      );
    }
  }
  return all;
}

/** The coding exons alone, each described by its coding part only. */
function mapCodingParts(transcript: Transcript): MappedExon[] {
  return transcript.exons.map((exon, exonIdx) => ({
    kind: 'coding',
    number: exon.number,
    exonIdx,
    chr: exon.chr,
    genomicStart: exon.genomicStart,
    genomicEnd: exon.genomicEnd,
    cdsStart: exon.cdsStart,
    cdsEnd: exon.cdsEnd,
    runs: codingRuns(exon, transcript.strand),
  }));
}

function utrLength(e: UtrExon): number {
  const length = e.genomicEnd - e.genomicStart + 1;
  if (!Number.isInteger(length) || length < 1) {
    throw new Error(`UTR exon ${e.number} spans ${e.genomicStart}-${e.genomicEnd}`);
  }
  return length;
}

function utrOnly(e: UtrExon, kind: 'utr5' | 'utr3', exonIdx: number, cdsStart: number): MappedExon {
  const length = utrLength(e);
  return {
    kind,
    number: e.number,
    exonIdx,
    chr: e.chr,
    genomicStart: e.genomicStart,
    genomicEnd: e.genomicEnd,
    cdsStart,
    cdsEnd: cdsStart + length - 1,
    runs: [{ cdsStart, genomicStart: e.genomicStart, length }],
  };
}

/** `m` with `run` added at its transcript-order start or end, whichever
 *  the run's c. position puts it at. */
function extendWith(m: MappedExon, run: AlignedRun): MappedExon {
  const before = run.cdsStart < m.cdsStart;
  return {
    ...m,
    genomicStart: Math.min(m.genomicStart, run.genomicStart),
    genomicEnd: Math.max(m.genomicEnd, run.genomicStart + run.length - 1),
    cdsStart: Math.min(m.cdsStart, run.cdsStart),
    cdsEnd: Math.max(m.cdsEnd, run.cdsStart + run.length - 1),
    runs: before ? [run, ...m.runs] : [...m.runs, run],
  };
}

function codingRuns(exon: Exon, strand: '+' | '-'): AlignedRun[] {
  if (exon.blocks === undefined) {
    return [
      {
        cdsStart: exon.cdsStart,
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
      const afterInCds = cdsStart > prev.cdsStart + prev.length - 1;
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
    runs.push({ cdsStart: cdsStart, genomicStart, length });
  }
  return runs;
}

/** Genomic position of c. position `r` in `run`, or `null` when the run
 *  does not hold `r`. */
export function runCdsToGenomic(run: AlignedRun, r: number, strand: '+' | '-'): number | null {
  const k = r - run.cdsStart;
  if (k < 0 || k >= run.length) return null;
  return strand === '+' ? run.genomicStart + k : run.genomicStart + run.length - 1 - k;
}

/** C. position of genomic position `g` in `run`, or `null` when the run
 *  does not hold `g`. */
export function runGenomicToCds(run: AlignedRun, g: number, strand: '+' | '-'): number | null {
  const k = g - run.genomicStart;
  if (k < 0 || k >= run.length) return null;
  return strand === '+' ? run.cdsStart + k : run.cdsStart + run.length - 1 - k;
}

/** HGVS text of a c. position on a transcript with CDS length
 *  `cdsLength`: `c.76`, `c.-20` (cPos -19), `c.*30` (cPos cdsLength + 30),
 *  `c.673+1`, `c.-15-2`. */
export function formatCdsPosition(pos: CdsPosition, cdsLength: number): string {
  const { cPos, offset } = pos;
  const base = cPos < 1 ? `-${1 - cPos}` : cPos > cdsLength ? `*${cPos - cdsLength}` : `${cPos}`;
  const intronic = offset > 0 ? `+${offset}` : offset < 0 ? `${offset}` : '';
  return `c.${base}${intronic}`;
}

export function createCoordinateMapper(transcript: Transcript): CoordinateMapper {
  const exons = transcript.exons;
  const strand = transcript.strand;
  const cdsLength = transcript.cdsLength;
  const mapped = mapExons(transcript);
  // genomicToCds / cdsToGenomic keep their coding-part-only contract; the
  // transcript-wide pair maps UTRs too.
  const codingParts = mapCodingParts(transcript);

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

  function genomicToCdsIn(
    mapped: readonly MappedExon[],
    chr: string,
    pos: number,
  ): CdsPosition | null {
    for (const m of mapped) {
      if (m.chr !== chr || pos < m.genomicStart || pos > m.genomicEnd) continue;
      for (const run of m.runs) {
        const r = runGenomicToCds(run, pos, strand);
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
        return { cPos: a.cdsEnd, offset: distFromUpstream };
      }
      return { cPos: b.cdsStart, offset: -distToDownstream };
    }
    return null;
  }

  function cdsToGenomicIn(
    mapped: readonly MappedExon[],
    cPos: number,
    offset: number,
  ): GenomicPosition | null {
    if (offset === 0) {
      for (const m of mapped) {
        if (cPos < m.cdsStart || cPos > m.cdsEnd) continue;
        for (const run of m.runs) {
          const g = runCdsToGenomic(run, cPos, strand);
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
      if (offset > 0 && m.cdsEnd === cPos && i < mapped.length - 1) {
        const pos = strand === '+' ? m.genomicEnd + offset : m.genomicStart - offset;
        return { chr: m.chr, pos };
      }
      if (offset < 0 && m.cdsStart === cPos && i > 0) {
        const dist = -offset;
        const pos = strand === '+' ? m.genomicStart - dist : m.genomicEnd + dist;
        return { chr: m.chr, pos };
      }
    }
    return null;
  }

  const genomicToCds = (chr: string, pos: number) => genomicToCdsIn(codingParts, chr, pos);
  const cdsToGenomic = (cPos: number, offset: number) => cdsToGenomicIn(codingParts, cPos, offset);
  const genomicToTranscript = (chr: string, pos: number) => genomicToCdsIn(mapped, chr, pos);
  const transcriptToGenomic = (cPos: number, offset: number) =>
    cdsToGenomicIn(mapped, cPos, offset);

  function cdsToProtein(cPos: number): number | null {
    if (cPos < 1 || cPos > cdsLength) return null;
    return Math.ceil(cPos / 3);
  }

  function proteinToCds(aa: number): number {
    return (aa - 1) * 3 + 1;
  }

  function resolveCds(pos: Position): CdsPosition | null {
    return pos.kind === 'genomic' ? genomicToCds(pos.chr, pos.pos) : resolveCoding(pos);
  }

  function resolveTranscript(pos: Position): CdsPosition | null {
    return pos.kind === 'genomic' ? genomicToTranscript(pos.chr, pos.pos) : resolveCoding(pos);
  }

  function resolveCoding(pos: Exclude<Position, { kind: 'genomic' }>): CdsPosition {
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
    }
  }

  return {
    transcript,
    mappedExons: mapped,
    genomicToCds,
    cdsToGenomic,
    genomicToTranscript,
    transcriptToGenomic,
    resolveTranscript,
    cdsToProtein,
    proteinToCds,
    findExonByCds,
    findExonByGenomic,
    resolveCds,
  };
}
