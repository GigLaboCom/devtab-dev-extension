/**
 * The editor page's focus guard: behind a modal of the main page (its frame element inert there) the page refuses to
 * focus itself — `element.focus()`, `window.focus()`, and a focus that arrives anyway; once the modal is gone, focus
 * works again.
 */
import { behindModal, guardFocus } from './focusGuard';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('behindModal', () => {
  it('reads the frame’s element in the main page: inert itself or under an inert ancestor', () => {
    const shell = document.createElement('div');
    const frame = document.createElement('iframe');
    shell.append(frame);
    document.body.append(shell);
    const win = frame.contentWindow!;
    const blocked = behindModal(win);
    expect(blocked()).toBe(false);
    shell.setAttribute('inert', '');
    expect(blocked()).toBe(true);
    shell.removeAttribute('inert');
    expect(blocked()).toBe(false);
    // The main page itself has no frame element.
    expect(behindModal(window)()).toBe(false);
  });
});

describe('guardFocus', () => {
  it('refuses element and window focus while blocked, and puts down a focus that arrives anyway', () => {
    document.body.innerHTML = '<textarea id="t"></textarea><button id="b"></button>';
    const t = document.getElementById('t') as HTMLTextAreaElement;
    let blocked = true;
    const stop = guardFocus(window, () => blocked);
    t.focus();
    expect(document.activeElement).not.toBe(t);
    window.focus();
    // A focus the browser gives by itself (here: an event dispatched as the browser would) is put down at once.
    blocked = false;
    t.focus();
    expect(document.activeElement).toBe(t);
    blocked = true;
    t.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(document.activeElement).not.toBe(t);
    // Once the modal is gone, the editor focuses as before.
    blocked = false;
    t.focus();
    expect(document.activeElement).toBe(t);
    stop();
    blocked = true;
    (document.getElementById('b') as HTMLButtonElement).focus();
    expect(document.activeElement?.id).toBe('b');
  });
});
