import '@populationgenomics/gene-glyph/styles.css';
import { InterProDemoScenario } from './scenarios/interpro-demo.js';
import { PaperReportScenario } from './scenarios/paper-report.js';
import { PfamDemoScenario } from './scenarios/pfam-demo.js';

export function App() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 1080, margin: '0 auto' }}>
      <h1>gene-glyph playground</h1>
      <p>Slice 6 — InterPro track + groups + LeftGutter slot.</p>
      <PaperReportScenario />
      <PfamDemoScenario />
      <InterProDemoScenario />
    </main>
  );
}
