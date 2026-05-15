import '@populationgenomics/gene-glyph/styles.css';
import { InterProDemoScenario } from './scenarios/interpro-demo.js';
import { PaperReportScenario } from './scenarios/paper-report.js';
import { PfamDemoScenario } from './scenarios/pfam-demo.js';
import { SlotSystemScenario } from './scenarios/slot-system.js';

export function App() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 1080, margin: '0 auto' }}>
      <h1>gene-glyph playground</h1>
      <p>Slice 8 — imperative ref API + fitTo / zoomBy / getViewportInfo.</p>
      <SlotSystemScenario />
      <PaperReportScenario />
      <PfamDemoScenario />
      <InterProDemoScenario />
    </main>
  );
}
