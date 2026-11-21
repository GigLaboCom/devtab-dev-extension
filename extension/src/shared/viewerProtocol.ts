/**
 * Messages between the main page and the editor page in its iframe (same origin: the extension's). The editor owns
 * the two texts once they are in it: the main page sends texts (both, or one side), asks it to swap, to change the
 * language, to let the user edit a side, and reads a side back when it needs the text (copy, save). The editor
 * compares — on a request, and by itself after the user's edits — and answers with what it showed. Every request that
 * changes what is shown carries an id that comes back with its result, so the main page takes only the answer to its
 * latest request; a result of the user's edit carries none (`cause: 'edit'`). The theme does not travel here — both
 * pages follow chrome.storage themselves (D9).
 *
 * The editor page also hands up what happens on its canvas that belongs to the main page: a drag of files entering it
 * (the main page then covers the editor with its drop targets), a drop that reached it anyway, the main page's
 * keyboard shortcuts, and Tab leaving the editor.
 */
import type { KeyChord } from './keys';
import type { CompareRequest, DiffShown, Side, SideRequest } from '@extension/review-wasm';

export type { KeyChord };
export { chordOf, isMac, sameChord } from './keys';

/** One dropped item, as the page that saw the drop collected it during the event (compare/files.ts). */
export interface DroppedEntry {
  name: string;
  /** null for a folder, or for text dragged from elsewhere. */
  file: File | null;
  /** The file's handle (File System Access) when the browser gave one: Save can write back to it. */
  handle: FileSystemFileHandle | null;
  directory: boolean;
  /** Text dragged from elsewhere (not a file). */
  text: string | null;
}

/** Main page → editor page. */
export type ToViewer =
  | { type: 'viewer/compare'; id: number; request: CompareRequest }
  | { type: 'viewer/set-side'; id: number; request: SideRequest }
  | { type: 'viewer/set-language'; id: number; language: string }
  | { type: 'viewer/swap'; id: number }
  | { type: 'viewer/mark-saved'; id: number; side: Side; text: string }
  | { type: 'viewer/set-editable'; side: Side; editable: boolean; focus: boolean }
  | { type: 'viewer/focus'; side: Side }
  | { type: 'viewer/read'; id: number; side: Side }
  | { type: 'viewer/keys'; keys: KeyChord[] };

/** Editor page → main page. `id` is the request's; an error without one is the editor's own (it could not start). */
export type FromViewer =
  | { type: 'viewer/ready' }
  | { type: 'viewer/shown'; id?: number; shown: DiffShown }
  | { type: 'viewer/error'; id?: number; message: string }
  | { type: 'viewer/text'; id: number; side: Side; text: string }
  | { type: 'viewer/drag' }
  | { type: 'viewer/drop'; side: Side; entries: DroppedEntry[] }
  | { type: 'viewer/key'; chord: KeyChord; side: Side | null }
  | { type: 'viewer/leave'; backwards: boolean };

const isObject = (data: unknown): data is Record<string, unknown> => typeof data === 'object' && data !== null;
const isSide = (value: unknown): value is Side => value === 'old' || value === 'new';
const isId = (value: unknown): value is number => typeof value === 'number';
const isChord = (value: unknown): value is KeyChord =>
  isObject(value) &&
  typeof value.key === 'string' &&
  typeof value.mod === 'boolean' &&
  typeof value.shift === 'boolean';

export const isToViewer = (data: unknown): data is ToViewer => {
  if (!isObject(data)) return false;
  switch (data.type) {
    case 'viewer/compare':
      return (
        isId(data.id) &&
        isObject(data.request) &&
        typeof data.request.oldText === 'string' &&
        typeof data.request.newText === 'string'
      );
    case 'viewer/set-side':
      return (
        isId(data.id) && isObject(data.request) && isSide(data.request.side) && typeof data.request.text === 'string'
      );
    case 'viewer/set-language':
      return isId(data.id) && typeof data.language === 'string';
    case 'viewer/swap':
      return isId(data.id);
    case 'viewer/mark-saved':
      return isId(data.id) && isSide(data.side) && typeof data.text === 'string';
    case 'viewer/set-editable':
      return isSide(data.side) && typeof data.editable === 'boolean' && typeof data.focus === 'boolean';
    case 'viewer/focus':
      return isSide(data.side);
    case 'viewer/read':
      return isId(data.id) && isSide(data.side);
    case 'viewer/keys':
      return Array.isArray(data.keys) && data.keys.every(isChord);
    default:
      return false;
  }
};

export const isFromViewer = (data: unknown): data is FromViewer => {
  if (!isObject(data)) return false;
  switch (data.type) {
    case 'viewer/ready':
    case 'viewer/drag':
      return true;
    case 'viewer/shown':
      return (data.id === undefined || isId(data.id)) && isObject(data.shown);
    case 'viewer/error':
      return typeof data.message === 'string' && (data.id === undefined || isId(data.id));
    case 'viewer/text':
      return isId(data.id) && isSide(data.side) && typeof data.text === 'string';
    case 'viewer/drop':
      return isSide(data.side) && Array.isArray(data.entries);
    case 'viewer/key':
      return isChord(data.chord) && (data.side === null || isSide(data.side));
    case 'viewer/leave':
      return typeof data.backwards === 'boolean';
    default:
      return false;
  }
};
