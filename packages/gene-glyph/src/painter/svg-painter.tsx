import type { CSSProperties, ReactNode } from 'react';
import type {
  DrawCircleArgs,
  DrawLineArgs,
  DrawPathArgs,
  DrawRectArgs,
  DrawTextArgs,
  GroupArgs,
  Painter,
  PainterMode,
} from '../types.js';

export interface SvgPainterOptions {
  mode?: PainterMode;
}

export function createSvgPainter(options: SvgPainterOptions = {}): Painter {
  const mode: PainterMode = options.mode ?? 'screen';

  function placeInExonGroup(exonIdx: number, content: ReactNode): ReactNode {
    return (
      <g
        key={`exon-group-${exonIdx}`}
        className="vv-exon-group"
        style={{ transform: `translateX(var(--vv-exon-x-${exonIdx}))` }}
        data-vv-exon-idx={exonIdx}
      >
        {content}
      </g>
    );
  }

  function placeInInterExon(exonIdxA: number, exonIdxB: number, content: ReactNode): ReactNode {
    return (
      <g
        key={`inter-exon-${exonIdxA}-${exonIdxB}`}
        className="vv-intron-decoration"
        style={{ opacity: 'var(--vv-intron-scale)' }}
        data-vv-intron-from={exonIdxA}
        data-vv-intron-to={exonIdxB}
      >
        {content}
      </g>
    );
  }

  function placeAbsolute(x: number, y: number, content: ReactNode): ReactNode {
    return (
      <g key={`abs-${x}-${y}`} transform={`translate(${x}, ${y})`}>
        {content}
      </g>
    );
  }

  function drawRect(args: DrawRectArgs): ReactNode {
    const { onClick, key, ...rest } = args;
    return (
      <rect
        key={key}
        x={rest.x}
        y={rest.y}
        width={rest.width}
        height={rest.height}
        rx={rest.rx}
        ry={rest.ry}
        fill={rest.fill}
        stroke={rest.stroke}
        strokeWidth={rest.strokeWidth}
        vectorEffect={rest.vectorEffect}
        className={rest.className}
        onClick={onClick}
      />
    );
  }

  function drawLine(args: DrawLineArgs): ReactNode {
    return (
      <line
        key={args.key}
        x1={args.x1}
        y1={args.y1}
        x2={args.x2}
        y2={args.y2}
        stroke={args.stroke}
        strokeWidth={args.strokeWidth}
        className={args.className}
      />
    );
  }

  function drawText(args: DrawTextArgs): ReactNode {
    return (
      <text
        key={args.key}
        x={args.x}
        y={args.y}
        fontSize={args.fontSize}
        fill={args.fill}
        textAnchor={args.textAnchor}
        dominantBaseline={args.dominantBaseline}
        className={args.className}
      >
        {args.text}
      </text>
    );
  }

  function drawPath(args: DrawPathArgs): ReactNode {
    return (
      <path
        key={args.key}
        d={args.d}
        fill={args.fill}
        stroke={args.stroke}
        strokeWidth={args.strokeWidth}
        className={args.className}
      />
    );
  }

  function drawCircle(args: DrawCircleArgs): ReactNode {
    return (
      <circle
        key={args.key}
        cx={args.cx}
        cy={args.cy}
        r={args.r}
        fill={args.fill}
        stroke={args.stroke}
        strokeWidth={args.strokeWidth}
        className={args.className}
      />
    );
  }

  function group(args: GroupArgs): ReactNode {
    return (
      <g key={args.key} className={args.className} style={args.style as CSSProperties | undefined}>
        {args.children}
      </g>
    );
  }

  function color(varName: string, fallback?: string): string {
    const name = varName.startsWith('--') ? varName : `--${varName}`;
    return fallback ? `var(${name}, ${fallback})` : `var(${name})`;
  }

  return {
    mode,
    placeInExonGroup,
    placeInInterExon,
    placeAbsolute,
    drawRect,
    drawLine,
    drawText,
    drawPath,
    drawCircle,
    group,
    color,
  };
}
