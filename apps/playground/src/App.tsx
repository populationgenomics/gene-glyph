import { useState } from 'react';
import '@populationgenomics/gene-glyph/styles.css';
import { AsyncDataSourceScenario } from './scenarios/async-data-source.js';
import { InteractionDemoScenario } from './scenarios/interaction-demo.js';
import { InterProDemoScenario } from './scenarios/interpro-demo.js';
import { PaperReportScenario } from './scenarios/paper-report.js';
import { PfamDemoScenario } from './scenarios/pfam-demo.js';
import { SlotSystemScenario } from './scenarios/slot-system.js';
import { TooltipDemoScenario } from './scenarios/tooltip-demo.js';

export function App() {
  const [reduceMotion, setReduceMotion] = useState(false);
  return (
    <main
      style={{ fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 1080, margin: '0 auto' }}
      data-vv-reduce-motion={reduceMotion ? '' : undefined}
    >
      <h1>gene-glyph playground</h1>
      <p>Slice 9 — pan, zoom, and keyboard interactions.</p>
      <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: '0.85rem' }}>
        <input
          type="checkbox"
          data-testid="reduce-motion-toggle"
          checked={reduceMotion}
          onChange={(e) => setReduceMotion(e.target.checked)}
        />
        Simulate prefers-reduced-motion
      </label>
      <InteractionDemoScenario />
      <SlotSystemScenario />
      <TooltipDemoScenario />
      <AsyncDataSourceScenario />
      <PaperReportScenario />
      <PfamDemoScenario />
      <InterProDemoScenario />
    </main>
  );
}
