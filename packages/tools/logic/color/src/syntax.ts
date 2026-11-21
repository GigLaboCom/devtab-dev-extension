/**
 * The shape of a colour function (docs/tools/specs/color.md §5.1, §7) — `rgb()`, `rgba()`, `hsl()`, `hsla()`, `hwb()`,
 * `lab()`, `lch()`, `oklab()`, `oklch()` and `color()` — checked without the colour library, so `detect` stays light
 * (it loads with every tool's `detect`, docs/tools/adding-a-tool.md §3). `parseColor` asks the same question before it
 * parses, so a function `detect` recognises is exactly one `parseColor` accepts: the CSS Color 4 grammar of each
 * function — which component may be a number, a percentage, an angle or `none`; modern (spaces, `/ alpha`) and legacy
 * (commas, `rgb` and `hsl` only) syntax; a closing parenthesis at the end. One pass over the text, no regular
 * expression with repetition over the whole input.
 */

/** The `color()` spaces of CSS Color 4 §10. */
export const COLOR_SPACES: readonly string[] = [
  'srgb',
  'srgb-linear',
  'display-p3',
  'a98-rgb',
  'prophoto-rgb',
  'rec2020',
  'xyz',
  'xyz-d50',
  'xyz-d65',
];

/** The colour functions this tool reads. */
export const COLOR_FUNCTIONS: readonly string[] = [
  'rgb',
  'rgba',
  'hsl',
  'hsla',
  'hwb',
  'lab',
  'lch',
  'oklab',
  'oklch',
  'color',
];

type Token =
  | { t: 'number' }
  | { t: 'percent' }
  | { t: 'angle' }
  | { t: 'none' }
  | { t: 'ident'; v: string }
  | { t: '/' }
  | { t: ',' };

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';
const isSpace = (c: string | undefined): boolean => c === ' ' || c === '\t' || c === '\n';
const isIdentChar = (c: string | undefined): boolean =>
  c !== undefined && ((c >= 'a' && c <= 'z') || isDigit(c) || c === '-' || c === '_');
const ANGLES = ['deg', 'rad', 'grad', 'turn'];

/** The arguments between the parentheses as tokens (the text is lowercase); undefined when one is not a token. */
const tokenize = (s: string): Token[] | undefined => {
  const out: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (isSpace(c)) {
      i++;
      continue;
    }
    if (c === '/' || c === ',') {
      out.push({ t: c });
      i++;
      continue;
    }
    const startsNumber =
      isDigit(c) ||
      (c === '.' && isDigit(s[i + 1])) ||
      ((c === '+' || c === '-') && (isDigit(s[i + 1]) || (s[i + 1] === '.' && isDigit(s[i + 2]))));
    if (startsNumber) {
      if (c === '+' || c === '-') i++;
      while (isDigit(s[i])) i++;
      if (s[i] === '.' && isDigit(s[i + 1])) {
        i++;
        while (isDigit(s[i])) i++;
      }
      if (s[i] === 'e' && (isDigit(s[i + 1]) || ((s[i + 1] === '+' || s[i + 1] === '-') && isDigit(s[i + 2])))) {
        i += isDigit(s[i + 1]) ? 1 : 2;
        while (isDigit(s[i])) i++;
      }
      if (s[i] === '%') {
        out.push({ t: 'percent' });
        i++;
      } else if (s[i] !== undefined && s[i]! >= 'a' && s[i]! <= 'z') {
        const from = i;
        while (isIdentChar(s[i])) i++;
        if (!ANGLES.includes(s.slice(from, i))) return undefined;
        out.push({ t: 'angle' });
      } else out.push({ t: 'number' });
      continue;
    }
    if (c !== undefined && c >= 'a' && c <= 'z') {
      const from = i;
      while (isIdentChar(s[i])) i++;
      const word = s.slice(from, i);
      out.push(word === 'none' ? { t: 'none' } : { t: 'ident', v: word });
      continue;
    }
    return undefined;
  }
  return out;
};

/** What each position accepts: n number, p percentage, a angle, x `none`. */
type Accepts = string;
const MODERN: Record<string, readonly [Accepts, Accepts, Accepts]> = {
  rgb: ['npx', 'npx', 'npx'],
  hsl: ['nax', 'npx', 'npx'],
  hwb: ['nax', 'npx', 'npx'],
  lab: ['npx', 'npx', 'npx'],
  oklab: ['npx', 'npx', 'npx'],
  lch: ['npx', 'npx', 'nax'],
  oklch: ['npx', 'npx', 'nax'],
  color: ['npx', 'npx', 'npx'],
};
const CODE: Record<string, string> = { number: 'n', percent: 'p', angle: 'a', none: 'x' };
const accepts = (token: Token | undefined, what: Accepts): boolean =>
  token !== undefined && CODE[token.t] !== undefined && what.includes(CODE[token.t]!);

/** Space-separated components, then an optional `/ alpha`. */
const modern = (tokens: readonly Token[], shape: readonly [Accepts, Accepts, Accepts]): boolean => {
  if (tokens.length !== 3 && tokens.length !== 5) return false;
  if (!shape.every((what, k) => accepts(tokens[k], what))) return false;
  return tokens.length === 3 || (tokens[3]!.t === '/' && accepts(tokens[4], 'npx'));
};

/** Comma-separated components of `rgb()` (all numbers or all percentages) and `hsl()`, an optional alpha. */
const legacy = (name: string, tokens: readonly Token[]): boolean => {
  if (tokens.length !== 5 && tokens.length !== 7) return false;
  for (let k = 1; k < tokens.length; k += 2) if (tokens[k]!.t !== ',') return false;
  const [a, , b, , c, , alpha] = tokens;
  const ok =
    name === 'rgb'
      ? [a, b, c].every(x => x!.t === 'number') || [a, b, c].every(x => x!.t === 'percent')
      : accepts(a, 'na') && b!.t === 'percent' && c!.t === 'percent';
  return ok && (alpha === undefined || accepts(alpha, 'np'));
};

/**
 * Is this lowercase, trimmed text one colour function of CSS Color 4 with valid arguments (`rgb(255 136 0)`,
 * `hsl(32deg, 100%, 50%)`, `color(display-p3 0 1 0 / 50%)`)? Not `rgb(1 2)`, not `rgb(1, 2 3)`, not `rgb(from …)`.
 */
export const isColorFunction = (text: string): boolean => {
  const open = text.indexOf('(');
  if (open < 0 || !text.endsWith(')')) return false;
  const raw = text.slice(0, open);
  if (!COLOR_FUNCTIONS.includes(raw)) return false;
  const name = raw === 'rgba' ? 'rgb' : raw === 'hsla' ? 'hsl' : raw;
  const tokens = tokenize(text.slice(open + 1, -1));
  if (!tokens) return false;
  if (name === 'color') {
    const space = tokens[0];
    return space?.t === 'ident' && COLOR_SPACES.includes(space.v) && modern(tokens.slice(1), MODERN.color!);
  }
  if (tokens.some(t => t.t === ',')) return (name === 'rgb' || name === 'hsl') && legacy(name, tokens);
  return modern(tokens, MODERN[name]!);
};
