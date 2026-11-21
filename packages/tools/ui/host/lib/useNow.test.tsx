// @vitest-environment jsdom
import { useNow } from './useNow';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

let shown: number[] = [];
const Clock = (): ReactElement => {
  const now = useNow();
  shown.push(now);
  return <output>{now}</output>;
};
const setVisibility = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
};

beforeEach(() => {
  shown = [];
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_250);
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useNow (unix-time.md §5.7)', () => {
  it('starts at Date.now() and turns on the boundary of each second', () => {
    render(<Clock />);
    expect(shown.at(-1)).toBe(1_700_000_000_250);
    act(() => vi.advanceTimersByTime(749));
    expect(shown.at(-1)).toBe(1_700_000_000_250);
    act(() => vi.advanceTimersByTime(1));
    expect(shown.at(-1)).toBe(1_700_000_001_000);
    act(() => vi.advanceTimersByTime(1000));
    expect(shown.at(-1)).toBe(1_700_000_002_000);
  });

  it('stops while the page is hidden and renews at once when it is shown', () => {
    render(<Clock />);
    act(() => setVisibility('hidden'));
    const before = shown.length;
    act(() => vi.advanceTimersByTime(5000));
    expect(shown.length).toBe(before);
    act(() => setVisibility('visible'));
    expect(shown.at(-1)).toBe(1_700_000_005_250);
    act(() => vi.advanceTimersByTime(750));
    expect(shown.at(-1)).toBe(1_700_000_006_000);
  });

  it('leaves no timer behind when it unmounts', () => {
    const { unmount } = render(<Clock />);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
