import { useState } from 'react';
import {
  GeneGlyph,
  exonTrack,
  segmentBandTrack,
  variantTrack,
} from '@populationgenomics/gene-glyph';
import type { Transcript, ViewMode, ViewerVariant } from '@populationgenomics/gene-glyph';
import { TP53_TRANSCRIPT } from '../fixtures/tp53.js';

/**
 * Transcript map — TP53 with its UTRs: exon 1 lies wholly in the 5' UTR,
 * exon 2 starts with 100 bp of it, and exon 11 ends with 1.2 kb of 3' UTR.
 * Variants sit in the UTRs, in introns next to splice sites, in the CDS,
 * and off the transcript; bands cover the UTR-only exon and a stretch of
 * intron. Coordinates are GRCh38 chr17 (minus strand), rounded like the
 * rest of the TP53 fixture.
 */
const TRANSCRIPT: Transcript = {
  ...TP53_TRANSCRIPT,
  exons: TP53_TRANSCRIPT.exons.map((e, i, all) =>
    i === 0 ? { ...e, utr5Bp: 100 } : i === all.length - 1 ? { ...e, utr3Bp: 1200 } : e,
  ),
  utr5Exons: [{ number: 1, chr: 'chr17', genomicStart: 7687377, genomicEnd: 7687490 }],
};

function genomic(
  id: string,
  pos: number,
  category: ViewerVariant['category'],
  chr = 'chr17',
): ViewerVariant {
  return { id, label: id, coord: { kind: 'genomic', chr, pos }, category };
}

const CASE_VARIANTS: ViewerVariant[] = [
  genomic('c.-164G>A', 7687440, 'utr'),
  genomic('c.441+5G>A', 7674176, 'splice'),
  genomic('c.163-2A>G', 7674461, 'splice'),
  genomic('c.*50T>C', 7668371, 'utr'),
  genomic('chr17:g.7700000A>G', 7700000, 'other'),
];

const LITERATURE_VARIANTS: ViewerVariant[] = [
  {
    id: 'c.524G>A',
    label: 'c.524G>A',
    coord: { kind: 'cds', cPos: 524, offset: 0 },
    category: 'missense',
  },
  genomic('chr1:g.1000A>G', 1000, 'other', 'chr1'),
];

const REGIONS = [
  {
    id: 'del-ex1',
    chr: 'chr17',
    start: 7687400,
    end: 7687450,
    category: 'deleted' as const,
    label: 'Exon 1 deletion',
  },
  {
    id: 'dup-int3',
    chr: 'chr17',
    start: 7675000,
    end: 7675100,
    category: 'duplicated' as const,
    label: 'Intron 3 duplication',
  },
];

export function TranscriptMapDemoScenario() {
  const [mode, setMode] = useState<ViewMode>('transcript');
  const [clicked, setClicked] = useState<string | null>(null);
  return (
    <section className="scenario" aria-labelledby="scenario-transcript-map">
      <h2 id="scenario-transcript-map">Transcript map — UTRs and introns</h2>
      <p className="scenario-blurb">
        UTR variants draw in the UTR caps, exon 1 (wholly 5' UTR) included; intronic variants draw
        on the nearer exon edge with a marker pointing into the intron. Only features off the
        transcript are listed as unplaced, under the name of their track. Only the literature
        variants are clickable.
      </p>
      <label style={{ fontSize: '0.85rem', color: '#475569' }}>
        Mode{' '}
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as ViewMode)}
          data-testid="transcript-map-mode"
          style={{ font: 'inherit', padding: '2px 6px' }}
        >
          <option value="transcript">Transcript</option>
          <option value="genome">Genome</option>
          <option value="protein">Protein</option>
        </select>
      </label>
      <GeneGlyph
        transcript={TRANSCRIPT}
        mode={mode}
        interactionMode="embed"
        onFeatureClick={(featureId) => setClicked(featureId)}
        isFeatureClickable={(_featureId, trackId) => trackId === 'literature'}
        tracks={[
          exonTrack({}),
          variantTrack({ id: 'case', label: 'This case', source: CASE_VARIANTS }),
          variantTrack({ id: 'literature', label: 'Literature', source: LITERATURE_VARIANTS }),
          segmentBandTrack({
            id: 'regions',
            label: 'Regions',
            source: REGIONS,
            coordSystem: 'genomic',
            palette: { deleted: '#7c3aed', duplicated: '#0891b2' },
            heightPx: 12,
            gapAbove: 4,
          }),
        ]}
      />
      <p data-testid="transcript-map-clicked">Clicked: {clicked ?? 'nothing'}</p>
    </section>
  );
}
