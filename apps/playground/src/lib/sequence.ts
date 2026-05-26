const ENSEMBL_REST = 'https://rest.ensembl.org';

interface EnsemblSequenceResponse {
  id: string;
  seq: string;
}

/** Fetch the CDS nucleotide sequence (5' → 3') for a transcript via
 *  Ensembl REST. The aa track derives the protein readout from this
 *  same sequence via the standard codon table — no separate protein
 *  fetch is required. Returns `null` on any failure so the figure
 *  still renders without the sequence tracks. */
export async function fetchCdsSequence(
  transcriptId: string,
  signal: AbortSignal,
): Promise<string | null> {
  try {
    const url = `${ENSEMBL_REST}/sequence/id/${encodeURIComponent(transcriptId)}?type=cds`;
    const res = await fetch(url, {
      signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as EnsemblSequenceResponse;
    return json.seq ?? null;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    return null;
  }
}
