import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GeneGlyph } from './viewer.js';

describe('GeneGlyph', () => {
  it('renders a placeholder element', () => {
    render(<GeneGlyph />);
    expect(screen.getByTestId('gene-glyph')).toBeInTheDocument();
  });
});
