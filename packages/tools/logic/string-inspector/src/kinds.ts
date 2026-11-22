/**
 * What the tool knows about one code point (docs/tools/specs/string-inspector.md §5.2–§5.5): whether it is invisible
 * and of which kind, its marker, the ASCII character it looks like, its General_Category and its script. Categories
 * and scripts come from the engine's `\p{…}` classes, so they follow the Unicode version of the browser (or of Node in
 * the tests): Chrome 159 knows Unicode 17, Node 22.20 Unicode 16 (spec §15).
 */
import { ABBREVIATIONS } from './markers.generated.ts';

export type InvisibleKind =
  'control' | 'space' | 'format' | 'joiner' | 'bidi' | 'filler' | 'variation' | 'tag' | 'surrogate';

/** `U+` and at least four upper-case hex digits: `U+00E9`, `U+1F44D`. */
export const codePointLabel = (cp: number): string => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;

const parseCompact = (compact: string): Map<number, string> =>
  new Map(
    compact.split(';').map(entry => {
      const at = entry.indexOf(':');
      return [parseInt(entry.slice(0, at), 16), entry.slice(at + 1)];
    }),
  );
const ABBREVIATION = parseCompact(ABBREVIATIONS);

const isLoneSurrogateCode = (cp: number): boolean => cp >= 0xd800 && cp <= 0xdfff;

const CC = /^\p{Cc}$/u;
const OTHER_FORMAT = /^[\p{Cf}\p{Zl}\p{Zp}]$/u;
const ZS = /^\p{Zs}$/u;

/**
 * The kind of §5.3's table, or null for a visible code point — without §5.4's exception for the parts of an emoji
 * (that depends on the grapheme, see `isEmojiPart`). `cp` in U+D800–U+DFFF is a lone surrogate: a paired one is never
 * passed alone.
 */
export const invisibleKindOf = (cp: number): InvisibleKind | null => {
  if (cp < 0x20 || cp === 0x7f || cp === 0x85) return 'control';
  if (cp < 0xa0) return cp >= 0x80 ? 'control' : null;
  switch (cp) {
    case 0x00a0:
    case 0x202f:
    case 0x205f:
    case 0x1680:
    case 0x2028:
    case 0x2029:
    case 0x3000:
      return 'space';
    case 0x00ad:
    case 0x034f:
    case 0x180e:
    case 0x200b:
    case 0x2060:
    case 0xfeff:
    case 0xfffc:
      return 'format';
    case 0x200c:
    case 0x200d:
      return 'joiner';
    case 0x061c:
    case 0x200e:
    case 0x200f:
      return 'bidi';
    case 0x115f:
    case 0x1160:
    case 0x2800:
    case 0x3164:
    case 0xffa0:
      return 'filler';
  }
  if (cp >= 0x2000 && cp <= 0x200a) return 'space';
  if (cp >= 0x2061 && cp <= 0x2064) return 'format';
  if ((cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069)) return 'bidi';
  if ((cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef)) return 'variation';
  if (cp >= 0xe0000 && cp <= 0xe007f) return 'tag';
  if (isLoneSurrogateCode(cp)) return 'surrogate';
  const s = String.fromCodePoint(cp);
  if (CC.test(s)) return 'control';
  if (OTHER_FORMAT.test(s)) return 'format';
  if (ZS.test(s)) return 'space';
  return null;
};

/** ZWJ, VS1–VS16 and the tag characters: inside a grapheme with an emoji they are part of it and not flagged (§5.4). */
export const isEmojiPart = (cp: number): boolean =>
  cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0000 && cp <= 0xe007f);

/** Does this grapheme hold an emoji (`\p{Extended_Pictographic}`, the engine's Unicode data)? */
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
export const hasPictographic = (grapheme: string): boolean => PICTOGRAPHIC.test(grapheme);

/**
 * The marker of an invisible code point (§5.3): its abbreviation in NameAliases.txt (TAB for U+0009, EM for U+0019),
 * VS1–VS256 for the variation selectors, otherwise `U+XXXX`.
 */
export const markerOf = (cp: number): string => {
  const abbreviation = ABBREVIATION.get(cp);
  if (abbreviation !== undefined) return abbreviation;
  if (cp >= 0xfe00 && cp <= 0xfe0f) return `VS${cp - 0xfe00 + 1}`;
  if (cp >= 0xe0100 && cp <= 0xe01ef) return `VS${cp - 0xe0100 + 17}`;
  return codePointLabel(cp);
};

/** The characters of §5.5 that look like ASCII, and the ASCII character each looks like. */
const LOOKALIKE = new Map<number, string>([
  [0x2018, "'"],
  [0x2019, "'"],
  [0x201b, "'"],
  [0x2032, "'"],
  [0x02bc, "'"],
  [0x201c, '"'],
  [0x201d, '"'],
  [0x201f, '"'],
  [0x2033, '"'],
  [0x2010, '-'],
  [0x2011, '-'],
  [0x2012, '-'],
  [0x2013, '-'],
  [0x2014, '-'],
  [0x2015, '-'],
  [0x2212, '-'],
  [0xfe63, '-'],
  [0x037e, ';'],
  [0x2236, ':'],
  [0x2024, '.'],
  [0x2044, '/'],
  [0x2215, '/'],
  [0x2216, '\\'],
  [0x29f5, '\\'],
  [0x2223, '|'],
  [0x01c0, '|'],
  [0x02c6, '^'],
  [0x02c4, '^'],
  [0x02dc, '~'],
  [0x2217, '*'],
]);
/** The same set as one class, for scanning a whole text (inspect.ts). */
export const LOOKALIKE_CLASS =
  '[\u{2018}\u{2019}\u{201B}\u{2032}\u{2BC}\u{201C}\u{201D}\u{201F}\u{2033}\u{2010}-\u{2015}\u{2212}\u{FE63}\u{37E}\u{2236}\u{2024}\u{2044}\u{2215}\u{2216}\u{29F5}\u{2223}\u{1C0}\u{2C6}\u{2C4}\u{2DC}\u{2217}\u{FF01}-\u{FF5E}]';

/** The ASCII character `cp` looks like (§5.5), or null. Full-width U+FF01–U+FF5E: the character 0xFEE0 lower. */
export const lookalikeOf = (cp: number): string | null => {
  if (cp >= 0xff01 && cp <= 0xff5e) return String.fromCharCode(cp - 0xfee0);
  return LOOKALIKE.get(cp) ?? null;
};

/** The 30 General_Category values in the order they are tried (§5.2), with their long names from PropertyValueAliases.txt. */
export const CATEGORIES = [
  ['Lu', 'Uppercase Letter'],
  ['Ll', 'Lowercase Letter'],
  ['Lt', 'Titlecase Letter'],
  ['Lm', 'Modifier Letter'],
  ['Lo', 'Other Letter'],
  ['Mn', 'Nonspacing Mark'],
  ['Mc', 'Spacing Mark'],
  ['Me', 'Enclosing Mark'],
  ['Nd', 'Decimal Number'],
  ['Nl', 'Letter Number'],
  ['No', 'Other Number'],
  ['Pc', 'Connector Punctuation'],
  ['Pd', 'Dash Punctuation'],
  ['Ps', 'Open Punctuation'],
  ['Pe', 'Close Punctuation'],
  ['Pi', 'Initial Punctuation'],
  ['Pf', 'Final Punctuation'],
  ['Po', 'Other Punctuation'],
  ['Sm', 'Math Symbol'],
  ['Sc', 'Currency Symbol'],
  ['Sk', 'Modifier Symbol'],
  ['So', 'Other Symbol'],
  ['Zs', 'Space Separator'],
  ['Zl', 'Line Separator'],
  ['Zp', 'Paragraph Separator'],
  ['Cc', 'Control'],
  ['Cf', 'Format'],
  ['Cs', 'Surrogate'],
  ['Co', 'Private Use'],
  ['Cn', 'Unassigned'],
] as const;
const CATEGORY_NAME = new Map<string, string>(CATEGORIES);
const CATEGORY_TESTS = CATEGORIES.map(([code]) => [code, new RegExp(`^\\p{gc=${code}}$`, 'u')] as const);

/** `Ll` → `Ll Lowercase Letter`; an unknown code comes back as it is. */
export const categoryName = (code: string): string => {
  const name = CATEGORY_NAME.get(code);
  return name === undefined ? code : `${code} ${name}`;
};

/** The two-letter General_Category of one code point (or one lone surrogate), as the engine's Unicode data has it. */
export const categoryOf = (cp: number): string => {
  const s = isLoneSurrogateCode(cp) ? String.fromCharCode(cp) : String.fromCodePoint(cp);
  for (const [code, test] of CATEGORY_TESTS) if (test.test(s)) return code;
  return 'Cn';
};

/**
 * The scripts §5.2 names, in the order they are tried. Short on purpose: a script name newer than the engine would be
 * a SyntaxError in the expression, and the first four are the ones that matter for look-alikes.
 */
export const SCRIPTS = [
  'Latin',
  'Greek',
  'Cyrillic',
  'Armenian',
  'Hebrew',
  'Arabic',
  'Devanagari',
  'Bengali',
  'Thai',
  'Georgian',
  'Hangul',
  'Hiragana',
  'Katakana',
  'Han',
  'Common',
  'Inherited',
] as const;
const SCRIPT_TESTS = SCRIPTS.map(name => [name, new RegExp(`^\\p{Script=${name}}$`, 'u')] as const);

/** The first script of SCRIPTS the code point belongs to, or `Other`. */
export const scriptOf = (cp: number): string => {
  if (isLoneSurrogateCode(cp)) return 'Other';
  const s = String.fromCodePoint(cp);
  for (const [name, test] of SCRIPT_TESTS) if (test.test(s)) return name;
  return 'Other';
};

/** The scripts whose mixing inside one word is warned about (§5.5 item 3), alphabetically. */
export const MIXABLE_SCRIPTS = ['Armenian', 'Cyrillic', 'Greek', 'Latin'] as const;
/** A letter of each: `(?=\p{L})` keeps marks, digits and symbols of the script out. */
export const MIXABLE_TESTS = MIXABLE_SCRIPTS.map(
  name => [name, new RegExp(`(?=\\p{L})\\p{Script=${name}}`, 'u')] as const,
);
