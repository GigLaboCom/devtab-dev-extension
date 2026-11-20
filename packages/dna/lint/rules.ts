/**
 * The contract made mechanical (README.md → «Контракт»). A page's stylesheets, its inline styles and its HTML are held
 * to the tokens of this package: colours, radii, shadows and sizes come from tokens, so every theme works and the look
 * stays gpui-kit's. Plain declarations and Tailwind `@apply` lists are both checked.
 *
 *   color-literal    no #hex, rgb()/hsl()/oklch()/…, no named colour, no Tailwind palette colour (`red-500`, `white`)
 *   unknown-token    var(--x) / a utility's colour must be a token of tokens.json (or a prefix the page owns)
 *   token-override   a page defines only its own custom properties, never a token
 *   radius           border-radius only through var(--radius-*), `0`, `50%`, `9999px`; `rounded-*` only of the scale
 *   shadow           box-shadow only `none` or var(--shadow-*); `shadow-*` only of the scale, no arbitrary shadow
 *   size-literal     lengths (px, rem, em, pt) in sizes, spacing and type only through tokens; `1px` hairlines allowed
 *   font-size        font-size only var(--text-*)
 *   weight           400, 500, 600 only (gpui-kit's three weights)
 *   font-stack       font-family only var(--font-sans) / var(--font-mono); system-font: no system-ui & co
 *   gradient, blur   flat fills, no backdrop or filter blur (gpui-kit draws neither; Aurora is not offered)
 *   color-scheme     no prefers-color-scheme in a page: the theme is chosen by data-theme
 *   font-face/import no @font-face; @import only of what `imports` allows (Tailwind and this package)
 *   inline-style     TSX inline styles only for geometry and own properties, as literal objects; HTML has no
 *                    <style>, no style="" and no inline <script> (the extension's CSP refuses them anyway)
 *
 * A rule that cannot fail proves nothing: tests/rules.test.ts feeds every rule a failing case.
 */
import tokensJson from '../tokens.json';

export interface Violation {
  rule: string;
  file: string;
  where: string;
  detail: string;
}

export interface LintOptions {
  /** The file's name, for the report. */
  file?: string;
  /** Custom-property prefixes the page may define and read besides the tokens (`--compare-`, `--radix-`, …). */
  own?: readonly string[];
  /** `@import` targets the stylesheet may name (exact strings), e.g. 'tailwindcss', '@workspace/dna/theme.css'. */
  imports?: readonly string[];
}

interface TokensFile {
  themes: Record<string, { mode: 'light' | 'dark'; tokens: Record<string, string> }>;
  base: Record<string, string>;
}

const TOKENS_FILE = tokensJson as unknown as TokensFile;
const THEME_VALUES = Object.values(TOKENS_FILE.themes).map(t => t.tokens);

/** Every token name: the themes' and the base's. */
export const TOKENS: ReadonlySet<string> = new Set([
  ...THEME_VALUES.flatMap(t => Object.keys(t)),
  ...Object.keys(TOKENS_FILE.base),
]);

/** Colour tokens as Tailwind names them (`--primary-hover` → `primary-hover`): the bridge maps exactly these. */
export const COLOR_NAMES: ReadonlySet<string> = new Set(
  Object.entries(THEME_VALUES[0] ?? {})
    .filter(([, value]) => value.startsWith('#'))
    .map(([name]) => name.slice(2)),
);

const suffixes = (prefix: string) =>
  new Set(
    [...TOKENS].filter(t => t.startsWith(prefix) && !t.includes('--line-height')).map(t => t.slice(prefix.length)),
  );
const RADII = new Set([...suffixes('--radius-'), 'none', 'full']);
const SHADOWS = new Set([...suffixes('--shadow-')].filter(s => s !== 'color').concat('none'));
const TEXT_SIZES = suffixes('--text-');

const COLOR_FN = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;
const HEX = /#[0-9a-f]{3,8}\b/i;
const NAMED_COLOR =
  /\b(?:black|white|red|green|blue|yellow|orange|purple|pink|gr[ae]y|silver|maroon|navy|teal|olive|lime|aqua|fuchsia)\b/i;
const PALETTE =
  /^(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}$|^(?:black|white)$/;
const LENGTH = /(?<![\w-])(\d*\.?\d+)(px|rem|em|pt|ch)\b/g;
const SYSTEM_FONTS = /system-ui|-apple-system|BlinkMacSystemFont|Segoe UI|Roboto|Helvetica|Arial/i;
const COLOR_PROPS =
  /^(?:color|background(?:-color)?|border(?:-[a-z]+)*-color|border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?|outline(?:-color)?|fill|stroke|caret-color|accent-color|text-decoration(?:-color)?|column-rule(?:-color)?|box-shadow|scrollbar-color)$/;
const SIZE_PROPS =
  /^(?:(?:min-|max-)?(?:width|height|block-size|inline-size)|padding.*|margin.*|gap|row-gap|column-gap|top|right|bottom|left|inset.*|flex-basis|grid-template-(?:columns|rows)|grid-auto-(?:columns|rows)|line-height|letter-spacing|border(?:-[a-z]+)*-width|outline-width|outline-offset|text-indent|translate)$/;
const INLINE_STYLE_KEYS = new Set([
  'left',
  'top',
  'right',
  'bottom',
  'inset',
  'width',
  'height',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'transform',
  'gridTemplateColumns',
  'gridTemplateRows',
  'gridColumn',
  'gridRow',
  'flexBasis',
]);

interface Decl {
  selector: string;
  prop: string;
  value: string;
}

/** Declarations with the rule they sit in, `@apply` lists, top-level statements and every block's prelude. */
export const parseCss = (css: string) => {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const stack: string[] = [];
  const decls: Decl[] = [];
  const applies: Array<{ selector: string; classes: string[] }> = [];
  const statements: string[] = [];
  const preludes: string[] = [];
  let buf = '';
  let parens = 0;
  const take = (part: string) => {
    const decl = part.trim();
    if (!decl) return;
    const selector = stack[stack.length - 1] ?? '';
    if (decl.startsWith('@apply')) {
      applies.push({ selector, classes: decl.slice('@apply'.length).trim().split(/\s+/).filter(Boolean) });
      return;
    }
    const colon = decl.indexOf(':');
    if (colon < 0) return;
    decls.push({ selector, prop: decl.slice(0, colon).trim().toLowerCase(), value: decl.slice(colon + 1).trim() });
  };
  for (const ch of text) {
    if (ch === '(' || ch === '[') parens++;
    if (ch === ')' || ch === ']') parens--;
    if (parens > 0) {
      buf += ch;
      continue;
    }
    if (ch === '{') {
      const prelude = buf.trim();
      const lastSemi = prelude.lastIndexOf(';');
      if (lastSemi >= 0) take(prelude.slice(0, lastSemi));
      const head = prelude.slice(lastSemi + 1).trim();
      preludes.push(head);
      stack.push(head);
      buf = '';
    } else if (ch === '}') {
      take(buf);
      buf = '';
      stack.pop();
    } else if (ch === ';') {
      if (stack.length === 0) statements.push(buf.trim());
      else take(buf);
      buf = '';
    } else {
      buf += ch;
    }
  }
  return { decls, applies, statements, preludes };
};

/** `var(--token, fallback)` → `var(--token)`: the token decides. */
const stripFallbacks = (value: string) =>
  value.replace(/var\(\s*(--[a-zA-Z0-9-]+)\s*,[^()]*(?:\([^()]*\)[^()]*)*\)/g, 'var($1)');

/** Lengths left once every var(), percentage and allowed hairline is removed. */
const literalLengths = (value: string): string[] =>
  [...value.replace(/var\([^()]*\)/g, ' ').matchAll(LENGTH)]
    .map(m => m[0])
    .filter(l => !/^(?:0|1)(?:px)?$/.test(l) && !/^0(?:\.0+)?[a-z]+$/.test(l));

/** A Tailwind class split into its variants and its utility (`hover:bg-x/50` → `bg-x/50`). */
const utilityOf = (cls: string): string => {
  let depth = 0;
  let cut = 0;
  for (let i = 0; i < cls.length; i++) {
    const ch = cls[i];
    if (ch === '[' || ch === '(') depth++;
    else if (ch === ']' || ch === ')') depth--;
    else if (ch === ':' && depth === 0) cut = i + 1;
  }
  return cls.slice(cut).replace(/^!|!$/g, '').replace(/^-/, '');
};

const COLOR_UTILITY =
  /^(bg|text|border(?:-[xytrblse])?|ring|ring-offset|inset-ring|outline|fill|stroke|caret|accent|decoration|divide|placeholder|from|via|to|shadow)-(.+)$/;
/** Values of a colour-looking prefix that are not colours (widths, sizes, styles, keywords). */
const NON_COLOR =
  /^(?:\d+(?:\.\d+)?|x|y|t|r|b|l|s|e|x-\d+|y-\d+|[trblse]-\d+|none|solid|dashed|dotted|double|hidden|inset|clip-(?:padding|border|content|text)|origin-(?:padding|border|content)|fixed|local|scroll|center|top|bottom|left|right|start|end|justify|wrap|nowrap|balance|pretty|ellipsis|clip|cover|contain|auto|repeat|no-repeat|repeat-x|repeat-y|collapse|separate|transparent|current|inherit|offset-\d+|underline|overline|line-through|wavy|from-font|reverse|blend-[a-z-]+|left-top|right-top|left-bottom|right-bottom)$/;

/** Every violation of one `@apply` list. */
const lintApply = (
  selector: string,
  classes: string[],
  report: (rule: string, where: string, detail: string) => void,
  isOwn: (name: string) => boolean,
) => {
  for (const cls of classes) {
    const where = `${selector} { @apply ${cls} }`;
    const util = utilityOf(cls);
    const variants = cls.slice(0, cls.length - util.length);
    for (const m of `${variants}${util}`.matchAll(/\(\s*(--[a-zA-Z0-9-]+)\s*\)|var\(\s*(--[a-zA-Z0-9-]+)/g)) {
      const name = (m[1] ?? m[2])!;
      if (!TOKENS.has(name) && !isOwn(name)) report('unknown-token', where, `${name} is not a token`);
    }
    const arbitrary = /\[([^\]]*)\]$/.exec(util)?.[1];
    if (arbitrary !== undefined) {
      const value = arbitrary.replace(/_/g, ' ');
      if (HEX.test(value) || COLOR_FN.test(value)) report('color-literal', where, 'colours come from tokens');
      if (literalLengths(value).length)
        report('size-literal', where, `${literalLengths(value).join(', ')}: use a token`);
    }
    if (/^(?:bg-(?:linear|radial|conic|gradient)|from-|via-|to-)/.test(util)) {
      report('gradient', where, 'flat fills only');
      continue;
    }
    if (/^(?:backdrop-)?blur/.test(util)) {
      report('blur', where, 'gpui-kit draws no blur');
      continue;
    }
    const radius = /^rounded(?:-(?:[trblse]|tl|tr|bl|br|ss|se|es|ee|s|e))?(?:-(.+))?$/.exec(util);
    if (radius) {
      const name = radius[1];
      if (name !== undefined && !RADII.has(name) && !/^\(--radius-[a-z0-9-]+\)$/.test(name)) {
        report('radius', where, `rounded-${name}: radii are --radius-* tokens`);
      }
      continue;
    }
    if (/^font-(?:thin|extralight|light|bold|extrabold|black)$/.test(util)) {
      report('weight', where, 'gpui-kit has 400, 500 and 600');
      continue;
    }
    if (/^font-\[/.test(util)) {
      report('font-stack', where, 'font-sans or font-mono');
      continue;
    }
    const color = COLOR_UTILITY.exec(util);
    if (!color) continue;
    const [, prefix, rest] = color as unknown as [string, string, string];
    const name = rest.replace(/\/\d+$/, '');
    if (name.startsWith('[') || name.startsWith('(')) {
      if (prefix === 'shadow' && name.startsWith('[')) report('shadow', where, 'shadows are --shadow-* tokens');
      continue;
    }
    if (COLOR_NAMES.has(name) || NON_COLOR.test(name)) continue;
    if (prefix === 'text' && TEXT_SIZES.has(name)) continue;
    if (prefix === 'shadow' && SHADOWS.has(name)) continue;
    if (PALETTE.test(name)) report('color-literal', where, `${name} is Tailwind's palette, not a token`);
    else if (prefix === 'shadow') report('shadow', where, `shadow-${name} is not a --shadow-* token`);
    else report('unknown-token', where, `${name} is neither a colour token nor a known keyword`);
  }
};

/** Every violation in a stylesheet. */
export const lintCss = (css: string, { file = '<css>', own = [], imports = [] }: LintOptions = {}): Violation[] => {
  const out: Violation[] = [];
  const report = (rule: string, where: string, detail: string) => out.push({ rule, file, where, detail });
  const isOwn = (name: string) => own.some(prefix => name.startsWith(prefix));
  const { decls, applies, statements, preludes } = parseCss(css);

  for (const statement of statements) {
    const target = /^@import\s+(?:url\()?['"]([^'"]+)['"]/i.exec(statement)?.[1];
    if (/^@import\b/i.test(statement) && (!target || !imports.includes(target))) {
      report('import', statement, 'the theme comes from @workspace/dna; only the allowed imports');
    }
  }
  for (const prelude of preludes) {
    if (/^@font-face\b/i.test(prelude)) report('font-face', prelude, 'the faces are @workspace/dna’s (fonts.css)');
    if (/prefers-color-scheme/i.test(prelude)) report('color-scheme', prelude, 'the theme is chosen by data-theme');
  }

  for (const { selector, prop, value: raw } of decls) {
    const where = `${selector} { ${prop}: ${raw} }`;
    const value = stripFallbacks(raw);
    const bare = value.replace(/var\([^()]*\)/g, '');
    if (HEX.test(value) || COLOR_FN.test(bare)) {
      report('color-literal', where, 'colours come from tokens, so every theme works');
    } else if (COLOR_PROPS.test(prop) && NAMED_COLOR.test(bare)) {
      report('color-literal', where, 'a named colour is a literal too');
    }
    if (/^border(?:-[a-z]+)*-radius$/.test(prop)) {
      const ok = value
        .split(/\s*\/\s*|\s+(?![^(]*\))/)
        .every(
          part =>
            /^(?:0|0px|50%|9999px|inherit)$/.test(part) ||
            (/var\(--radius-/.test(part) && !literalLengths(part).length),
        );
      if (!ok) report('radius', where, 'radii are --radius-* tokens');
    }
    if ((prop === 'box-shadow' || prop === 'text-shadow') && !/^(?:none|inherit)$/.test(value)) {
      const ok = value.split(/,(?![^(]*\))/).every(part => /^\s*var\(--shadow-[a-z0-9-]+\)\s*$/.test(part));
      if (!ok) report('shadow', where, 'shadows are --shadow-* tokens');
    }
    if (prop === 'font-size' && !/^(?:var\(--text-[a-z0-9]+\)|inherit|100%)$/.test(value)) {
      report('font-size', where, 'font-size is a --text-* token');
    } else if ((SIZE_PROPS.test(prop) || prop === 'font' || prop === 'border') && literalLengths(value).length) {
      report(
        'size-literal',
        where,
        `${literalLengths(value).join(', ')}: use a token (calc(var(--spacing) * n), --size-*)`,
      );
    }
    const weight =
      prop === 'font-weight'
        ? value
        : prop === 'font'
          ? (/\b(?:[1-9]00|bold|bolder|lighter)\b/i.exec(value)?.[0] ?? null)
          : null;
    if (
      weight !== null &&
      !/^(?:400|500|600|normal|inherit|var\(--font-weight-(?:normal|medium|semibold)\))$/i.test(weight)
    ) {
      report('weight', where, `weight ${weight}: gpui-kit has 400, 500 and 600`);
    }
    if (prop === 'font-family' && !/^(?:var\(--font-(?:sans|mono)\)|inherit)$/.test(value)) {
      report('font-stack', where, 'font-family is var(--font-sans) or var(--font-mono)');
    }
    if ((prop === 'font' || prop === 'font-family') && SYSTEM_FONTS.test(bare)) {
      report('system-font', where, 'no system faces (docs/theming.md §6)');
    }
    if (/\b(?:repeating-)?(?:linear|radial|conic)-gradient\(/i.test(value))
      report('gradient', where, 'flat fills only');
    if (/^(?:backdrop-filter|-webkit-backdrop-filter)$/.test(prop) || (prop === 'filter' && /blur\(/.test(value))) {
      report('blur', where, 'gpui-kit draws no blur');
    }
    for (const m of value.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) {
      const name = m[1]!;
      if (!TOKENS.has(name) && !isOwn(name)) report('unknown-token', where, `${name} is not a token`);
    }
    if (prop.startsWith('--') && !isOwn(prop)) {
      report('token-override', where, `a page defines only its own properties (${own.join(', ') || 'none'})`);
    }
  }

  for (const { selector, classes } of applies) lintApply(selector, classes, report, isOwn);
  return out;
};

/** Inline styles in TSX: only geometry and own properties, as literal objects — so lintCss sees every colour. */
export const lintInlineStyles = (source: string, { file = '<tsx>', own = [] }: LintOptions = {}): Violation[] => {
  const out: Violation[] = [];
  for (const m of source.matchAll(/style=\{(?!\{)/g)) {
    out.push({
      rule: 'inline-style',
      file,
      where: source.slice(m.index, m.index + 40),
      detail: 'style must be a literal object',
    });
  }
  for (const m of source.matchAll(/style=\{\{([\s\S]*?)\}\}/g)) {
    for (const k of m[1]!.matchAll(/(?:^|[,{\s])(['"]?)([A-Za-z_$-][\w$-]*)\1\s*:/g)) {
      const key = k[2]!;
      if (!INLINE_STYLE_KEYS.has(key) && !own.some(prefix => key.startsWith(prefix))) {
        out.push({
          rule: 'inline-style',
          file,
          where: `style.${key}`,
          detail: 'only geometry inline; the rest in CSS',
        });
      }
    }
  }
  return out;
};

/** An HTML page: no <style>, no style="", no inline <script> — CSS lives where lintCss reads it. */
export const lintHtml = (html: string, { file = '<html>' }: LintOptions = {}): Violation[] => {
  const out: Violation[] = [];
  if (/<style\b/i.test(html))
    out.push({ rule: 'inline-style', file, where: '<style>', detail: 'styles belong in CSS' });
  if (/\sstyle\s*=/i.test(html))
    out.push({ rule: 'inline-style', file, where: 'style=', detail: 'styles belong in CSS' });
  for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) {
    if (!/\ssrc=/i.test(tag)) out.push({ rule: 'inline-script', file, where: tag, detail: 'scripts are files' });
  }
  return out;
};
