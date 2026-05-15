import type { ReactNode } from 'react';

export interface GeneGlyphProps {
  children?: ReactNode;
}

export function GeneGlyph({ children: _children }: GeneGlyphProps) {
  return (
    <div className="gene-glyph" data-testid="gene-glyph">
      <span className="gene-glyph-placeholder">gene-glyph 0.0.0 — empty viewer</span>
    </div>
  );
}
