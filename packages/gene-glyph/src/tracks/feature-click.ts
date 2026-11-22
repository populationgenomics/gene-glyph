import type { KeyboardEvent } from 'react';

/** Interaction props for a feature that may be clicked. */
export interface FeatureClickProps {
  clickable: boolean;
  role?: 'button';
  tabIndex?: number;
  onClick?: () => void;
  onKeyDown?: (e: KeyboardEvent) => void;
}

/** Props that make feature `featureId` a button when the host lets it be
 *  clicked: `role="button"`, a tab stop, and activation on click, Enter
 *  and Space. A feature the host does not let be clicked gets none of
 *  them (it stays hoverable). Without `isFeatureClickable` (a track
 *  rendered outside a viewer), every feature is clickable when
 *  `onFeatureClick` is given. */
export function featureClickProps(
  featureId: string,
  args: {
    onFeatureClick?: (featureId: string) => void;
    isFeatureClickable?: (featureId: string) => boolean;
  },
): FeatureClickProps {
  const { onFeatureClick, isFeatureClickable } = args;
  if (!onFeatureClick) return { clickable: false };
  if (isFeatureClickable && !isFeatureClickable(featureId)) return { clickable: false };
  const activate = () => onFeatureClick(featureId);
  return {
    clickable: true,
    role: 'button',
    tabIndex: 0,
    onClick: activate,
    onKeyDown: (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      // Keep Space from scrolling the page and the keys from reaching the
      // viewer's own keyboard bindings.
      e.preventDefault();
      e.stopPropagation();
      activate();
    },
  };
}

/** {@link featureClickProps} without the `clickable` flag, to spread onto
 *  an element. */
export function clickAttrs(p: FeatureClickProps): Omit<FeatureClickProps, 'clickable'> {
  const { clickable: _clickable, ...attrs } = p;
  return attrs;
}
