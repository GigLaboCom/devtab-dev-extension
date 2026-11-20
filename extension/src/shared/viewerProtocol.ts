/**
 * Messages between the main page and the editor page in its iframe (same origin: the extension's). The main page sends
 * two texts; the editor page's module compares and shows them and answers with what it showed. Every request carries
 * an id that comes back with its result, so the main page can take only the answer to its latest request. The theme
 * does not travel here — both pages follow chrome.storage themselves (D9).
 */
import type { CompareRequest, DiffShown } from '@extension/review-wasm';

/** Main page → editor page. */
export type ToViewer = { type: 'viewer/compare'; id: number; request: CompareRequest };

/** Editor page → main page. `id` is the request's; an error without one is the editor's own (it could not start). */
export type FromViewer =
  | { type: 'viewer/ready' }
  | { type: 'viewer/shown'; id: number; shown: DiffShown }
  | { type: 'viewer/error'; id?: number; message: string };

const isObject = (data: unknown): data is Record<string, unknown> => typeof data === 'object' && data !== null;

export const isToViewer = (data: unknown): data is ToViewer =>
  isObject(data) &&
  data.type === 'viewer/compare' &&
  typeof data.id === 'number' &&
  isObject(data.request) &&
  typeof data.request.oldText === 'string' &&
  typeof data.request.newText === 'string';

export const isFromViewer = (data: unknown): data is FromViewer =>
  isObject(data) &&
  (data.type === 'viewer/ready' ||
    (data.type === 'viewer/shown' && typeof data.id === 'number' && isObject(data.shown)) ||
    (data.type === 'viewer/error' &&
      typeof data.message === 'string' &&
      (data.id === undefined || typeof data.id === 'number')));
