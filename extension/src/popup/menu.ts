/**
 * The toolbar menu on the popup page: one row per item of the list, from the page's row template (the classes live in
 * the HTML, styled by @workspace/dna/menu.css). The first item has the focus when the menu opens; the arrow keys, Home
 * and End move it, and so does the pointer; Enter or a click chooses; Escape closes the popup (Chrome closes it on
 * Escape too, but only for a key it sees itself). After a choice the popup closes, whether the item's `open` worked or
 * not.
 */
import type { MenuApi, MenuItem } from './items';

export interface MenuView {
  /** The menu (`role="menu"`): the rows go in here. */
  list: HTMLElement;
  /** One row; its `button` is the item. */
  row: HTMLTemplateElement;
}

export interface MenuHost {
  api: MenuApi;
  /** Closes the popup (window.close). */
  close(): void;
  onError(error: unknown): void;
}

const STEPS: Record<string, (at: number, count: number) => number> = {
  ArrowDown: (at, count) => (at + 1) % count,
  ArrowUp: (at, count) => (at - 1 + count) % count,
  Home: () => 0,
  End: (_at, count) => count - 1,
};

/** Draws the items and wires the keyboard. Returns the item buttons, in order. */
export const mountMenu = (view: MenuView, items: readonly MenuItem[], host: MenuHost): HTMLButtonElement[] => {
  let chosen = false;
  const choose = (item: MenuItem): void => {
    if (chosen) return;
    chosen = true;
    item
      .open(host.api)
      .catch(host.onError)
      .finally(() => host.close());
  };

  const buttons = items.map(item => {
    const row = view.row.content.firstElementChild!.cloneNode(true) as HTMLElement;
    const button = row.querySelector('button')!;
    button.textContent = item.title;
    button.dataset.item = item.id;
    button.addEventListener('click', () => choose(item));
    // One highlight: the pointer moves the focus as the keys do.
    button.addEventListener('pointermove', () => button.focus());
    view.list.append(row);
    return button;
  });

  view.list.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      host.close();
      return;
    }
    const step = STEPS[event.key];
    if (!step || buttons.length === 0) return;
    event.preventDefault();
    const at = buttons.indexOf(view.list.ownerDocument.activeElement as HTMLButtonElement);
    buttons[step(at < 0 ? 0 : at, buttons.length)]!.focus();
  });

  buttons[0]?.focus();
  return buttons;
};
