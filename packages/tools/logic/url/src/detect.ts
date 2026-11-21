/**
 * The start page's `detectUrl` (docs/tools/specs/url.md §7), in a module of its own: the tool's definition imports only
 * this (and what it needs: the codec and the platform parser), so parsing into parts and the JSON of parameters stay
 * in the component's chunk.
 */
import { decodeUrl } from './codec';
import { platformParse } from './platform';

const DETECT_MAX = 65536;
const SCHEME_AND_SLASHES = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;
const ESCAPE = /%[0-9A-Fa-f]{2}/;

/**
 * Which mode fits text pasted into the start page (§7): `parse` — an absolute URL with `//` the parser accepts;
 * `decode` — text with a valid `%XX` escape that decodes to valid UTF-8; `undefined` — not this tool's input. An
 * addition to §9: the component opens handed text in this mode.
 */
export const detectedMode = (text: string): 'parse' | 'decode' | undefined => {
  const t = text.trim();
  if (t === '' || t.length > DETECT_MAX || /\s/.test(t) || /^data:/i.test(t)) return undefined;
  // Not a URL the parser accepts: it may still be encoded text (rule 2).
  if (SCHEME_AND_SLASHES.test(t) && platformParse(t)) return 'parse';
  if (/^[{["]/.test(t) || !ESCAPE.test(t)) return undefined;
  return decodeUrl(t, { plusAsSpace: false }).invalidUtf8 ? undefined : 'decode';
};

/** Does pasted text look like this tool's input (§7)? Cheap and strict: no `mailto:`, no `key:value`, no JSON. */
export const detectUrl = (text: string): boolean => detectedMode(text) !== undefined;
