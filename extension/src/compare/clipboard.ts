/**
 * Seam `Clipboard` — the system clipboard for the side bars' Paste and Copy (docs/replaceable-behaviors.md).
 *
 * The default is `navigator.clipboard` with no manifest permission (D3 lists none for the clipboard). Writing works
 * from a click on an extension page. Reading asks: Chrome shows its own prompt the first time a click reads the
 * clipboard, and remembers the answer for the extension (docs/spikes/compare-probe: windowed, the read waits for the
 * answer; without a window Chrome answers "denied" itself). A refused read comes back as `refused` with what to do
 * instead — paste with the keyboard into a side being edited (the browser's own paste needs no permission). A second
 * implementation would ask for the optional `clipboardRead` permission on the click — not built: no permission is
 * added without the owner.
 */
export type ClipboardRead = { text: string } | { refused: string };

export interface Clipboard {
  read(): Promise<ClipboardRead>;
  write(text: string): Promise<void>;
}

export const REFUSED_READ =
  'Chrome did not allow reading the clipboard. Switch the side to Edit and press the paste shortcut there, or allow ' +
  'the clipboard for this extension in Chrome’s site settings.';

export const navigatorClipboard = (clipboard: Pick<globalThis.Clipboard, 'readText' | 'writeText'>): Clipboard => ({
  async read() {
    try {
      return { text: await clipboard.readText() };
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'name' in error && error.name === 'NotAllowedError')
        return { refused: REFUSED_READ };
      return { refused: `The clipboard could not be read (${String(error)}).` };
    }
  },
  write: text => clipboard.writeText(text),
});
