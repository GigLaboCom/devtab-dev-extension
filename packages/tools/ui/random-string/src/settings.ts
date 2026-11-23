/**
 * What Random String remembers between uses (D21; docs/tools/settings.md): how strings are made — the mode, the
 * alphabet and a custom alphabet (a setting of the same kind as the presets: the strings are the secret, not the
 * characters they are drawn from), the length, the bytes and their encoding, how many. Never a generated string or its
 * bytes (the history keeps them only encrypted, D17).
 *
 * The mode, the alphabet and the encoding are saved as chosen. The custom alphabet and the numbers are saved only as a
 * whole the tool accepts — each field valid and length (or bytes) × how many within the limit — so a number being typed
 * or an alphabet half typed is not saved (`savedOf`). A custom alphabet is saved up to CUSTOM_JSON_MAX characters as
 * JSON, so the tool's record always fits the host's bound (SAVED_PARAMETERS_MAX_CHARS, 4,096); a longer one works on the
 * page and is not saved.
 */
import { DEFAULT_FIELDS } from './entries';
import {
  DEFAULTS,
  ENCODING_ORDER,
  LIMITS,
  PRESET_ORDER,
  parseAlphabet,
  parseWholeNumber,
} from '@workspace/tool-logic-random-string';
import { declareSettings, setting } from '@workspace/tools-host';
import type { Fields } from './entries';
import type { SettingsValues } from '@workspace/tools-host';

/** The longest custom alphabet saved, as JSON characters (with its quotes); every other field together takes under 200. */
export const CUSTOM_JSON_MAX = 2050;

export const randomStringSettings = declareSettings({
  schema: 1,
  fields: {
    mode: setting.oneOf(['chars', 'bytes'], DEFAULTS.mode),
    preset: setting.oneOf(PRESET_ORDER, DEFAULTS.preset),
    custom: setting.text(
      {
        maxLength: CUSTOM_JSON_MAX,
        test: s => JSON.stringify(s).length <= CUSTOM_JSON_MAX && (s === '' || parseAlphabet(s).ok),
      },
      DEFAULTS.custom,
    ),
    length: setting.integer({ min: 1, max: LIMITS.length }, DEFAULTS.length),
    bytes: setting.integer({ min: 1, max: LIMITS.bytes }, DEFAULTS.bytes),
    encoding: setting.oneOf(ENCODING_ORDER, DEFAULTS.encoding),
    count: setting.integer({ min: 1, max: LIMITS.count }, DEFAULTS.count),
  },
});

export type RandomStringSettings = SettingsValues<typeof randomStringSettings>;

/** The form the saved values show. */
export const fieldsFromSaved = (v: RandomStringSettings): Fields => ({
  ...DEFAULT_FIELDS,
  mode: v.mode,
  preset: v.preset,
  custom: v.custom,
  length: String(v.length),
  bytes: String(v.bytes),
  encoding: v.encoding,
  count: String(v.count),
});

/** The saved values of these fields of the form, numbers parsed (one that fails its field's check is not saved). */
export const savedOf = (f: Fields, keys: Iterable<keyof Fields>): Partial<RandomStringSettings> => {
  const all: RandomStringSettings = {
    mode: f.mode,
    preset: f.preset,
    custom: f.custom,
    length: parseWholeNumber(f.length),
    bytes: parseWholeNumber(f.bytes),
    encoding: f.encoding,
    count: parseWholeNumber(f.count),
  };
  return Object.fromEntries([...keys].map(key => [key, all[key]]));
};
