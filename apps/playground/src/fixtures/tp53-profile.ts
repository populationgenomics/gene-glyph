import type { ProfileDatum } from '@populationgenomics/gene-glyph';
import { TP53_PROTEIN } from './tp53.js';
import { TP53_DENSE_VARIANTS } from './tp53-dense.js';

/**
 * Synthetic per-aa PhyloP-style conservation scores for TP53. The
 * real PhyloP track is per-bp and noisy; this fixture is an aa-
 * smoothed proxy good enough to drive the profile-track demo:
 *
 *   - peak conservation across the DNA-binding domain (aa 100–300),
 *     with three super-conserved patches around R175 / R248 / R273
 *   - moderate conservation in the TAD (aa 1–60) and the
 *     tetramerisation domain (aa 320–360)
 *   - lower conservation in the linker + C-terminal regulatory tail
 *
 * Numbers are deterministic — seeded PRNG — so visual snapshots
 * don't drift between test runs.
 */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildConservation(): ProfileDatum[] {
  const rand = mulberry32(31);
  const out: ProfileDatum[] = [];
  for (let aa = 1; aa <= TP53_PROTEIN.length; aa++) {
    let base = 0.2;
    if (aa >= 100 && aa <= 300) base = 0.7;
    if (aa >= 1 && aa <= 60) base = 0.45;
    if (aa >= 320 && aa <= 360) base = 0.55;
    // Hotspot residues — push to near-maximum.
    if (Math.abs(aa - 175) <= 2 || Math.abs(aa - 248) <= 2 || Math.abs(aa - 273) <= 2) {
      base = 0.95;
    }
    const jitter = (rand() - 0.5) * 0.15;
    const value = Math.max(0, Math.min(1, base + jitter));
    out.push({ position: aa, value });
  }
  return out;
}

export const TP53_CONSERVATION: ProfileDatum[] = buildConservation();

/**
 * Per-aa missense variant density derived from the dense TP53 fixture
 * (Slice 27's stacked-variants demo). The conversion: each variant's
 * CDS bp → aa (codon = ceil(bp/3)), then tally counts per aa. Only
 * `missense` variants count so the histogram reads as a gnomAD-style
 * "missense density" track even though our fixture is synthetic.
 */
function buildMissenseDensity(): ProfileDatum[] {
  const counts = new Map<number, number>();
  for (const v of TP53_DENSE_VARIANTS) {
    if (v.category !== 'missense') continue;
    if (v.coord.kind === 'cds') {
      const aa = Math.ceil(v.coord.cPos / 3);
      counts.set(aa, (counts.get(aa) ?? 0) + 1);
    } else if (v.coord.kind === 'protein') {
      counts.set(v.coord.aa, (counts.get(v.coord.aa) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([position, value]) => ({ position, value }));
}

export const TP53_MISSENSE_DENSITY: ProfileDatum[] = buildMissenseDensity();
