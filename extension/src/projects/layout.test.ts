/**
 * The panels' state (D35): defaults, a stored layout made safe, a switch pressed and a view asked for, the limits that
 * keep the editor, and the memory — chrome.storage.local with a localStorage copy, or the page's life only.
 */
import {
  BOTTOM_MAX,
  BOTTOM_MIN,
  DEFAULT_LAYOUT,
  EDITOR_MIN_HEIGHT,
  EDITOR_MIN_WIDTH,
  SIDE_MAX,
  SIDE_MIN,
  bottomMax,
  normalizeLayout,
  pressView,
  revealView,
  sideMax,
} from './layout';
import { LAYOUT_CACHE_KEY, LAYOUT_KEY, memoryLayout, storedLayout } from './layoutMemory';
import { describe, expect, it } from 'vitest';

describe('the layout', () => {
  it('starts with Files open and the bottom panel collapsed on History', () => {
    expect(DEFAULT_LAYOUT.side).toMatchObject({ open: true, view: 'files' });
    expect(DEFAULT_LAYOUT.bottom).toMatchObject({ open: false, view: 'history' });
    expect(normalizeLayout(undefined)).toEqual(DEFAULT_LAYOUT);
  });

  it('a stored layout is made safe: unknown views and odd sizes give way to the defaults and limits', () => {
    expect(
      normalizeLayout({
        side: { open: false, view: 'terminal', width: 99_999 },
        bottom: { open: 'yes', view: 'find', height: 3 },
        extra: 1,
      }),
    ).toEqual({
      version: 1,
      side: { open: false, view: 'files', width: SIDE_MAX },
      bottom: { open: false, view: 'find', height: BOTTOM_MIN },
    });
    expect(normalizeLayout({ side: { width: Number.NaN } }).side.width).toBe(DEFAULT_LAYOUT.side.width);
  });

  it('a pressed switch shows its view; the view showing collapses its panel; a closed panel opens on the view', () => {
    const commit = pressView(DEFAULT_LAYOUT, 'commit');
    expect(commit.side).toMatchObject({ open: true, view: 'commit' });
    const collapsed = pressView(commit, 'commit');
    expect(collapsed.side).toMatchObject({ open: false, view: 'commit' });
    expect(pressView(collapsed, 'files').side).toMatchObject({ open: true, view: 'files' });
    expect(pressView(DEFAULT_LAYOUT, 'find').bottom).toMatchObject({ open: true, view: 'find' });
    expect(pressView(pressView(DEFAULT_LAYOUT, 'find'), 'find').bottom.open).toBe(false);
  });

  it('a view asked for opens its panel and never collapses it', () => {
    const find = revealView(DEFAULT_LAYOUT, 'find');
    expect(find.bottom).toMatchObject({ open: true, view: 'find' });
    expect(revealView(find, 'find').bottom.open).toBe(true);
    expect(revealView(find, 'history').bottom).toMatchObject({ open: true, view: 'history' });
  });

  it('the panels never take the editor’s minimum; unmeasured, only their own limits hold', () => {
    expect(sideMax(0)).toBe(SIDE_MAX);
    expect(sideMax(800)).toBe(800 - EDITOR_MIN_WIDTH);
    expect(sideMax(2000)).toBe(SIDE_MAX);
    expect(sideMax(300)).toBe(SIDE_MIN);
    expect(bottomMax(0)).toBe(BOTTOM_MAX);
    expect(bottomMax(500)).toBe(500 - EDITOR_MIN_HEIGHT);
    expect(bottomMax(200)).toBe(BOTTOM_MIN);
  });
});

describe('the layout’s memory', () => {
  const fakeArea = () => {
    const data: Record<string, unknown> = {};
    return {
      data,
      get: (key: string) => Promise.resolve(key in data ? { [key]: data[key] } : {}),
      set: (items: Record<string, unknown>) => Promise.resolve(void Object.assign(data, items)),
    };
  };
  const fakeWin = () => {
    const items = new Map<string, string>();
    return {
      items,
      localStorage: {
        getItem: (k: string) => items.get(k) ?? null,
        setItem: (k: string, v: string) => void items.set(k, v),
      } as unknown as Storage,
    };
  };

  it('keeps the layout in chrome.storage.local and a copy in localStorage for the first render', async () => {
    const area = fakeArea();
    const win = fakeWin();
    const memory = storedLayout(() => ({ area: area as never, win }));
    expect(memory.initial()).toBeNull();
    expect(await memory.load()).toBeNull();
    const layout = pressView(DEFAULT_LAYOUT, 'commit');
    memory.save(layout);
    await Promise.resolve();
    expect(area.data[LAYOUT_KEY]).toEqual(layout);
    expect(JSON.parse(win.items.get(LAYOUT_CACHE_KEY)!)).toEqual(layout);
    expect(memory.initial()).toEqual(layout);
    expect(await memory.load()).toEqual(layout);
  });

  it('without the extension’s storage nothing fails and nothing is remembered', async () => {
    const memory = storedLayout(() => null);
    expect(memory.initial()).toBeNull();
    expect(await memory.load()).toBeNull();
    expect(() => memory.save(DEFAULT_LAYOUT)).not.toThrow();
    const broken = storedLayout(() => ({
      area: { get: () => Promise.reject(new Error('gone')), set: () => Promise.reject(new Error('gone')) } as never,
      win: { localStorage: { getItem: () => '{not json', setItem: () => undefined } as unknown as Storage },
    }));
    expect(broken.initial()).toBeNull();
    expect(await broken.load()).toBeNull();
    expect(() => broken.save(DEFAULT_LAYOUT)).not.toThrow();
  });

  it('the page-life memory keeps what it was given', async () => {
    const memory = memoryLayout();
    expect(memory.initial()).toBeNull();
    memory.save(pressView(DEFAULT_LAYOUT, 'find'));
    expect((await memory.load())?.bottom.open).toBe(true);
  });
});
