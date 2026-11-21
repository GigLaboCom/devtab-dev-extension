/**
 * When the palette opens and where focus goes after it. Its shortcut (⌘K / Ctrl+K unless the user changed it) is one
 * of the user's shortcuts (useShortcuts.ts, `find`), which calls `toggle`. Before opening, the focused element is
 * remembered: closing the palette (Escape, a click outside, the shortcut again) puts focus back there; going to a
 * place puts it on the page that was opened (the `main` region), since the element may be gone with the page it was on.
 */
import { isMac } from '@src/shared/keys';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';

export interface Find {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Opens the palette, remembering where focus was. */
  show: () => void;
  /** Opens it, or closes it when open. */
  toggle: () => void;
  /** The palette has closed: focus goes back, or to the page that was opened. */
  closed: (went: boolean) => void;
  mac: boolean;
}

export const useFind = (main: RefObject<HTMLElement | null>, fallback: RefObject<HTMLElement | null>): Find => {
  const [open, setOpen] = useState(false);
  const isOpen = useRef(false);
  isOpen.current = open;
  const before = useRef<HTMLElement | null>(null);
  const mac = useMemo(() => isMac(), []);

  const show = useCallback(() => {
    const active = document.activeElement;
    before.current = active instanceof HTMLElement && active !== document.body ? active : null;
    setOpen(true);
  }, []);

  const toggle = useCallback(() => {
    if (isOpen.current) setOpen(false);
    else show();
  }, [show]);

  const closed = useCallback(
    (went: boolean) => {
      const back = before.current;
      before.current = null;
      if (went) main.current?.focus({ preventScroll: true });
      else if (back?.isConnected) {
        back.focus({ preventScroll: true });
        // The editor of «Compare code» is a frame: its own document takes the keys back only when its window is focused.
        if (back instanceof HTMLIFrameElement) back.contentWindow?.focus();
      } else fallback.current?.focus({ preventScroll: true });
    },
    [main, fallback],
  );

  return { open, setOpen, show, toggle, closed, mac };
};
