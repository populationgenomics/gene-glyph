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
    // Children render against the exon's baseline frame (x=0..baseline_width).
    // The wrapping `<g>` translates by the live screen-x and scales by the
    // live zoom factor; both vars are published per-exon by ViewportController.
    // CSS transitions on transform let pan / zoom interpolate without React
    // ever reissuing the children's SVG attributes — that's the whole point
    // of moving geometry into baseline coords.
    return (
      <g
        key={`exon-group-${exonIdx}`}
        className="vv-exon-group"
        style={{
          transform:
            `translateX(var(--vv-exon-x-${exonIdx}))` +
            ` scaleX(var(--vv-exon-scale-x-${exonIdx}, 1))`,
          transformOrigin: '0 0',
        }}
        data-vv-exon-idx={exonIdx}
      >
        {content}
      </g>
    );
  }

  function placeInInterExon(exonIdxA: number, exonIdxB: number, content: ReactNode): ReactNode {
    // Children render against the gap's baseline frame (x=0..baseline_gap_w).
    // Translate puts the `<g>` at the gap's current left edge; scaleX folds
    // the live zoom factor with `intronScale` so collapsed modes (spliced /
    // protein, intronScale=0) shrink the gap content to zero width — the
    // opacity transition then fades it out in lock-step.
    return (
      <g
        key={`inter-exon-${exonIdxA}-${exonIdxB}`}
        className="vv-intron-decoration"
        style={{
          transform:
            `translateX(var(--vv-intron-x-${exonIdxA}, 0px))` +
            ` scaleX(var(--vv-intron-scale-x-${exonIdxA}, 1))`,
          transformOrigin: '0 0',
          opacity: 'var(--vv-intron-scale)',
        }}
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
