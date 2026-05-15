import type {
  AnchorTarget,
  CdsPosition,
  CoordinateMapper,
  DroppedRange,
  GenomicPosition,
  RangeProjection,
  RangeSegment,
  ScreenPoint,
  ViewMode,
  Viewport,
} from './types.js';

export interface ViewportControllerInit {
  mapper: CoordinateMapper;
  width: number;
  mode?: ViewMode;
  range?: readonly [number, number];
  intronScale?: number;
}

interface CssTarget {
  style: CSSStyleDeclaration;
}

function defaultRangeFor(mode: ViewMode, mapper: CoordinateMapper): [number, number] {
  if (mode === 'protein') {
    const aaLength = Math.floor(mapper.transcript.cdsLength / 3);
    return [1, Math.max(1, aaLength)];
  }
  return [1, Math.max(1, mapper.transcript.cdsLength)];
}

function defaultIntronScale(mode: ViewMode): number {
  return mode === 'cds-with-introns' ? 1 : 0;
}

export class ViewportController implements Viewport {
  private _mode: ViewMode;
  private _range: [number, number];
  private _width: number;
  private _intronScale: number;
  private _attached: CssTarget | null = null;
  readonly mapper: CoordinateMapper;

  constructor(init: ViewportControllerInit) {
    this.mapper = init.mapper;
    this._mode = init.mode ?? 'cds-with-introns';
    this._range = [...(init.range ?? defaultRangeFor(this._mode, this.mapper))] as [number, number];
    this._width = init.width;
    this._intronScale = init.intronScale ?? defaultIntronScale(this._mode);
  }

  // ---- Read-only state ---------------------------------------------------

  get mode(): ViewMode {
    return this._mode;
  }

  get intronScale(): number {
    return this._intronScale;
  }

  get range(): readonly [number, number] {
    return this._range;
  }

  get width(): number {
    return this._width;
  }

  // ---- Mutators ----------------------------------------------------------

  setMode(mode: ViewMode): void {
    this._mode = mode;
    this._intronScale = defaultIntronScale(mode);
    // Reproject the range onto the new mode's natural ruler.
    this._range = defaultRangeFor(mode, this.mapper);
    this.publish();
  }

  setRange(range: readonly [number, number]): void {
    this._range = [range[0], range[1]];
    this.publish();
  }

  setWidth(width: number): void {
    this._width = width;
    this.publish();
  }

  setIntronScale(scale: number): void {
    this._intronScale = scale;
    this.publish();
  }

  // ---- CSS variable publication -----------------------------------------

  attach(el: CssTarget): void {
    this._attached = el;
    this.publish();
  }

  detach(): void {
    this._attached = null;
  }

  publish(): void {
    if (!this._attached) return;
    const s = this._attached.style;
    s.setProperty('--vv-zoom', this.zoom().toString());
    s.setProperty('--vv-pan-x', '0px');
    s.setProperty('--vv-intron-scale', this._intronScale.toString());
    const exons = this.mapper.transcript.exons;
    for (let i = 0; i < exons.length; i++) {
      const e = exons[i]!;
      const xStart = this.cdsToScreen(e.cdsStart, 0);
      const xEnd = this.cdsToScreen(e.cdsEnd, 0);
      const placedStart = xStart ?? 0;
      const placedEnd = xEnd ?? placedStart;
      s.setProperty(`--vv-exon-x-${i}`, `${placedStart}px`);
      s.setProperty(`--vv-exon-w-${i}`, `${Math.max(0, placedEnd - placedStart)}px`);
    }
  }

  /** Zoom scalar relative to fit-gene. >1 = zoomed in. */
  zoom(): number {
    const naturalSpan = defaultRangeFor(this._mode, this.mapper);
    const naturalLen = naturalSpan[1] - naturalSpan[0];
    const currentLen = this._range[1] - this._range[0];
    return currentLen > 0 ? naturalLen / currentLen : 1;
  }

  // ---- Point projection --------------------------------------------------

  private rulerOf(cPos: number): number | null {
    // Convert a CDS position to the active ruler coordinate.
    if (this._mode === 'protein') {
      const aa = this.mapper.cdsToProtein(cPos);
      return aa;
    }
    return cPos;
  }

  private mapToScreen(rulerPos: number): number | null {
    const [lo, hi] = this._range;
    if (rulerPos < lo || rulerPos > hi) return null;
    if (hi === lo) return 0;
    return ((rulerPos - lo) / (hi - lo)) * this._width;
  }

  cdsToScreen(cPos: number, offset: number): number | null {
    if (this._mode === 'cds-spliced' && offset !== 0) return null;
    if (this._mode === 'protein' && offset !== 0) return null;
    // cds-with-introns: intronic offsets are rendered relative to the flanking
    // exon edge. Slice 2 returns null for offset != 0 to keep the contract
    // honest until intron geometry is wired up in Slice 3.
    if (offset !== 0) return null;
    const ruler = this.rulerOf(cPos);
    if (ruler === null) return null;
    return this.mapToScreen(ruler);
  }

  proteinToScreen(aa: number): number | null {
    if (this._mode === 'protein') {
      return this.mapToScreen(aa);
    }
    const cPos = this.mapper.proteinToCds(aa);
    return this.mapToScreen(cPos);
  }

  genomicToScreen(chr: string, pos: number): number | null {
    const cds = this.mapper.genomicToCds(chr, pos);
    if (!cds) return null;
    return this.cdsToScreen(cds.cPos, cds.offset);
  }

  screenToCds(x: number): CdsPosition | null {
    const ruler = this.screenToRuler(x);
    if (ruler === null) return null;
    if (this._mode === 'protein') {
      // Snap to the start of the codon containing this aa.
      const aa = Math.round(ruler);
      return { cPos: this.mapper.proteinToCds(aa), offset: 0 };
    }
    return { cPos: Math.round(ruler), offset: 0 };
  }

  screenToProtein(x: number): number | null {
    const cds = this.screenToCds(x);
    if (!cds) return null;
    return this.mapper.cdsToProtein(cds.cPos);
  }

  screenToGenomic(x: number): GenomicPosition | null {
    const cds = this.screenToCds(x);
    if (!cds) return null;
    return this.mapper.cdsToGenomic(cds.cPos, cds.offset);
  }

  private screenToRuler(x: number): number | null {
    if (x < 0 || x > this._width) return null;
    const [lo, hi] = this._range;
    if (this._width === 0) return lo;
    return lo + (x / this._width) * (hi - lo);
  }

  // ---- Range projection --------------------------------------------------

  projectCdsRange(start: number, end: number): RangeProjection {
    const [lo, hi] = clampOrdered(start, end);
    return this.projectExonic(lo, hi);
  }

  projectProteinRange(aaStart: number, aaEnd: number): RangeProjection {
    const [lo, hi] = clampOrdered(aaStart, aaEnd);
    // First and last base of the residue range in CDS coords.
    const cdsLo = this.mapper.proteinToCds(lo);
    const cdsHi = this.mapper.proteinToCds(hi) + 2;
    return this.projectExonic(cdsLo, cdsHi);
  }

  projectGenomicRange(chr: string, start: number, end: number): RangeProjection {
    const [gLo, gHi] = clampOrdered(start, end);
    const exons = this.mapper.transcript.exons;
    const fragmenting = this._mode !== 'cds-with-introns';

    const segments: RangeSegment[] = [];
    const droppedRanges: DroppedRange[] = [];
    let droppedIntronicCount = 0;
    let droppedExonicCount = 0;

    // Walk exons in transcript order so segment ordering matches the figure.
    const exonHits: Array<{ idx: number; cdsLo: number; cdsHi: number }> = [];
    for (let i = 0; i < exons.length; i++) {
      const e = exons[i]!;
      if (e.chr !== chr) continue;
      const overlapLo = Math.max(gLo, e.genomicStart);
      const overlapHi = Math.min(gHi, e.genomicEnd);
      if (overlapLo > overlapHi) continue;
      const cdsA = exonicToCds(e, overlapLo, this.mapper.transcript.strand);
      const cdsB = exonicToCds(e, overlapHi, this.mapper.transcript.strand);
      const cdsLo = Math.min(cdsA, cdsB);
      const cdsHi = Math.max(cdsA, cdsB);
      exonHits.push({ idx: i, cdsLo, cdsHi });
    }

    // In fragmenting modes, each exonic overlap becomes its own segment;
    // gaps between adjacent hits are intronic drops. In cds-with-introns,
    // we fold the whole genomic range into a single ruler-space segment.
    if (fragmenting) {
      for (let k = 0; k < exonHits.length; k++) {
        const hit = exonHits[k]!;
        const seg = this.cdsRangeToSegment(hit.cdsLo, hit.cdsHi, hit.idx);
        if (seg) segments.push(seg);
        if (k > 0) {
          droppedIntronicCount += 1;
          droppedRanges.push({ kind: 'intronic', near: { exonIdx: hit.idx } });
        }
      }
    } else if (exonHits.length > 0) {
      const first = exonHits[0]!;
      const last = exonHits[exonHits.length - 1]!;
      const seg = this.cdsRangeToSegment(first.cdsLo, last.cdsHi, first.idx);
      if (seg) segments.push(seg);
    }

    // Out-of-bounds: portions of the genomic range not covered by any exon
    // overlap before the first hit, after the last hit, or between hits
    // when not fragmenting. We treat fully-outside ranges as out-of-bounds.
    if (exonHits.length === 0) {
      droppedExonicCount += 1;
      droppedRanges.push({ kind: 'out-of-bounds' });
    }

    return { segments, droppedIntronicCount, droppedExonicCount, droppedRanges };
  }

  private projectExonic(cdsLo: number, cdsHi: number): RangeProjection {
    const exons = this.mapper.transcript.exons;
    const fragmenting = this._mode !== 'cds-with-introns';

    const segments: RangeSegment[] = [];
    const droppedRanges: DroppedRange[] = [];

    const hits: Array<{ idx: number; lo: number; hi: number }> = [];
    for (let i = 0; i < exons.length; i++) {
      const e = exons[i]!;
      const overlapLo = Math.max(cdsLo, e.cdsStart);
      const overlapHi = Math.min(cdsHi, e.cdsEnd);
      if (overlapLo > overlapHi) continue;
      hits.push({ idx: i, lo: overlapLo, hi: overlapHi });
    }

    if (hits.length === 0) {
      return {
        segments,
        droppedIntronicCount: 0,
        droppedExonicCount: 1,
        droppedRanges: [{ kind: 'out-of-bounds' }],
      };
    }

    if (fragmenting) {
      for (const h of hits) {
        const seg = this.cdsRangeToSegment(h.lo, h.hi, h.idx);
        if (seg) segments.push(seg);
      }
    } else {
      const first = hits[0]!;
      const last = hits[hits.length - 1]!;
      const seg = this.cdsRangeToSegment(first.lo, last.hi, first.idx);
      if (seg) segments.push(seg);
    }

    return {
      segments,
      droppedIntronicCount: 0,
      droppedExonicCount: 0,
      droppedRanges,
    };
  }

  private cdsRangeToSegment(cdsLo: number, cdsHi: number, exonIdx: number): RangeSegment | null {
    const xStart = this.cdsToScreen(cdsLo, 0);
    const xEnd = this.cdsToScreen(cdsHi, 0);
    if (xStart === null && xEnd === null) return null;
    if (xStart === null || xEnd === null) {
      // Partial visibility: clip to viewport bounds.
      const clampedStart = xStart ?? 0;
      const clampedEnd = xEnd ?? this._width;
      return { xStart: clampedStart, xEnd: clampedEnd, exonIdx };
    }
    return { xStart, xEnd, exonIdx };
  }

  // ---- Anchors -----------------------------------------------------------

  resolveAnchor(target: AnchorTarget): ScreenPoint | null {
    switch (target.kind) {
      case 'cds-pos': {
        const x = this.cdsToScreen(target.cPos, target.offset ?? 0);
        return x === null ? null : { x, y: 0 };
      }
      case 'protein-aa': {
        const x = this.proteinToScreen(target.aa);
        return x === null ? null : { x, y: 0 };
      }
      case 'genomic-pos': {
        const x = this.genomicToScreen(target.chr, target.pos);
        return x === null ? null : { x, y: 0 };
      }
      case 'intron-boundary': {
        const exon = this.mapper.transcript.exons[target.exonIdx];
        if (!exon) return null;
        const cPos = target.side === 'donor' ? exon.cdsEnd : exon.cdsStart;
        const x = this.cdsToScreen(cPos, 0);
        return x === null ? null : { x, y: 0 };
      }
      case 'feature':
        // Features are resolved by tracks via `Track.resolveAnchor`. The
        // viewport doesn't know the track-level data layout.
        return null;
    }
  }
}

function clampOrdered(a: number, b: number): [number, number] {
  return a <= b ? [a, b] : [b, a];
}

function exonicToCds(exon: { cdsStart: number; genomicStart: number; genomicEnd: number }, pos: number, strand: '+' | '-'): number {
  return strand === '+'
    ? exon.cdsStart + (pos - exon.genomicStart)
    : exon.cdsStart + (exon.genomicEnd - pos);
}
