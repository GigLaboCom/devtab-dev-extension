/**
 * A document of someone else's content, shown on a privileged page (docs/tools/README.md, «Приватность и разрешения»:
 * pasted markup only in an isolated frame that may not run scripts). Written so it can move to the kit unchanged — the
 * HTML Preview tool needs the same frame (html-preview.md §5.1); until then it lives in this package (adding-a-tool.md
 * §5). The layers, outermost first:
 *
 *   1. `sandbox` without `allow-scripts`: nothing in the frame runs — no script element, handler, `javascript:` address
 *      or `<meta refresh>` — whatever reaches its document. `allow-same-origin` lets the page write the document (it is
 *      dangerous only together with `allow-scripts`); `allow-popups` + `allow-popups-to-escape-sandbox` let a link with
 *      `target="_blank"` open a normal tab. No forms, no top navigation, no modals, no downloads.
 *   2. The frame's own policy, a `<meta>` in its `srcdoc`: nothing may load but the stylesheet and fonts of the
 *      extension's own files — no script, image, media, frame, object, form target or base. It adds to the page's policy,
 *      which an `about:srcdoc` document inherits, never replaces it.
 *   3. The page's policy (the host's: `default-src 'none'`, `img-src 'self'`, …), inherited.
 *
 * The frame's document is written in `srcdoc` (no `blob:`, no `data:`) and holds no content of its own: the page puts the
 * content into its body as nodes (`render`), built in the frame's document — never as markup. Its look is one stylesheet,
 * a file (`stylesheet`), which the frame's policy allows. Its theme is the embedding page's: the style package's contract
 * puts the theme on `<html>` (`data-theme`, `data-mode`), and the frame's `<html>` gets the same attributes now and on
 * every change.
 */
import { useEffect, useRef, useState } from 'react';
import type { ComponentProps, ReactElement } from 'react';

/** What the frame may do: open a link in a new, normal tab. Nothing runs (no `allow-scripts`). */
export const FRAME_SANDBOX = 'allow-same-origin allow-popups allow-popups-to-escape-sandbox';

/** The frame's own policy (layer 2): its stylesheet and fonts from the extension's files, nothing else at all. */
export const FRAME_POLICY = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'none'",
  "media-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

/** The attributes of the style package's theme, on the page's `<html>` and the frame's. */
const THEME_ATTRIBUTES = ['data-theme', 'data-mode'];

const attribute = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The frame's whole document before the page fills its body. */
export const frameSource = (stylesheet: string): string =>
  '<!doctype html><html><head><meta charset="utf-8">' +
  `<meta http-equiv="Content-Security-Policy" content="${attribute(FRAME_POLICY)}">` +
  `<link rel="stylesheet" href="${attribute(stylesheet)}">` +
  '</head><body></body></html>';

const followTheme = (from: HTMLElement, to: HTMLElement): void => {
  for (const name of THEME_ATTRIBUTES) {
    const value = from.getAttribute(name);
    if (value === null) to.removeAttribute(name);
    else if (to.getAttribute(name) !== value) to.setAttribute(name, value);
  }
};

export interface FramedDocumentProps extends Omit<ComponentProps<'iframe'>, 'srcDoc' | 'sandbox' | 'src' | 'children'> {
  /** The frame's accessible name. */
  title: string;
  /** The address of the framed document's stylesheet: a file of the build. */
  stylesheet: string;
  /** Puts the content into the frame's document (its body); called when the document is ready and when `version` changes. */
  render: (doc: Document) => void;
  /** What the content is now (the input it was built from): a change calls `render` again. */
  version: unknown;
}

export const FramedDocument = ({ title, stylesheet, render, version, ...props }: FramedDocumentProps): ReactElement => {
  const frame = useRef<HTMLIFrameElement>(null);
  // The frame's document once its srcdoc has loaded (a new one after any reload of the frame).
  const [doc, setDoc] = useState<Document | null>(null);
  const draw = useRef(render);
  draw.current = render;

  const loaded = (): void => {
    const next = frame.current?.contentDocument ?? null;
    if (next?.body) setDoc(next);
  };

  // The embedding page's theme, now and on every change.
  useEffect(() => {
    if (!doc) return;
    const page = frame.current?.ownerDocument.documentElement;
    if (!page) return;
    followTheme(page, doc.documentElement);
    const watch = new MutationObserver(() => followTheme(page, doc.documentElement));
    watch.observe(page, { attributes: true, attributeFilter: THEME_ATTRIBUTES });
    return () => watch.disconnect();
  }, [doc]);

  // Each drawing is counted on the frame element (`data-rendered`): a test, or a host, can wait for the next one.
  const drawn = useRef(0);
  useEffect(() => {
    if (!doc) return;
    draw.current(doc);
    frame.current?.setAttribute('data-rendered', String(++drawn.current));
  }, [doc, version]);

  return (
    <iframe
      ref={frame}
      title={title}
      sandbox={FRAME_SANDBOX}
      srcDoc={frameSource(stylesheet)}
      onLoad={loaded}
      {...props}
    />
  );
};
