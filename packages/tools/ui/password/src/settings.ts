/**
 * What the Password Generator remembers between uses (D21; docs/tools/settings.md): how passwords are made — the mode,
 * the length, the character sets and the symbols to use, look-alikes, the words, their separator and capitals, how
 * many. Never a password (the history keeps them only encrypted, D17). The symbols to use are the person's own list of
 * allowed punctuation (a site's rule), not a secret: saved, as the presets are.
 *
 * Numbers are saved only when the field holds a valid one (a length being typed is not saved), and the symbols only
 * when the field is valid; a saved record with every set off — a state the page never shows — opens with the sets'
 * defaults (`fieldsFromSaved`).
 */
import { DEFAULT_FIELDS } from './payload';
import { CHAR_SETS, DEFAULT_CHAR_OPTIONS, DEFAULT_SYMBOLS, LIMITS, SEPARATORS } from '@workspace/tool-logic-password';
import { declareSettings, setting } from '@workspace/tools-host';
import type { Fields } from './payload';
import type { SettingsValues } from '@workspace/tools-host';

const sets = DEFAULT_CHAR_OPTIONS.sets;

export const passwordSettings = declareSettings({
  schema: 1,
  fields: {
    mode: setting.oneOf(['chars', 'words'], 'chars'),
    length: setting.integer(LIMITS.length, DEFAULT_CHAR_OPTIONS.length),
    setsUpper: setting.boolean(sets.upper),
    setsLower: setting.boolean(sets.lower),
    setsDigits: setting.boolean(sets.digits),
    setsSymbols: setting.boolean(sets.symbols),
    symbols: setting.text(
      { maxLength: 128, test: s => s !== '' && [...s].every(c => DEFAULT_SYMBOLS.includes(c)) },
      DEFAULT_CHAR_OPTIONS.symbols,
    ),
    avoidLookAlike: setting.boolean(DEFAULT_CHAR_OPTIONS.avoidLookAlike),
    words: setting.integer(LIMITS.words, Number(DEFAULT_FIELDS.words)),
    separator: setting.oneOf(SEPARATORS, DEFAULT_FIELDS.separator),
    capitalize: setting.boolean(DEFAULT_FIELDS.capitalize),
    count: setting.integer(LIMITS.count, Number(DEFAULT_FIELDS.count)),
  },
});

export type PasswordSettings = SettingsValues<typeof passwordSettings>;

/** The form the saved values show; every set off (never shown by the page) is the sets' defaults. */
export const fieldsFromSaved = (v: PasswordSettings): Fields => {
  const chosen = { upper: v.setsUpper, lower: v.setsLower, digits: v.setsDigits, symbols: v.setsSymbols };
  return {
    mode: v.mode,
    length: String(v.length),
    sets: CHAR_SETS.some(set => chosen[set]) ? chosen : { ...sets },
    symbols: v.symbols,
    avoidLookAlike: v.avoidLookAlike,
    words: String(v.words),
    separator: v.separator,
    capitalize: v.capitalize,
    count: String(v.count),
  };
};

/** What of a change of the form is saved: each field as its saved value (one that fails its check is not saved). */
export const savedOf = (change: Partial<Fields>): Partial<PasswordSettings> => {
  const whole = (text: string): number => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : NaN);
  return {
    ...(change.mode !== undefined && { mode: change.mode }),
    ...(change.length !== undefined && { length: whole(change.length) }),
    ...(change.sets !== undefined && {
      setsUpper: change.sets.upper,
      setsLower: change.sets.lower,
      setsDigits: change.sets.digits,
      setsSymbols: change.sets.symbols,
    }),
    ...(change.symbols !== undefined && { symbols: change.symbols }),
    ...(change.avoidLookAlike !== undefined && { avoidLookAlike: change.avoidLookAlike }),
    ...(change.words !== undefined && { words: whole(change.words) }),
    ...(change.separator !== undefined && { separator: change.separator }),
    ...(change.capitalize !== undefined && { capitalize: change.capitalize }),
    ...(change.count !== undefined && { count: whole(change.count) }),
  };
};
