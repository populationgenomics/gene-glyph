import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@populationgenomics/gene-glyph/styles.css';
import './embed.css';
import { EmbedView } from './EmbedView.js';

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');

createRoot(container).render(
  <StrictMode>
    <EmbedView />
  </StrictMode>,
);
