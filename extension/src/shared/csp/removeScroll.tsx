/**
 * Stands in for `react-remove-scroll` (vite.config.ts and vitest.config.ts alias it here). Radix uses it to lock the
 * page's scroll while a Select list or a modal menu is open; it does so by inserting a `<style>` element
 * (react-style-singleton), which the extension's CSP (`style-src 'self'`, no 'unsafe-inline') refuses — one console
 * error per opening. Without the lock the page under an open list can still scroll; nothing else changes. The CSP stays
 * as it is (docs/extension-structure.md §5).
 */
import type { ReactNode } from 'react';

interface RemoveScrollProps {
  children?: ReactNode;
  // The props Radix passes (`as`, `allowPinchZoom`, `enabled`, `shards`, …) are accepted and ignored.
  [prop: string]: unknown;
}

const RemoveScrollShim = ({ children }: RemoveScrollProps): ReactNode => children;

export const RemoveScroll = Object.assign(RemoveScrollShim, {
  classNames: { fullWidth: 'width-before-scroll-bar', zeroRight: 'right-scroll-bar-position' },
});
