/**
 * Names (docs/tools/specs/json-to-code.md §5 «Имена»): the words of a key, type names in PascalCase (and Go's form with
 * its initialisms), field names per language, the singular of an array's key, and string literals that a key cannot
 * break out of in any of the four languages.
 */

const isUpper = (c: string | undefined): boolean => c !== undefined && c >= 'A' && c <= 'Z';
const isLower = (c: string | undefined): boolean => c !== undefined && c >= 'a' && c <= 'z';
const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';

/** A word of a key; `digits`: it starts where a digit follows a letter in the key (`v2` → `v`, `2`). */
interface Piece {
  word: string;
  digits: boolean;
}

const pieces = (key: string): Piece[] => {
  const out: Piece[] = [];
  for (const run of key.split(/[^A-Za-z0-9]+/)) {
    let start = 0;
    let digits = false;
    for (let i = 1; i < run.length; i++) {
      const [prev, c, next] = [run[i - 1], run[i], run[i + 1]];
      const letterDigit = !isDigit(prev) && isDigit(c);
      if ((isLower(prev) && isUpper(c)) || (isUpper(prev) && isUpper(c) && isLower(next)) || letterDigit) {
        out.push({ word: run.slice(start, i), digits });
        [start, digits] = [i, letterDigit];
      }
    }
    if (run) out.push({ word: run.slice(start), digits });
  }
  return out;
};

/**
 * The ASCII words of a key (§5 «Имена» п. 1): any character outside [A-Za-z0-9] separates; a word also ends before an
 * upper-case letter that follows a lower-case one (`userId`), before the last capital of an abbreviation followed by a
 * lower-case letter (`HTTPServer`), and before a digit that follows a letter (`v2`). Non-ASCII characters only separate.
 */
export const keyWords = (key: string): string[] => pieces(key).map(p => p.word);

/**
 * The words of an array's element (§5 «Имена» п. 3): the last word in the singular, or `Item` added. `zes` loses only
 * its `s` unless it is `zzes` (`sizes` → `size`, `quizzes` → `quizz`): the specification's «`zes` → без `es`» made
 * `siz` of `sizes` (§15).
 */
export const singularWords = (words: string[]): string[] => {
  const head = words.slice(0, -1);
  const last = words[words.length - 1] ?? '';
  const lower = last.toLowerCase();
  if (lower.endsWith('ies') && lower.length > 3) return [...head, `${last.slice(0, -3)}y`];
  if (/(?:sses|xes|ches|shes|zzes)$/.test(lower)) return [...head, last.slice(0, -2)];
  if (/(?:ss|us|is)$/.test(lower)) return [...words, 'item'];
  if (lower.endsWith('s') && lower.length > 1) return [...head, last.slice(0, -1)];
  return [...words, 'item'];
};

const capital = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

/** Go's initialisms (§5 «Go» п. 2), written in capitals whole. */
const INITIALISMS = new Set(
  'ACL API ASCII CPU CSS DNS EOF GUID HTML HTTP HTTPS ID IP JSON LHS QPS RAM RHS RPC SLA SMTP SQL SSH TCP TLS TTL UDP UI UID UUID URI URL UTF8 VM XML XMPP XSRF XSS'.split(
    ' ',
  ),
);

/** Words in Go's style: initialisms in capitals (`UTF` + `8` too), the rest capitalised. */
const goWords = (words: string[]): string => {
  let out = '';
  for (let i = 0; i < words.length; i++) {
    const upper = words[i]!.toUpperCase();
    const joined = upper + (words[i + 1] ?? '');
    if (isDigit(words[i + 1]?.[0]) && INITIALISMS.has(joined)) {
      out += joined;
      i++;
    } else out += INITIALISMS.has(upper) ? upper : capital(words[i]!);
  }
  return out;
};

/** A type name from words, and its Go form; a name that would start with a digit gets `Type` in front (§15). */
export const typeNames = (words: string[]): { name: string; go: string } => {
  const name = words.map(capital).join('');
  const go = goWords(words);
  return /^[0-9]/.test(name) ? { name: `Type${name}`, go: `Type${go}` } : { name, go };
};

/**
 * Names that would hide a built-in of one of the languages (§5 «Имена» п. 7) — one set for all, so the names do not
 * change with the language. `Serialize` and `Deserialize` are added (§15): a struct of that name collides with the
 * `use serde::{Deserialize, Serialize};` of the Rust output.
 */
export const RESERVED: readonly string[] = [
  'Any',
  'Array',
  'Box',
  'Date',
  'Deserialize',
  'Err',
  'Error',
  'False',
  'HashMap',
  'Map',
  'None',
  'NotRequired',
  'Number',
  'Object',
  'Ok',
  'Option',
  'Promise',
  'Record',
  'Result',
  'Self',
  'Serialize',
  'Set',
  'Some',
  'String',
  'True',
  'TypedDict',
  'Value',
  'Vec',
];

/**
 * Names in one scope: `name`, `name2`, `name3`… (Go) or `name_2`… (Rust) — the first one not held yet, which it then
 * holds. A name once held stays held, so each base resumes where its last search stopped: linear in the scope.
 */
export const namer = (joint: (base: string) => string = () => '') => {
  const taken = new Set<string>();
  const next = new Map<string, number>();
  return (base: string): string => {
    let n = next.get(base) ?? 1;
    let name = n === 1 ? base : `${base}${joint(base)}${n}`;
    while (taken.has(name)) name = `${base}${joint(base)}${++n}`;
    next.set(base, n + 1);
    taken.add(name);
    return name;
  };
};

/** A Go field's name before numbering (§5 «Go» п. 2). */
export const goFieldName = (key: string): string => {
  const name = goWords(keyWords(key));
  return name === '' ? 'Field' : /^[0-9]/.test(name) ? `Field${name}` : name;
};

const RUST_KEYWORDS = new Set(
  'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while abstract become box do final macro override priv try typeof unsized virtual yield gen'.split(
    ' ',
  ),
);
/** Keywords that cannot be raw identifiers: `_` is added instead. */
const RUST_NOT_RAW = new Set(['self', 'Self', 'super', 'crate']);

/**
 * A Rust field's name before numbering, without `r#` (§5 «Rust» п. 2). Digits that follow a letter in the key stay
 * joined to it, as Rust's own snake case writes them (`sha256`, `max_i64`, not `sha_256`) — §15.
 */
export const rustFieldName = (key: string): string => {
  const name = pieces(key)
    .map((p, i) => (i > 0 && !p.digits ? '_' : '') + p.word.toLowerCase())
    .join('');
  return name === '' ? 'field' : /^[0-9]/.test(name) ? `field_${name}` : RUST_NOT_RAW.has(name) ? `${name}_` : name;
};

/** The identifier to write: a keyword as a raw identifier (`r#type`). */
export const rustIdentifier = (name: string): string => (RUST_KEYWORDS.has(name) ? `r#${name}` : name);

const PYTHON_KEYWORDS = new Set(
  'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield'.split(
    ' ',
  ),
);

/**
 * Can a key be a field of the class form of a TypedDict (§5 «Python» п. 2): an ASCII identifier, not a keyword, and not
 * a name that a class body mangles (`__secret` would become `_Root__secret`; `__proto__` is not mangled) — §15.
 */
export const isPythonField = (key: string): boolean =>
  /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && !PYTHON_KEYWORDS.has(key) && !(key.startsWith('__') && !key.endsWith('__'));

/** Unquoted TypeScript property name (§5 «TypeScript» п. 2). */
export const isTsIdentifier = (key: string): boolean => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key);

/**
 * How a string literal of a language writes one code point that must not stand as itself: a quote, a backslash, a
 * control or format character (bidirectional controls among them — rustc refuses those in a literal), a line or
 * paragraph separator, or half of a surrogate pair (which Go and Rust cannot hold: written as U+FFFD there).
 */
type Escape = (code: number) => string;
const hex = (code: number, width: number): string => code.toString(16).toUpperCase().padStart(width, '0');
const SHORT: Record<number, string> = { 0x22: '\\"', 0x5c: '\\\\', 0x0a: '\\n', 0x0d: '\\r', 0x09: '\\t' };
const cStyle =
  (big: (code: number) => string, surrogate: boolean): Escape =>
  code =>
    SHORT[code] ??
    (code >= 0xd800 && code <= 0xdfff && !surrogate ? '\\uFFFD' : code > 0xffff ? big(code) : `\\u${hex(code, 4)}`);

const ESCAPES = {
  /** TypeScript: `\uXXXX`, `\u{XXXXX}`, a lone surrogate as itself escaped. */
  typescript: cStyle(code => `\\u{${hex(code, 1)}}`, true),
  python: cStyle(code => `\\U${hex(code, 8)}`, true),
  go: cStyle(code => `\\U${hex(code, 8)}`, false),
  rust: (code: number): string => SHORT[code] ?? `\\u{${code >= 0xd800 && code <= 0xdfff ? 'FFFD' : hex(code, 1)}}`,
} satisfies Record<string, Escape>;

const UNSAFE = /["\\\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/gu;

/** A double-quoted string literal of the language holding `text` exactly (Go and Rust: lone surrogates as U+FFFD). */
export const quote = (text: string, language: keyof typeof ESCAPES): string =>
  `"${text.replace(UNSAFE, c => ESCAPES[language](c.codePointAt(0)!))}"`;
