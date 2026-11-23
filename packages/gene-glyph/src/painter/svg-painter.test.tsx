import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { createSvgPainter } from './svg-painter.js';

function renderInSvg(node: React.ReactNode) {
  return render(<svg data-testid="svg">{node}</svg>);
}

describe('createSvgPainter', () => {
  it('defaults to screen mode and exposes the mode flag', () => {
    const p = createSvgPainter();
    expect(p.mode).toBe('screen');
    const exportP = createSvgPainter({ mode: 'export' });
    expect(exportP.mode).toBe('export');
  });

  it('drawRect renders a <rect> with the supplied attributes', () => {
    const p = createSvgPainter();
    const { container } = renderInSvg(
      p.drawRect({ x: 1, y: 2, width: 10, height: 4, fill: '#abc' }),
    );
    const rect = container.querySelector('rect');
    expect(rect).not.toBeNull();
    expect(rect!.getAttribute('x')).toBe('1');
    expect(rect!.getAttribute('width')).toBe('10');
    expect(rect!.getAttribute('fill')).toBe('#abc');
  });

  it('placeInExonGroup wraps content in a vv-exon-group with the right transform', () => {
    const p = createSvgPainter();
    const { container } = renderInSvg(
      p.placeInExonGroup(2, p.drawRect({ x: 0, y: 0, width: 5, height: 5 })),
    );
    const group = container.querySelector('g.vv-exon-group');
    expect(group).not.toBeNull();
    expect(group!.getAttribute('data-vv-exon-idx')).toBe('2');
    expect((group as HTMLElement).style.transform).toContain('var(--vv-exon-x-2)');
    expect(group!.querySelector('rect')).not.toBeNull();
  });

  it('placeInInterExon wraps content in vv-intron-decoration with opacity and translate tied to CSS variables', () => {
    const p = createSvgPainter();
    const { container } = renderInSvg(
      p.placeInInterExon(2, 3, p.drawLine({ x1: 0, y1: 0, x2: 5, y2: 0 })),
    );
    const group = container.querySelector('g.vv-intron-decoration');
    expect(group).not.toBeNull();
    const style = (group as HTMLElement).style;
    expect(style.opacity).toBe('var(--vv-intron-scale)');
    // The translate keeps inter-exon content moving in lock-step with the
    // exon groups; without this, the polylines / linkers would snap to new
    // absolute positions on each range change instead of animating.
    expect(style.transform).toContain('translateX(var(--vv-intron-x-2');
  });

  it('color() returns a CSS var() expression with fallback', () => {
    const p = createSvgPainter();
    expect(p.color('vv-color-text-primary', '#1f2937')).toBe(
      'var(--vv-color-text-primary, #1f2937)',
    );
    expect(p.color('--vv-color-bg-surface')).toBe('var(--vv-color-bg-surface)');
  });

  it('drawText, drawPath, drawCircle render the corresponding SVG elements', () => {
    const p = createSvgPainter();
    const { container } = renderInSvg(
      <>
        {p.drawText({ key: 't', x: 0, y: 0, text: 'hello', fontSize: 12 })}
        {p.drawPath({ key: 'p', d: 'M0 0 L10 10', stroke: '#000' })}
        {p.drawCircle({ key: 'c', cx: 5, cy: 5, r: 3 })}
      </>,
    );
    expect(container.querySelector('text')?.textContent).toBe('hello');
    expect(container.querySelector('path')?.getAttribute('d')).toBe('M0 0 L10 10');
    expect(container.querySelector('circle')?.getAttribute('r')).toBe('3');
  });
});

describe('createSvgPainter — feature groups', () => {
  it('group writes the feature id, attributes, name and handlers onto its <g>', () => {
    const p = createSvgPainter();
    const entered: string[] = [];
    const { container } = render(
      <svg>
        {p.group({
          featureId: 'f1',
          attributes: { 'data-vv-intron-side': 'donor' },
          ariaLabel: 'Feature one',
          tabIndex: 0,
          onMouseEnter: () => entered.push('mouse'),
          onFocus: () => entered.push('focus'),
          children: p.drawPath({ d: 'M0 0h5', vectorEffect: 'non-scaling-stroke' }),
        })}
      </svg>,
    );
    const g = container.querySelector('g')!;
    expect(g.getAttribute('data-vv-feature-id')).toBe('f1');
    expect(g.getAttribute('data-vv-intron-side')).toBe('donor');
    expect(g.getAttribute('aria-label')).toBe('Feature one');
    expect(g.getAttribute('tabindex')).toBe('0');
    expect(container.querySelector('path')!.getAttribute('vector-effect')).toBe(
      'non-scaling-stroke',
    );
    fireEvent.mouseEnter(g);
    fireEvent.focus(g);
    expect(entered).toEqual(['mouse', 'focus']);
  });

  it('drawRect writes fill and stroke opacity', () => {
    const p = createSvgPainter();
    const { container } = render(
      <svg>
        {p.drawRect({ x: 0, y: 0, width: 1, height: 1, fillOpacity: 0.35, strokeOpacity: 0.6 })}
      </svg>,
    );
    const rect = container.querySelector('rect')!;
    expect(rect.getAttribute('fill-opacity')).toBe('0.35');
    expect(rect.getAttribute('stroke-opacity')).toBe('0.6');
  });
});
