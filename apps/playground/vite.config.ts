import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base` controls the public URL prefix Vite stamps into asset URLs.
// Local dev (`npm run dev`) wants `/`; GitHub Pages serves the playground
// at `https://populationgenomics.github.io/gene-glyph/`, so the Pages
// workflow exports `PLAYGROUND_BASE=/gene-glyph/` before `npm run build`.
const base = process.env.PLAYGROUND_BASE ?? '/';

export default defineConfig({
  plugins: [react()],
  base,
  server: {
    port: 5174,
  },
});
