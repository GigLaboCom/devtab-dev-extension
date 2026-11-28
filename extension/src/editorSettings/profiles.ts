/**
 * The editor's profiles as data (D39 stage 2, Pro; docs/research/editor-settings.md §4.3–§4.6): a profile is a name
 * plus a set of the same shape as the Default set (./model.ts) — general values and values by language; never the
 * theme or the shortcuts. Pure: no storage, no DOM (./profilesStore.ts keeps the record).
 *
 * The Default profile is not in this record: it is the `editorSettings` record every edition reads, has the reserved
 * id `default` and the name "Default", and cannot be renamed or deleted. This record — `editorProfiles`, read and
 * written only where the edition says profiles exist — holds the other profiles, which one is active everywhere
 * (`active`) and which a project of the Projects section uses instead (`projects`: project id → profile id). Scratches
 * and «Compare code» use the active one.
 *
 * Stored (version 1): `{version, profiles: [{id, name, base, languages}], active, projects}`. Read back by
 * `normalizeEditorProfiles`: every field of its type and within the limits, the rest dropped; a record of a newer build
 * is read as far as this one understands it. A profile file (export and import, §4.5) is
 * `{format: "devtab-editor-profile", version: 1, profile: {name, base, languages}}` and goes through the same
 * normalization: nothing in it is trusted.
 */
import { LANGUAGES_MAX, normalizeSet } from './model';
import type { EditorSet } from './model';

/** The Default profile's id: the `editorSettings` record. */
export const DEFAULT_PROFILE = 'default';
/** The Default profile's name, reserved for it. */
export const DEFAULT_PROFILE_NAME = 'Default';
/** A stored profile whose name cannot be read is called this (numbered when taken). */
export const UNNAMED_PROFILE = 'Profile';

export const EDITOR_PROFILES_VERSION = 1;
/** Profiles in all, the Default one counted (§4.6). */
export const PROFILES_MAX = 20;
/** The longest name, in characters (code points). */
export const PROFILE_NAME_MAX = 60;
/** Projects with a profile of their own; past it the oldest choice goes (§4.6). */
export const PROJECTS_MAX = 500;
/** The longest record written, as JSON (UTF-16 units). */
export const PROFILES_RECORD_MAX_CHARS = 65_536;
/** The largest profile file read on import, in bytes. */
export const PROFILE_FILE_MAX_BYTES = 65_536;
/** The format name of a profile file. */
export const PROFILE_FILE_FORMAT = 'devtab-editor-profile';

const PROFILE_ID = /^ep_[a-z0-9]{4,32}$/;
// A project's id as the API gives it: short, no control characters (the companion's are `p_` + letters and digits).
const PROJECT_ID = /^[\w.:-]{1,128}$/;
// Control and format characters, line and paragraph separators: never in a name.
const NOT_IN_NAME = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

export interface EditorProfile extends EditorSet {
  /** `ep_` + letters and digits; made here, never taken from a file. */
  id: string;
  name: string;
}

export interface EditorProfilesRecord {
  version: 1;
  /** The profiles besides Default, at most `PROFILES_MAX - 1`, in the order they were made. */
  profiles: EditorProfile[];
  /** The profile in force everywhere a project names none: `default` or a profile's id. */
  active: string;
  /** Project id → the profile it uses (`default` or a profile's id); a project not here uses `active`. */
  projects: Record<string, string>;
}

/** No profiles but Default: what a fresh browser has, and what an edition without profiles always answers. */
export const emptyEditorProfiles = (): EditorProfilesRecord => ({
  version: 1,
  profiles: [],
  active: DEFAULT_PROFILE,
  projects: {},
});

const isRecord = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw);

const length = (text: string): number => [...text].length;

/** A name cleaned: trimmed, runs of white space one space. */
export const cleanName = (raw: string): string => raw.replace(/\s+/gu, ' ').trim();

/** Why a name cannot be a profile's; null when it can. `taken` is every other profile's name, Default's included. */
export type NameProblem = 'empty' | 'too-long' | 'characters' | 'taken';

export const nameProblem = (raw: string, taken: readonly string[]): NameProblem | null => {
  const name = cleanName(raw);
  if (!name) return 'empty';
  if (length(name) > PROFILE_NAME_MAX) return 'too-long';
  if (NOT_IN_NAME.test(name)) return 'characters';
  const lower = name.toLocaleLowerCase();
  if (taken.some(other => other.toLocaleLowerCase() === lower)) return 'taken';
  return null;
};

/** `name`, or "name (2)", "name (3)", … — the first not taken; cut so it stays within the limit. */
export const uniqueName = (raw: string, taken: readonly string[]): string => {
  const lower = new Set(taken.map(t => t.toLocaleLowerCase()));
  const fit = (base: string, suffix: string): string => {
    const room = PROFILE_NAME_MAX - length(suffix);
    return [...base].slice(0, room).join('').trimEnd() + suffix;
  };
  const base = fit(cleanName(raw), '');
  if (!lower.has(base.toLocaleLowerCase())) return base;
  for (let n = 2; ; n += 1) {
    const candidate = fit(base, ` (${n})`);
    if (!lower.has(candidate.toLocaleLowerCase())) return candidate;
  }
};

/** A name read from storage or a file: cleaned, its characters allowed, within the limit; `fallback` otherwise. */
const readName = (raw: unknown, fallback: string): string => {
  if (typeof raw !== 'string') return fallback;
  const name = [...cleanName(raw).replace(new RegExp(NOT_IN_NAME.source, 'gu'), '')]
    .slice(0, PROFILE_NAME_MAX)
    .join('');
  return cleanName(name) || fallback;
};

/** A new profile id: `ep_` and ten letters or digits. */
export const newProfileId = (
  random: (n: number) => Uint8Array = n => crypto.getRandomValues(new Uint8Array(n)),
): string => `ep_${[...random(10)].map(b => (b % 36).toString(36)).join('')}`;

/** Version → 1. Version 1 is the first; a newer record is read as far as this build understands it. */
export const migrateEditorProfiles = (raw: unknown): Record<string, unknown> | null => (isRecord(raw) ? raw : null);

/** The stored record as this build reads it: profiles with a valid id, names unique, choices that name a profile. */
export const normalizeEditorProfiles = (raw: unknown): EditorProfilesRecord => {
  const source = migrateEditorProfiles(raw);
  if (!source) return emptyEditorProfiles();
  const profiles: EditorProfile[] = [];
  const ids = new Set<string>();
  const names = [DEFAULT_PROFILE_NAME];
  for (const item of Array.isArray(source.profiles) ? source.profiles : []) {
    if (profiles.length >= PROFILES_MAX - 1) break;
    if (!isRecord(item) || typeof item.id !== 'string' || !PROFILE_ID.test(item.id) || ids.has(item.id)) continue;
    const name = uniqueName(readName(item.name, UNNAMED_PROFILE), names);
    ids.add(item.id);
    names.push(name);
    profiles.push({ id: item.id, name, ...normalizeSet(item) });
  }
  const known = (id: unknown): id is string => id === DEFAULT_PROFILE || (typeof id === 'string' && ids.has(id));
  const projects = Object.entries(isRecord(source.projects) ? source.projects : {})
    .filter(([project, profile]) => PROJECT_ID.test(project) && known(profile))
    .slice(-PROJECTS_MAX) as Array<[string, string]>;
  return {
    version: 1,
    profiles,
    active: known(source.active) ? source.active : DEFAULT_PROFILE,
    projects: Object.fromEntries(projects),
  };
};

/** Every profile's name, Default's first. */
export const profileNames = (record: EditorProfilesRecord, except?: string): string[] => [
  ...(except === DEFAULT_PROFILE ? [] : [DEFAULT_PROFILE_NAME]),
  ...record.profiles.filter(p => p.id !== except).map(p => p.name),
];

/** The profile a place uses: the project's own when it names one, else the active one. */
export const profileFor = (record: EditorProfilesRecord, project?: string): string => {
  const own = project === undefined ? undefined : record.projects[project];
  const id = own ?? record.active;
  return id === DEFAULT_PROFILE || record.profiles.some(p => p.id === id) ? id : DEFAULT_PROFILE;
};

/** A profile's name; Default's for `default` or an id no profile has. */
export const nameOf = (record: EditorProfilesRecord, id: string): string =>
  record.profiles.find(p => p.id === id)?.name ?? DEFAULT_PROFILE_NAME;

/** What a change to the record answers: the new record, or why it was not made. */
export type ProfileChange =
  | { ok: true; record: EditorProfilesRecord; id: string }
  | { ok: false; problem: NameProblem | 'full' | 'not-found' | 'default' };

const copySet = (set: EditorSet): EditorSet => ({
  base: { ...set.base },
  languages: Object.fromEntries(Object.entries(set.languages).map(([id, values]) => [id, { ...values }])),
});

/** A new profile named `name`, a copy of `from` (the set in force), made the active one. */
export const createProfile = (
  record: EditorProfilesRecord,
  name: string,
  from: EditorSet,
  id: string = newProfileId(),
): ProfileChange => {
  if (record.profiles.length >= PROFILES_MAX - 1) return { ok: false, problem: 'full' };
  const problem = nameProblem(name, profileNames(record));
  if (problem) return { ok: false, problem };
  const profile: EditorProfile = { id, name: cleanName(name), ...copySet(from) };
  return { ok: true, id, record: { ...record, profiles: [...record.profiles, profile], active: id } };
};

/** A copy of a profile (`set`: its values) under "name (2)"; the active profile stays. */
export const duplicateProfile = (
  record: EditorProfilesRecord,
  source: string,
  set: EditorSet,
  id: string = newProfileId(),
): ProfileChange => {
  if (record.profiles.length >= PROFILES_MAX - 1) return { ok: false, problem: 'full' };
  const name = uniqueName(nameOf(record, source), profileNames(record));
  return { ok: true, id, record: { ...record, profiles: [...record.profiles, { id, name, ...copySet(set) }] } };
};

export const renameProfile = (record: EditorProfilesRecord, id: string, name: string): ProfileChange => {
  if (id === DEFAULT_PROFILE) return { ok: false, problem: 'default' };
  if (!record.profiles.some(p => p.id === id)) return { ok: false, problem: 'not-found' };
  const problem = nameProblem(name, profileNames(record, id));
  if (problem) return { ok: false, problem };
  return {
    ok: true,
    id,
    record: { ...record, profiles: record.profiles.map(p => (p.id === id ? { ...p, name: cleanName(name) } : p)) },
  };
};

/** Deletes a profile: the places that used it go back to Default (the active one) or to the active one (a project). */
export const deleteProfile = (record: EditorProfilesRecord, id: string): ProfileChange => {
  if (id === DEFAULT_PROFILE) return { ok: false, problem: 'default' };
  if (!record.profiles.some(p => p.id === id)) return { ok: false, problem: 'not-found' };
  return {
    ok: true,
    id,
    record: {
      ...record,
      profiles: record.profiles.filter(p => p.id !== id),
      active: record.active === id ? DEFAULT_PROFILE : record.active,
      projects: Object.fromEntries(Object.entries(record.projects).filter(([, profile]) => profile !== id)),
    },
  };
};

/** The profile in force everywhere a project names none. */
export const chooseActive = (record: EditorProfilesRecord, id: string): EditorProfilesRecord =>
  id === DEFAULT_PROFILE || record.profiles.some(p => p.id === id) ? { ...record, active: id } : record;

/** A project's own profile; null: the active one. The newest choice goes last, so the oldest is the first to go. */
export const chooseForProject = (
  record: EditorProfilesRecord,
  project: string,
  id: string | null,
): EditorProfilesRecord => {
  const projects = { ...record.projects };
  delete projects[project];
  if (id !== null && (id === DEFAULT_PROFILE || record.profiles.some(p => p.id === id))) projects[project] = id;
  const kept = Object.entries(projects).slice(-PROJECTS_MAX);
  return { ...record, projects: Object.fromEntries(kept) };
};

/** A profile's values replaced (not Default's: that one is the `editorSettings` record). */
export const withProfileSet = (record: EditorProfilesRecord, id: string, set: EditorSet): EditorProfilesRecord => ({
  ...record,
  profiles: record.profiles.map(p => (p.id === id ? { ...p, ...copySet(set) } : p)),
});

// ---- export and import (§4.5) -------------------------------------------------------------------------------------

/** What a profile file holds once read: a name and a set, normalized. */
export interface ProfileFile extends EditorSet {
  name: string;
}

/** The text of a profile file for `name` and `set`. */
export const profileFileText = (name: string, set: EditorSet): string =>
  `${JSON.stringify(
    { format: PROFILE_FILE_FORMAT, version: EDITOR_PROFILES_VERSION, profile: { name, ...copySet(set) } },
    null,
    2,
  )}\n`;

/** A file name for an exported profile: its name in lower-case letters, digits and dashes. */
export const profileFileName = (name: string): string => {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `${slug || 'profile'}.editor-profile.json`;
};

export type ImportProblem =
  /** Larger than `PROFILE_FILE_MAX_BYTES`. */
  | 'too-large'
  /** Not JSON at all. */
  | 'not-json'
  /** JSON, but not a profile file of this format. */
  | 'not-a-profile';

/**
 * Reads a profile file's text. Nothing in it is trusted: the format must say what it is, the version must be a whole
 * number from 1 (a newer one is read as far as this build understands it), and the profile is normalized as stored
 * data is — a field that cannot be read takes its default, a language row past `LANGUAGES_MAX` or with an unknown
 * shape is dropped, every other field is left out; a name that cannot be read is `fallbackName`.
 */
export const readProfileFile = (
  text: string,
  fallbackName: string,
): { ok: true; profile: ProfileFile } | { ok: false; problem: ImportProblem } => {
  if (text.length > PROFILE_FILE_MAX_BYTES || new TextEncoder().encode(text).length > PROFILE_FILE_MAX_BYTES)
    return { ok: false, problem: 'too-large' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, problem: 'not-json' };
  }
  if (
    !isRecord(raw) ||
    raw.format !== PROFILE_FILE_FORMAT ||
    typeof raw.version !== 'number' ||
    !Number.isInteger(raw.version) ||
    raw.version < 1 ||
    !isRecord(raw.profile)
  )
    return { ok: false, problem: 'not-a-profile' };
  const set = normalizeSet(raw.profile);
  return {
    ok: true,
    profile: {
      name: readName(raw.profile.name, fallbackName),
      base: set.base,
      languages: Object.fromEntries(Object.entries(set.languages).slice(0, LANGUAGES_MAX)),
    },
  };
};

/** Adds an imported profile under its name, or "name (2)" when taken; the active profile stays. */
export const importProfile = (
  record: EditorProfilesRecord,
  file: ProfileFile,
  id: string = newProfileId(),
): ProfileChange => {
  if (record.profiles.length >= PROFILES_MAX - 1) return { ok: false, problem: 'full' };
  const name = uniqueName(file.name, profileNames(record));
  return {
    ok: true,
    id,
    record: {
      ...record,
      profiles: [...record.profiles, { id, name, base: { ...file.base }, languages: file.languages }],
    },
  };
};
