import '@populationgenomics/gene-glyph/styles.css';
import { PaperReportScenario } from './scenarios/paper-report.js';

export function App() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 1080, margin: '0 auto' }}>
      <h1>gene-glyph playground</h1>
      <p>Slice 3 — exon track + first real render.</p>
      <PaperReportScenario />
    </main>
  );
}
