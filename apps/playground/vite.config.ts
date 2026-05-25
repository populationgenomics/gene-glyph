import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base` controls the public URL prefix Vite stamps into asset URLs.
// Local dev (`npm run dev`) wants `/`; GitHub Pages serves the playground
// at `https://populationgenomics.github.io/gene-glyph/`, so the Pages
// workflow exports `PLAYGROUND_BASE=/gene-glyph/` before `npm run build`.
const base = process.env.PLAYGROUND_BASE ?? '/';

// Multi-page build: `index.html` is the scenario gallery; `embed.html`
// is a chrome-less single-figure view that takes an Ensembl transcript
// ID via the `?transcript=ENST…` query string. Both ship in the same
// Pages deploy.
export default defineConfig({
  plugins: [react()],
  base,
  server: {
    port: 5174,
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        embed: resolve(__dirname, 'embed.html'),
      },
    },
  },
});
