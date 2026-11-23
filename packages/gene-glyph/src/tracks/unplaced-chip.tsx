import type { FocusEvent, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import type { FeatureClickProps } from './feature-click.js';

/** The focusable control inside an unplaced chip's `<li>`: a `<button>`
 *  when the host lets the feature be clicked, else a focusable `<span>`,
 *  so a keyboard user reaches the tooltip either way. Hover and focus open
 *  the tooltip anchored to the control. */
export function unplacedChipControl(args: {
  featureId: string;
  click: FeatureClickProps;
  onFeatureHover?: (featureId: string | null, anchorEl?: Element) => void;
  children: ReactNode;
}): ReactNode {
  const { featureId, click, onFeatureHover, children } = args;
  const enter = (e: MouseEvent<Element> | FocusEvent<Element>) =>
    onFeatureHover?.(featureId, e.currentTarget);
  const leave = () => onFeatureHover?.(null);
  const hover = { onMouseEnter: enter, onMouseLeave: leave, onFocus: enter, onBlur: leave };
  return click.clickable ? (
    <button
      type="button"
      className="vv-unplaced-chip-control"
      onClick={click.onClick}
      // Keep Enter and Space from the viewer's own key bindings (Space arms
      // panning), so the button's native activation runs.
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
      }}
      {...hover}
    >
      {children}
    </button>
  ) : (
    <span className="vv-unplaced-chip-control" tabIndex={0} {...hover}>
      {children}
    </span>
  );
}
