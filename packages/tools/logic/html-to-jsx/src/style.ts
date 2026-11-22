/**
 * The `style` attribute as a React style object (docs/tools/specs/html-to-jsx.md §5 «Стиль»). Its own small reader of
 * CSS declarations: the browser's CSSOM is never touched (reading `element.style` would apply nothing, but a page's
 * policy reports a parsed `style` attribute as a violation), and the text is read as written, not normalised.
 */
import { UNITLESS_STYLES } from './tables.ts';
import { canonicalNumber, jsString } from './text.ts';

/**
 * Splits at `;` outside quotes, parentheses and comments (`url('a;b.png')` is one value) and drops comments outside
 * quotes and parentheses (inside `url(…)` without quotes a `/*` is a part of the address).
 */
const declarations = (style: string): string[] => {
  const out: string[] = [];
  let current = '';
  let depth = 0;
  for (let i = 0; i < style.length; i++) {
    const c = style[i]!;
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < style.length && style[j] !== c) j += style[j] === '\\' ? 2 : 1;
      current += style.slice(i, j + 1);
      i = j;
    } else if (c === '/' && style[i + 1] === '*' && depth === 0) {
      const end = style.indexOf('*/', i + 2);
      i = end === -1 ? style.length : end + 1;
      current += ' ';
    } else if (c === '\\') {
      current += style.slice(i, i + 2);
      i++;
    } else if (c === '(') {
      depth++;
      current += c;
    } else if (c === ')') {
      depth = Math.max(0, depth - 1);
      current += c;
    } else if (c === ';' && depth === 0) {
      out.push(current);
      current = '';
    } else current += c;
  }
  out.push(current);
  return out;
};

const isSpace = (c: string | undefined): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';

/** The value without a trailing `!important` (any case, spaces allowed around `!`), or null when it has none. */
const withoutImportant = (value: string): string | null => {
  if (value.slice(-'important'.length).toLowerCase() !== 'important') return null;
  let i = value.length - 'important'.length;
  while (isSpace(value[i - 1])) i--;
  if (value[i - 1] !== '!') return null;
  i--;
  while (isSpace(value[i - 1])) i--;
  return value.slice(0, i);
};

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** `margin-top` → `marginTop`, `-webkit-line-clamp` → `WebkitLineClamp`, `-ms-flex` → `msFlex` (as React writes them). */
export const styleKey = (name: string): string => {
  if (name.startsWith('--')) return name;
  const lower = name.toLowerCase();
  const unprefixed = lower.startsWith('-ms-') ? lower.slice(1) : lower;
  return unprefixed.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
};

/**
 * The object literal for a `style` value — `{ color: 'red', marginTop: '4px' }` — or null when nothing is left (an
 * empty value, or only declarations that cannot be read: no `:`, an empty name or value). `important` says whether a
 * kept declaration lost its `!important`.
 */
export const styleToObject = (style: string): { text: string | null; important: boolean } => {
  const entries = new Map<string, string>();
  let important = false;
  for (const declaration of declarations(style)) {
    const colon = declaration.indexOf(':');
    if (colon === -1) continue;
    const name = declaration.slice(0, colon).trim();
    let value = declaration.slice(colon + 1).trim();
    const stripped = withoutImportant(value);
    const marked = stripped !== null;
    if (stripped !== null) value = stripped;
    if (name === '' || value === '') continue;
    if (marked) important = true;
    const key = styleKey(name);
    const custom = key.startsWith('--');
    const n = custom ? null : canonicalNumber(value);
    const literal = n !== null && (n === 0 || UNITLESS_STYLES.has(key)) ? String(n) : jsString(value);
    // The last of a repeated property wins, in the last one's place — as in CSS; two equal keys would not type-check.
    entries.delete(key);
    entries.set(key, literal);
  }
  if (entries.size === 0) return { text: null, important };
  const pairs = [...entries].map(([key, literal]) => `${IDENTIFIER.test(key) ? key : jsString(key)}: ${literal}`);
  return { text: `{ ${pairs.join(', ')} }`, important };
};
