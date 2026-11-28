/**
 * Seam `EditorSettingsStore` (D39; docs/replaceable-behaviors.md): where the Default set of the editor's settings is
 * kept (./model.ts). The composition root (./behaviors.ts) names the implementation: the extension's storage
 * (./storage.ts, `chrome.storage.local`, record `editorSettings`), or the page's memory where there is none (tests, a
 * host without the extension's API). Every implementation passes the same suite (./contract.ts).
 *
 * A write is normalized first and refused — as an answer, never an exception — when it is longer than
 * `RECORD_MAX_CHARS` or the browser's storage is full; what was stored stays. `watch` follows a change made on any page
 * of ours (another tab's Settings included), so every open editor gets the new values without a reload.
 *
 * Other profiles (stage 2, Pro) are another record and another seam (`EditorProfilesStore`, named by the edition);
 * this one keeps the Default set only, which every edition reads.
 */
import type { EditorSettingsRecord } from './model';

export type EditorSettingsRefusal =
  | { kind: 'too-large'; max: number; chars: number }
  /** The browser's storage for the extension is full. */
  | { kind: 'full' }
  | { kind: 'failed'; message: string };

export type EditorSettingsResult =
  { ok: true; value: EditorSettingsRecord } | { ok: false; refused: EditorSettingsRefusal };

export interface EditorSettingsStore {
  /** For reports and tests. */
  readonly id: string;
  /** Whether what is saved outlives the page. */
  readonly keeps: boolean;
  /** The stored set, normalized; nothing stored: the Default set as it starts. */
  load(): Promise<EditorSettingsRecord>;
  /** Normalizes and keeps the set; the answer is what is stored now, or why nothing was. */
  save(record: EditorSettingsRecord): Promise<EditorSettingsResult>;
  /** Calls `onRecord` with the stored set, then on every change from any page. Returns the unsubscribe. */
  watch(onRecord: (record: EditorSettingsRecord) => void): () => void;
}
