/**
 * The editor page must not take the keyboard while the main page has a modal open (the shell's palette, any dialog of
 * @workspace/ui). The main page makes everything behind the modal `inert`, the frame of this page included — and that
 * stops the main page from focusing the frame and a click from landing in it, but not this page focusing itself from
 * inside: in Chrome a `focus()` called in the frame still takes the focus and the keys (probe 2026-11-21,
 * docs/extension-structure.md §18.11). The editor's module does just that when it starts (its text input), and when a side
 * is switched to edit mode. So while the frame's element is inert in the main page, focusing is refused here — the
 * frame reads it from its parent directly (same origin), with no message that could arrive too late — and a focus that
 * arrives some other way is put down at once.
 */

/** Whether this page's frame stands behind a modal of the main page (its element, or an ancestor, is inert there). */
export const behindModal =
  (win: Pick<Window, 'frameElement'>): (() => boolean) =>
  () =>
    !!win.frameElement?.closest('[inert]');

/** Refuses focus in `win` while `blocked()` says so: `element.focus()`, `window.focus()`, and any focus that arrives. */
export const guardFocus = (win: Window & typeof globalThis, blocked: () => boolean): (() => void) => {
  const proto = win.HTMLElement.prototype;
  const elementFocus = proto.focus;
  const windowFocus = win.focus;
  proto.focus = function focus(this: HTMLElement, options?: FocusOptions) {
    if (!blocked()) elementFocus.call(this, options);
  };
  win.focus = function focus() {
    if (!blocked()) windowFocus.call(win);
  };
  const onFocusIn = (event: FocusEvent): void => {
    if (blocked() && event.target instanceof win.HTMLElement) event.target.blur();
  };
  win.addEventListener('focusin', onFocusIn, true);
  return () => {
    proto.focus = elementFocus;
    win.focus = windowFocus;
    win.removeEventListener('focusin', onFocusIn, true);
  };
};
