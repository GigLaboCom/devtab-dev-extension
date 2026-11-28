/**
 * What the editor's Copy or Cut writes, taken instead of written. A strip's button runs the editor's own Copy in the
 * module (gpui-kit's action, the road the key takes); on the web that ends in `navigator.clipboard.writeText` on this
 * page, synchronously, inside the module's call. But the click was on the main page: the activation and the focus a
 * clipboard write needs are the main page's, and this page's write could be refused. So for the length of the call the
 * write is caught here and handed up (`viewer/done`'s `copied`), and the main page writes it through its `Clipboard`
 * seam. A key pressed in the editor never passes here: its write is this page's own, inside its own keystroke.
 */
type Writable = Pick<globalThis.Clipboard, 'writeText'>;

export const captureClipboardWrites = (clipboard: Writable | undefined, run: () => void): string | undefined => {
  if (!clipboard) {
    run();
    return undefined;
  }
  let written: string | undefined;
  const own = Object.getOwnPropertyDescriptor(clipboard, 'writeText');
  Object.defineProperty(clipboard, 'writeText', {
    configurable: true,
    writable: true,
    value: (text: string): Promise<void> => {
      written = text;
      return Promise.resolve();
    },
  });
  try {
    run();
  } finally {
    if (own) Object.defineProperty(clipboard, 'writeText', own);
    else delete (clipboard as { writeText?: unknown }).writeText;
  }
  return written;
};
