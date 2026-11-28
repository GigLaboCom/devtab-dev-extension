/**
 * Seam `EditorProfilesStore` (D39 stage 2; docs/replaceable-behaviors.md): where the editor's profiles besides Default
 * are kept (./profiles.ts), with the active one and the projects' own. The edition names the implementation
 * (src/edition/edition.ts, `editorProfiles`) — the host follows what it says about itself (`included`), never a question
 * "is this Pro?":
 *
 *   areaEditorProfiles  a record of its own in a storage area — `chrome.storage.local`, key `editorProfiles`, version 1
 *                       from the start (Pro); `memoryEditorProfiles` is the same in the page's memory (tests)
 *   noEditorProfiles    no profiles (free): it never opens the record — no read, no write, no change followed — and
 *                       answers with Default alone, so every editor uses the Default set. A record a Pro build left is
 *                       neither read nor deleted, and a Pro build in the same profile finds it as it was.
 *
 * Every implementation passes the same suite (./profilesContract.ts). A write is normalized first and refused — an
 * answer, never an exception — when the record is longer than `PROFILES_RECORD_MAX_CHARS`, when the browser's storage
 * is full, or (`excluded`) where there are no profiles.
 */
import { PROFILES_RECORD_MAX_CHARS, emptyEditorProfiles, normalizeEditorProfiles } from './profiles';
import { areaRecord, memoryEditorArea } from './storage';
import type { EditorProfilesRecord } from './profiles';
import type { EditorSettingsArea } from './storage';
import type { EditorSettingsRefusal } from './store';

/** chrome.storage.local key of the profiles' record (read only where the edition has profiles). */
export const EDITOR_PROFILES_KEY = 'editorProfiles';

export type EditorProfilesRefusal =
  | EditorSettingsRefusal
  /** This edition keeps no profiles. */
  | { kind: 'excluded' };

export type EditorProfilesResult =
  { ok: true; value: EditorProfilesRecord } | { ok: false; refused: EditorProfilesRefusal };

export interface EditorProfilesStore {
  /** For reports and tests. */
  readonly id: string;
  /**
   * Whether this edition has profiles. `false`: nothing is read or written, the answer is always Default alone, and the
   * places that offer profiles say in one line that they are not part of this version instead.
   */
  readonly included: boolean;
  /** Whether what is saved outlives the page. */
  readonly keeps: boolean;
  /** The stored record, normalized; nothing stored: Default alone. */
  load(): Promise<EditorProfilesRecord>;
  /** Normalizes and keeps the record; the answer is what is stored now, or why nothing was. */
  save(record: EditorProfilesRecord): Promise<EditorProfilesResult>;
  /** Calls `onRecord` with the stored record, then on every change from any page. Returns the unsubscribe. */
  watch(onRecord: (record: EditorProfilesRecord) => void): () => void;
}

const SHAPE = { key: EDITOR_PROFILES_KEY, normalize: normalizeEditorProfiles, maxChars: PROFILES_RECORD_MAX_CHARS };

/** The profiles in a storage area's record `editorProfiles`. */
export const areaEditorProfiles = (
  area: EditorSettingsArea,
  options: { id: string; keeps: boolean } = { id: 'chrome-storage-local', keeps: true },
): EditorProfilesStore => ({
  id: options.id,
  included: true,
  keeps: options.keeps,
  ...areaRecord<EditorProfilesRecord>(SHAPE, area),
});

/** The profiles kept while the page is open (tests, a host without the extension's storage). */
export const memoryEditorProfiles = (area: EditorSettingsArea = memoryEditorArea()): EditorProfilesStore =>
  areaEditorProfiles(area, { id: 'memory', keeps: false });

/** No profiles: nothing is read, written or followed; Default alone. */
export const noEditorProfiles: EditorProfilesStore = {
  id: 'none',
  included: false,
  keeps: false,
  load: () => Promise.resolve(emptyEditorProfiles()),
  save: () => Promise.resolve({ ok: false, refused: { kind: 'excluded' } }),
  watch(onRecord) {
    let live = true;
    queueMicrotask(() => live && onRecord(emptyEditorProfiles()));
    return () => {
      live = false;
    };
  },
};
