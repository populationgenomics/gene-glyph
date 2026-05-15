import { GeneGlyph } from '@populationgenomics/gene-glyph';
import '@populationgenomics/gene-glyph/styles.css';

export function App() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <h1>gene-glyph playground</h1>
      <p>Slice 1 — repo bootstrap. Scenarios land in later slices.</p>
      <GeneGlyph />
    </main>
  );
}
