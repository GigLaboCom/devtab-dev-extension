/**
 * The toolbar menu on the real popup markup (index.html): one row per item in the list's order, focus on the first, the
 * keys move it, a choice opens the item and then closes the popup.
 */
import page from './index.html?raw';
import { mountMenu } from './menu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MenuApi, MenuItem } from './items';

const ITEMS = (open = vi.fn(() => Promise.resolve())): MenuItem[] =>
  ['one', 'two', 'three'].map(id => ({ id, title: `Item ${id}`, opens: { route: `#/${id}` }, open }));

const mount = (items: readonly MenuItem[]) => {
  document.body.innerHTML = new DOMParser().parseFromString(page, 'text/html').body.innerHTML;
  const host = { api: {} as MenuApi, close: vi.fn(), onError: vi.fn() };
  const list = document.getElementById('menu')!;
  const buttons = mountMenu({ list, row: document.getElementById('menu-row') as HTMLTemplateElement }, items, host);
  const press = (key: string) =>
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  return { host, list, buttons, press };
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the toolbar menu', () => {
  it('draws one menu item per entry, in order, with its title — the page names none', () => {
    const { list, buttons } = mount(ITEMS());
    expect(page).not.toMatch(/New tab|Settings/);
    expect(list.getAttribute('role')).toBe('menu');
    expect(buttons.map(b => b.textContent)).toEqual(['Item one', 'Item two', 'Item three']);
    expect(buttons.every(b => b.getAttribute('role') === 'menuitem' && b.type === 'button')).toBe(true);
    expect(list.querySelectorAll('li')).toHaveLength(3);
  });

  it('opens with the focus on the first item', () => {
    const { buttons } = mount(ITEMS());
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('the arrow keys move the focus and wrap; Home and End go to the ends', () => {
    const { buttons, press } = mount(ITEMS());
    press('ArrowDown');
    expect(document.activeElement).toBe(buttons[1]);
    press('ArrowDown');
    press('ArrowDown');
    expect(document.activeElement).toBe(buttons[0]);
    press('ArrowUp');
    expect(document.activeElement).toBe(buttons[2]);
    press('Home');
    expect(document.activeElement).toBe(buttons[0]);
    press('End');
    expect(document.activeElement).toBe(buttons[2]);
  });

  it('Escape closes the popup, choosing nothing', () => {
    const open = vi.fn(() => Promise.resolve());
    const { press, host } = mount(ITEMS(open));
    press('Escape');
    expect(host.close).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });

  it('other keys are left to the browser (Enter clicks the focused button, Tab moves on)', () => {
    const { press } = mount(ITEMS());
    expect(press('Enter')).toBe(true);
    expect(press('Tab')).toBe(true);
    expect(press('ArrowDown')).toBe(false);
  });

  it('choosing an item opens it with the page’s APIs, then closes the popup', async () => {
    const open = vi.fn(() => Promise.resolve());
    const { buttons, host } = mount(ITEMS(open));
    buttons[1]!.click();
    expect(open).toHaveBeenCalledWith(host.api);
    await vi.waitFor(() => expect(host.close).toHaveBeenCalledTimes(1));
    expect(host.onError).not.toHaveBeenCalled();
  });

  it('closes even when the item fails, and says why', async () => {
    const { buttons, host } = mount(ITEMS(vi.fn(() => Promise.reject(new Error('no window')))));
    buttons[0]!.click();
    await vi.waitFor(() => expect(host.close).toHaveBeenCalledTimes(1));
    expect(host.onError).toHaveBeenCalledWith(new Error('no window'));
  });

  it('takes one choice: a second click while the first opens does nothing', async () => {
    const open = vi.fn(() => Promise.resolve());
    const { buttons, host } = mount(ITEMS(open));
    buttons[0]!.click();
    buttons[1]!.click();
    await vi.waitFor(() => expect(host.close).toHaveBeenCalled());
    expect(open).toHaveBeenCalledTimes(1);
  });
});
