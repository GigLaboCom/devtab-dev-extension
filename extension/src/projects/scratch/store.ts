/**
 * Seam `ScratchStore` (D34; docs/replaceable-behaviors.md): where the Projects section keeps its scratch files — files
 * of no project, made, edited and downloaded on the page, with no companion (as IntelliJ's «Scratches and Consoles»).
 * A scratch is a name, a language of the editor (src/compare/languages.ts: the same list as «Compare code», so a
 * language the editor learns is offered here by itself) and a text.
 *
 * The section's composition root (../behaviors.ts) names the implementation: the extension's storage
 * (./storage.ts, `chrome.storage.local`), or the page's memory where there is none (tests, a host without the
 * extension's API). Every implementation passes the same suite (./contract.ts).
 *
 * Limits, modelled on the tools' saved parameters (a default and a bound, a refused write keeps what was stored and
 * says so — never a silent loss): at most `SCRATCH_MAX_COUNT` scratches of at most `SCRATCH_MAX_CHARS` UTF-16 units
 * each. At both bounds all scratches together take at most half of `chrome.storage.local`'s 10 MiB, which leaves the
 * other half to the rest of the extension. Each refusal is an answer (`ScratchRefusal`), not an exception.
 */
import { LANGUAGES, extensionOf, languageOfFile } from '@src/compare/languages';

/** The most scratches kept. */
export const SCRATCH_MAX_COUNT = 20;
/** The longest text of one scratch kept, in UTF-16 units (what the editor and JavaScript count). */
export const SCRATCH_MAX_CHARS = 262_144;
/** The longest name, without the extension. */
export const SCRATCH_NAME_MAX = 100;
/** The name a new scratch starts from (IntelliJ's: `scratch.py`, then `scratch_1.py`, …). */
export const SCRATCH_DEFAULT_NAME = 'scratch';
/** The language offered for the first scratch; later the one the last scratch was made in. */
export const SCRATCH_DEFAULT_LANGUAGE = 'text';

export interface ScratchInfo {
  id: string;
  /** The name without its extension: the extension is always the language's (`fileName`). */
  name: string;
  /** A language id of the editor (`LANGUAGES`). */
  language: string;
  createdMs: number;
  updatedMs: number;
  /** The text's length in UTF-16 units. */
  chars: number;
}

export interface ScratchList {
  /** By name, as a tree lists files. */
  scratches: ScratchInfo[];
  /** The language the last scratch was made in: what «New scratch» offers. */
  lastLanguage: string;
}

/** Why a change was not kept. What was stored before stays as it was. */
export type ScratchRefusal =
  | { kind: 'too-many'; max: number }
  | { kind: 'too-large'; max: number; chars: number }
  /** The browser's storage for the extension is full. */
  | { kind: 'full' }
  /** The scratch is not there any more (deleted in another tab). */
  | { kind: 'missing' }
  | { kind: 'failed'; message: string };

export type ScratchResult<T> = { ok: true; value: T } | { ok: false; refused: ScratchRefusal };

export interface ScratchStore {
  /** For reports and tests. */
  readonly id: string;
  /** Whether the scratches outlive the page (a reload, the browser's restart). */
  readonly keeps: boolean;
  list(): Promise<ScratchList>;
  /** The text, or null when there is no such scratch. */
  read(id: string): Promise<string | null>;
  /** A new empty scratch in a language, named after the ones there are (`newName`). */
  create(language: string): Promise<ScratchResult<ScratchInfo>>;
  /** Keeps the text; one longer than `SCRATCH_MAX_CHARS` is refused and the stored one stays. */
  write(id: string, text: string): Promise<ScratchResult<ScratchInfo>>;
  /** A new name as the person typed it (`parseName`): an extension of a known language changes the language too. */
  rename(id: string, typed: string): Promise<ScratchResult<ScratchInfo>>;
  setLanguage(id: string, language: string): Promise<ScratchResult<ScratchInfo>>;
  remove(id: string): Promise<ScratchResult<null>>;
}

/** A language the editor knows, or plain text. */
export const knownLanguage = (language: unknown): string =>
  typeof language === 'string' && LANGUAGES.some(l => l.id === language) ? language : SCRATCH_DEFAULT_LANGUAGE;

/** The file name a scratch is shown and downloaded under: its name and its language's first extension. */
export const fileName = (scratch: Pick<ScratchInfo, 'name' | 'language'>): string =>
  `${scratch.name}.${extensionOf(scratch.language)}`;

/** The first of `scratch`, `scratch_1`, `scratch_2`, … whose file name in the language is not taken. */
export const newName = (taken: readonly Pick<ScratchInfo, 'name' | 'language'>[], language: string): string => {
  const names = new Set(taken.map(fileName));
  for (let n = 0; ; n++) {
    const name = n === 0 ? SCRATCH_DEFAULT_NAME : `${SCRATCH_DEFAULT_NAME}_${n}`;
    if (!names.has(fileName({ name, language }))) return name;
  }
};

/**
 * A name as the person typed it: what a file name may not hold (path separators, `:*?"<>|`, control characters)
 * becomes `_`, leading and trailing spaces and dots go, at most `SCRATCH_NAME_MAX` characters. An extension of a
 * language the editor knows is taken as that language (IntelliJ renames a scratch's extension to change its language);
 * any other dot stays part of the name. Null when nothing is left.
 */
export const parseName = (typed: string, language: string): { name: string; language: string } | null => {
  const clean = typed
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_')
    .replace(/^[\s.]+|[\s.]+$/g, '');
  if (!clean) return null;
  const typedLanguage = languageOfFile(clean);
  const dot = clean.lastIndexOf('.');
  const name = (typedLanguage && dot > 0 ? clean.slice(0, dot) : clean).replace(/[\s.]+$/, '');
  if (!name) return null;
  return { name: name.slice(0, SCRATCH_NAME_MAX), language: typedLanguage && dot > 0 ? typedLanguage : language };
};

/** A new scratch's id: `s_` and ten random base32 characters (a project's id is `p_` and ten). */
export const scratchId = (random: (bytes: Uint8Array) => Uint8Array = b => crypto.getRandomValues(b)): string => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  return `s_${[...random(new Uint8Array(10))].map(b => alphabet[b % 32]).join('')}`;
};

/** As a file tree sorts: by file name, numbers by their value (`scratch_2` before `scratch_10`). */
export const compareNames = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true });

export const byName = (a: ScratchInfo, b: ScratchInfo): number =>
  compareNames(fileName(a), fileName(b)) || a.createdMs - b.createdMs;
