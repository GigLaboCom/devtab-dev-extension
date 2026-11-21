/**
 * The tool's settings as the form holds them (the number fields as typed) and the history payload read back. An entry
 * comes from storage and maybe from an older or edited file, so it is checked field by field, never trusted.
 */
import {
  CHAR_SETS,
  DEFAULT_CHAR_OPTIONS,
  DEFAULT_WORD_OPTIONS,
  SEPARATORS,
  parseWholeNumber,
} from '@workspace/tool-logic-password';
import type { PasswordPayload } from './history';
import type { CharSet, Separator, Settings } from '@workspace/tool-logic-password';

export type Mode = Settings['mode'];

/** The form: number fields as typed (an empty or a fractional one is an error at the field, §3). */
export interface Fields {
  mode: Mode;
  length: string;
  sets: Record<CharSet, boolean>;
  symbols: string;
  avoidLookAlike: boolean;
  words: string;
  separator: Separator;
  capitalize: boolean;
  count: string;
}

export const DEFAULT_FIELDS: Fields = {
  mode: 'chars',
  length: String(DEFAULT_CHAR_OPTIONS.length),
  sets: { ...DEFAULT_CHAR_OPTIONS.sets },
  symbols: DEFAULT_CHAR_OPTIONS.symbols,
  avoidLookAlike: DEFAULT_CHAR_OPTIONS.avoidLookAlike,
  words: String(DEFAULT_WORD_OPTIONS.words),
  separator: DEFAULT_WORD_OPTIONS.separator,
  capitalize: DEFAULT_WORD_OPTIONS.capitalize,
  count: '1',
};

export const settingsOf = (f: Fields): Settings =>
  f.mode === 'chars'
    ? {
        mode: 'chars',
        chars: {
          length: parseWholeNumber(f.length),
          sets: { ...f.sets },
          symbols: f.symbols,
          avoidLookAlike: f.avoidLookAlike,
        },
        count: parseWholeNumber(f.count),
      }
    : {
        mode: 'words',
        words: { words: parseWholeNumber(f.words), separator: f.separator, capitalize: f.capitalize },
        count: parseWholeNumber(f.count),
      };

/** The form showing `settings`; what they do not name (the other mode's fields) stays as in `base`. */
export const fieldsOf = (settings: Settings, base: Fields): Fields =>
  settings.mode === 'chars'
    ? {
        ...base,
        mode: 'chars',
        length: String(settings.chars.length),
        sets: { ...settings.chars.sets },
        symbols: settings.chars.symbols,
        avoidLookAlike: settings.chars.avoidLookAlike,
        count: String(settings.count),
      }
    : {
        ...base,
        mode: 'words',
        words: String(settings.words.words),
        separator: settings.words.separator,
        capitalize: settings.words.capitalize,
        count: String(settings.count),
      };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isWhole = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** A payload of schema 1, or null when it is not one. */
export const readPayload = (payload: unknown): PasswordPayload | null => {
  if (!isRecord(payload) || !isRecord(payload.settings) || !Array.isArray(payload.values)) return null;
  const values = payload.values;
  if (!values.every((v): v is string => typeof v === 'string')) return null;
  const s = payload.settings;
  if (!isWhole(s.count)) return null;
  if (s.mode === 'chars' && isRecord(s.chars)) {
    const c = s.chars;
    const sets = isRecord(c.sets) ? c.sets : {};
    if (!isWhole(c.length) || typeof c.symbols !== 'string' || !CHAR_SETS.every(k => typeof sets[k] === 'boolean'))
      return null;
    return {
      values,
      settings: {
        mode: 'chars',
        count: s.count,
        chars: {
          length: c.length,
          sets: Object.fromEntries(CHAR_SETS.map(k => [k, sets[k] === true])) as Record<CharSet, boolean>,
          symbols: c.symbols,
          avoidLookAlike: c.avoidLookAlike === true,
        },
      },
    };
  }
  if (s.mode === 'words' && isRecord(s.words)) {
    const w = s.words;
    const separator = SEPARATORS.find(sep => sep === w.separator);
    if (!isWhole(w.words) || separator === undefined) return null;
    return {
      values,
      settings: {
        mode: 'words',
        count: s.count,
        words: { words: w.words, separator, capitalize: w.capitalize === true },
      },
    };
  }
  return null;
};

/** The History list's line for an entry (inside the encryption, like the rest of a secret entry). No password in it. */
export const generatedLabel = (settings: Settings, entropyBits: number): string => {
  const what =
    settings.mode === 'chars'
      ? `${settings.count > 1 ? `${settings.count} passwords` : 'Password'} · ${settings.chars.length} characters`
      : `${settings.count > 1 ? `${settings.count} passphrases` : 'Passphrase'} · ${settings.words.words} words`;
  return `${what} · ${Math.floor(entropyBits)} bits`;
};
