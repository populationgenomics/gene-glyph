import { act, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GeneGlyph } from './viewer.js';
import { exonTrack } from './tracks/exon-track.js';
import { clinVarTrack } from './tracks/clinvar-track.js';
import { userVariantTrack } from './tracks/user-variant-track.js';
import type { Transcript } from './types.js';
import type { ClinVarRecord } from './tracks/clinvar-track.js';

const transcript: Transcript = {
  geneSymbol: 'TEST',
  transcriptId: 'NM_TEST.1',
  cdsLength: 300,
  strand: '+',
  exons: [
    { number: 1, cdsStart: 1, cdsEnd: 100, genomicStart: 1000, genomicEnd: 1099, chr: 'chr1' },
    { number: 2, cdsStart: 101, cdsEnd: 200, genomicStart: 2000, genomicEnd: 2099, chr: 'chr1' },
    { number: 3, cdsStart: 201, cdsEnd: 300, genomicStart: 3000, genomicEnd: 3099, chr: 'chr1' },
  ],
};

const clinvarRecords: ClinVarRecord[] = [
  { id: 'cv-snv', label: 'c.50G>A', chr: 'chr1', pos: 1049, significance: 'pathogenic' },
  { id: 'cv-del', label: 'c.50_53del', chr: 'chr1', pos: 1049, significance: 'pathogenic', refLen: 4 },
];

async function flushTrackLoads() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('Slice 35 — selection-range overlay', () => {
  it('renders nothing when no feature is selected', async () => {
    const { container } = render(
      <GeneGlyph
        transcript={transcript}
        tracks={[exonTrack({}), clinVarTrack({ id: 'cv', source: clinvarRecords })]}
      />,
    );
    await flushTrackLoads();
    expect(
      container.querySelector('[data-testid="gene-glyph-selection-range"]'),
    ).toBeNull();
  });

  it('emits a vertical drop-line for SNV selection (zero-width range)', async () => {
    const { container } = render(
      <GeneGlyph
        transcript={transcript}
        tracks={[exonTrack({}), clinVarTrack({ id: 'cv', source: clinvarRecords })]}
        selectedFeatureIds={new Set(['cv-snv'])}
      />,
    );
    await flushTrackLoads();
    const overlay = container.querySelector('[data-testid="gene-glyph-selection-range"]');
    expect(overlay).not.toBeNull();
    expect(overlay!.querySelector('.vv-selection-range-line')).not.toBeNull();
    expect(overlay!.querySelector('.vv-selection-range')).toBeNull();
  });

  it('emits a translucent rect for multi-bp selection', async () => {
    const { container } = render(
      <GeneGlyph
        transcript={transcript}
        tracks={[exonTrack({}), clinVarTrack({ id: 'cv', source: clinvarRecords })]}
        selectedFeatureIds={new Set(['cv-del'])}
      />,
    );
    await flushTrackLoads();
    const overlay = container.querySelector('[data-testid="gene-glyph-selection-range"]');
    expect(overlay).not.toBeNull();
    const rect = overlay!.querySelector('.vv-selection-range');
    expect(rect).not.toBeNull();
    // Multi-bp variants span >= 1 bp on the figure-x ruler.
    expect(Number(rect!.getAttribute('width'))).toBeGreaterThan(0);
  });

  it('lets user-variant selections share the same overlay surface', async () => {
    const { container } = render(
      <GeneGlyph
        transcript={transcript}
        tracks={[
          exonTrack({}),
          userVariantTrack({
            source: [{ id: '1-1049-G-A', chr: 'chr1', pos: 1049 }],
          }),
        ]}
        selectedFeatureIds={new Set(['1-1049-G-A'])}
      />,
    );
    await flushTrackLoads();
    const overlay = container.querySelector('[data-testid="gene-glyph-selection-range"]');
    expect(overlay).not.toBeNull();
    expect(overlay!.querySelector('[data-vv-feature-id="1-1049-G-A"]')).not.toBeNull();
  });

  it('drops selections that no track recognises', async () => {
    const { container } = render(
      <GeneGlyph
        transcript={transcript}
        tracks={[exonTrack({}), clinVarTrack({ id: 'cv', source: clinvarRecords })]}
        selectedFeatureIds={new Set(['unknown-id'])}
      />,
    );
    await flushTrackLoads();
    expect(
      container.querySelector('[data-testid="gene-glyph-selection-range"]'),
    ).toBeNull();
  });
});
