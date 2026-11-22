/**
 * The Code Formatter tool's logic (docs/tools/specs/code-format.md §5, §9): the languages and their Prettier modules,
 * the options, recognising a language in pasted text, mapping a Prettier error to its place, and the XML printer. Pure:
 * no React, no DOM, no chrome, and no library — Prettier and saxes are handed in by whoever loaded them (format.ts,
 * xml.ts), so the start page's `detect` and the component never pull them in.
 */

export type CodeLanguage = 'javascript' | 'typescript' | 'css' | 'scss' | 'less' | 'html' | 'xml' | 'markdown' | 'yaml';
export type PrettierLanguage = Exclude<CodeLanguage, 'xml'>;

export type Indent = 2 | 4 | 'tab';
export type LineWidth = 80 | 100 | 120;
export type TrailingComma = 'all' | 'es5' | 'none';
export type Whitespace = 'css' | 'strict' | 'ignore';
export type ProseWrap = 'preserve' | 'always' | 'never';

/** One set for the whole tool (§4): `Quotes` of JavaScript and of CSS is one value. */
export interface FormatSettings {
  indent: Indent;
  lineWidth: LineWidth;
  semi: boolean;
  singleQuote: boolean;
  trailingComma: TrailingComma;
  whitespace: Whitespace;
  proseWrap: ProseWrap;
}

/** An error with its place: `offset` in UTF-16 code units, `line` and `column` from 1, the column in UTF-16 units. */
export interface PlacedError {
  message: string;
  offset: number;
  line: number;
  column: number;
}
export type FormatError = PlacedError | { message: string };
export type FormatResult = { ok: true; text: string } | { ok: false; error: FormatError };

export const LANGUAGES: readonly CodeLanguage[] = [
  'javascript',
  'typescript',
  'css',
  'scss',
  'less',
  'html',
  'xml',
  'markdown',
  'yaml',
];

export const LANGUAGE_LABELS: Record<CodeLanguage, string> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  css: 'CSS',
  scss: 'SCSS',
  less: 'LESS',
  html: 'HTML',
  xml: 'XML',
  markdown: 'Markdown',
  yaml: 'YAML',
};

/** The extension `Save` gives the result: `formatted.<extension>` (§3). */
export const LANGUAGE_EXTENSIONS: Record<CodeLanguage, string> = {
  javascript: 'js',
  typescript: 'ts',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  xml: 'xml',
  markdown: 'md',
  yaml: 'yaml',
};

export const DEFAULT_SETTINGS: FormatSettings = {
  indent: 2,
  lineWidth: 80,
  semi: true,
  singleQuote: false,
  trailingComma: 'all',
  whitespace: 'css',
  proseWrap: 'preserve',
};

/** Up to this many characters the result follows every edit, SETTLE_MS after the last one (§12). */
export const LIVE_INPUT = 32 * 1024;
export const SETTLE_MS = 300;
const MI = 1024 * 1024;
/**
 * §12: above these, the input is refused. Markdown and LESS grow faster than linearly (LESS: 256 Ki in about 2 s,
 * 512 Ki in 8 s, 1 Mi in 30 s — measured, §15), so theirs are lower.
 */
export const MAX_INPUT: Record<CodeLanguage, number> = {
  javascript: 2 * MI,
  typescript: 2 * MI,
  css: 2 * MI,
  scss: 2 * MI,
  less: 256 * 1024,
  html: 2 * MI,
  xml: 8 * MI,
  markdown: 256 * 1024,
  yaml: 2 * MI,
};
/** A formatting that runs longer than this is stopped (the worker is terminated): pathological input (§12, §15). */
export const TIME_LIMIT_MS = 15_000;
/** A result longer than this is not made (deep nesting multiplies the indentation): said in words (§15). */
export const MAX_RESULT = 64 * MI;
/** A result above either is not put into the field: a summary instead (json §12). */
export const SHOW_RESULT_CHARS = 8 * MI;
export const SHOW_RESULT_LINES = 200_000;
/** `detectLanguage` looks at this many characters (§5 п. 7). */
export const DETECT_CHARS = 16 * 1024;

const sizeLabel = (chars: number): string => (chars >= MI ? `${chars / MI} MB` : `${chars / 1024} KB`);

/** §6: `Input is larger than 2 MB. Formatting works with up to 2 MB of JavaScript.` */
export const tooLargeMessage = (language: CodeLanguage): string => {
  const size = sizeLabel(MAX_INPUT[language]);
  return `Input is larger than ${size}. Formatting works with up to ${size} of ${LANGUAGE_LABELS[language]}.`;
};

export const LARGE_MESSAGE = 'Large input: press Run (Ctrl+Enter) to format it.';
export const UNDETECTED_MESSAGE = "Choose a language: this text doesn't look like any of them.";
export const HTML_NOTE = "Code inside <script> and <style> that doesn't parse is left as it is.";
export const NOT_UTF8_MESSAGE = 'The file is not valid UTF-8 text.';
export const TIMED_OUT_MESSAGE = `Formatting took longer than ${TIME_LIMIT_MS / 1000} seconds and was stopped.`;
export const TOO_DEEP_MESSAGE = 'The code is nested too deeply to format.';
export const RESULT_TOO_LARGE_MESSAGE = 'The result would be larger than 64 MB.';
export const loadingMessage = (language: CodeLanguage): string => `Loading the ${LANGUAGE_LABELS[language]} formatter…`;

/** Which options a language has (§4, §8): the second row shows only these; XML has no Line width. */
export interface LanguageOptions {
  tabs: boolean;
  lineWidth: boolean;
  semi: boolean;
  quotes: boolean;
  trailingComma: boolean;
  whitespace: boolean;
  proseWrap: boolean;
}
const JS_OPTIONS: LanguageOptions = {
  tabs: true,
  lineWidth: true,
  semi: true,
  quotes: true,
  trailingComma: true,
  whitespace: false,
  proseWrap: false,
};
const CSS_OPTIONS: LanguageOptions = { ...JS_OPTIONS, semi: false, trailingComma: false };
export const OPTIONS_OF: Record<CodeLanguage, LanguageOptions> = {
  javascript: JS_OPTIONS,
  typescript: JS_OPTIONS,
  css: CSS_OPTIONS,
  scss: CSS_OPTIONS,
  less: CSS_OPTIONS,
  html: { ...CSS_OPTIONS, quotes: false, whitespace: true },
  xml: { ...CSS_OPTIONS, quotes: false, lineWidth: false },
  markdown: { ...CSS_OPTIONS, quotes: false, proseWrap: true },
  // Tabs are not allowed in YAML indentation.
  yaml: { ...CSS_OPTIONS, tabs: false },
};

/** The indent a language actually uses: YAML has no Tab, it falls back to 2 spaces (§4, §15). */
export const effectiveIndent = (language: CodeLanguage, indent: Indent): Indent =>
  indent === 'tab' && !OPTIONS_OF[language].tabs ? 2 : indent;

/** Prettier's own modules (`prettier/plugins/<name>` and `prettier/standalone`). */
export type PrettierModule = 'standalone' | 'babel' | 'estree' | 'postcss' | 'html' | 'markdown' | 'yaml';

/**
 * §5 п. 1: the plugins each language loads, besides `standalone`. HTML always loads JavaScript and CSS (п. 3), so code
 * in `<script>`, `<style>` and `style` attributes is formatted alike whatever the input; Markdown loads nothing else
 * (п. 4): its code blocks stay as written.
 */
export const PRETTIER_PLUGINS: Record<PrettierLanguage, readonly Exclude<PrettierModule, 'standalone'>[]> = {
  javascript: ['babel', 'estree'],
  typescript: ['babel', 'estree'],
  css: ['postcss'],
  scss: ['postcss'],
  less: ['postcss'],
  html: ['html', 'babel', 'estree', 'postcss'],
  markdown: ['markdown'],
  yaml: ['yaml'],
};

const PARSERS: Record<PrettierLanguage, string> = {
  javascript: 'babel',
  // §5 п. 2: babel-ts from the babel module, not Prettier's typescript module (208.8 KiB gzip more).
  typescript: 'babel-ts',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  markdown: 'markdown',
  yaml: 'yaml',
};

/** §4 and §5 п. 1: Prettier's options for a language, without `plugins`. The rest are Prettier's own defaults. */
export const prettierOptions = (language: PrettierLanguage, settings: FormatSettings): Record<string, unknown> => {
  const indent = effectiveIndent(language, settings.indent);
  const options: Record<string, unknown> = {
    parser: PARSERS[language],
    printWidth: settings.lineWidth,
    tabWidth: indent === 'tab' ? 2 : indent,
    useTabs: indent === 'tab',
  };
  const has = OPTIONS_OF[language];
  if (has.semi) options.semi = settings.semi;
  if (has.quotes) options.singleQuote = settings.singleQuote;
  if (has.trailingComma) options.trailingComma = settings.trailingComma;
  if (has.whitespace) options.htmlWhitespaceSensitivity = settings.whitespace;
  if (has.proseWrap) options.proseWrap = settings.proseWrap;
  return options;
};

/** Line and column (from 1, the column in UTF-16 units) of an offset; `\r\n`, `\n` and a lone `\r` end a line. */
export const positionOf = (text: string, offset: number): { line: number; column: number } => {
  let line = 1;
  let start = 0;
  const end = Math.min(offset, text.length);
  for (let i = 0; i < end; i++) {
    const c = text.charCodeAt(i);
    if (c === 10 || (c === 13 && text.charCodeAt(i + 1) !== 10)) {
      line++;
      start = i + 1;
    }
  }
  return { line, column: end - start + 1 };
};

/** The offset of a line and column (from 1) as `positionOf` counts them; past the end — the end. */
const offsetOf = (text: string, line: number, column: number): number => {
  let start = 0;
  for (let l = 1; l < line; l++) {
    let i = start;
    while (i < text.length && text.charCodeAt(i) !== 10 && text.charCodeAt(i) !== 13) i++;
    if (i >= text.length) return text.length;
    start = text.charCodeAt(i) === 13 && text.charCodeAt(i + 1) === 10 ? i + 2 : i + 1;
  }
  return Math.min(start + Math.max(column, 1) - 1, text.length);
};

export interface PrettierErrorLike {
  name?: string;
  message: string;
  loc?: { start?: { line: number; column: number } };
}

/**
 * §5 п. 6: the first line of the message without its ` (L:C)` tail, the `CssSyntaxError: ` prefix and the ` For more
 * info see <address>` tail; the place from `loc.start` (line and column from 1, the column in UTF-16 units). Without a
 * place — the message alone. A stack that ran out (deeply nested code) is said in words.
 */
export const mapPrettierError = (text: string, error: PrettierErrorLike): FormatError => {
  if (/invalid string length/i.test(error.message)) return { message: RESULT_TOO_LARGE_MESSAGE };
  if (error.name === 'RangeError' || /call stack size exceeded|too much recursion/i.test(error.message))
    return { message: TOO_DEEP_MESSAGE };
  const message = (String(error.message).split('\n')[0] ?? '')
    .replace(/ \(\d+:\d+\)$/, '')
    .replace(/ For more info see \S+$/, '')
    .replace(/ \(\d+:\d+\)$/, '')
    .replace(/^CssSyntaxError: /, '')
    .trim();
  const start = error.loc?.start;
  if (!start || !Number.isInteger(start.line) || start.line < 1) return { message };
  const offset = offsetOf(text, start.line, Number.isInteger(start.column) ? start.column : 1);
  return { message, offset, ...positionOf(text, offset) };
};

export const isPlaced = (error: FormatError): error is PlacedError => 'offset' in error;

/** File extension → language (§3), or null (then `Auto`). */
export const languageOfFile = (name: string): CodeLanguage | null => {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return null;
  switch (name.slice(dot + 1).toLowerCase()) {
    case 'js':
    case 'mjs':
    case 'cjs':
    case 'jsx':
      return 'javascript';
    case 'ts':
    case 'mts':
    case 'cts':
    case 'tsx':
      return 'typescript';
    case 'css':
      return 'css';
    case 'scss':
      return 'scss';
    case 'less':
      return 'less';
    case 'html':
    case 'htm':
      return 'html';
    case 'xml':
    case 'svg':
    case 'xsd':
    case 'xsl':
    case 'xslt':
    case 'plist':
      return 'xml';
    case 'md':
    case 'markdown':
      return 'markdown';
    case 'yaml':
    case 'yml':
      return 'yaml';
    default:
      return null;
  }
};

/** A file's text: strict UTF-8 (a byte-order mark is dropped); anything else is refused (§3). */
export const decodeTextFile = (bytes: Uint8Array): { ok: true; text: string } | { ok: false; message: string } => {
  try {
    return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false, message: NOT_UTF8_MESSAGE };
  }
};

const HTML_TAG =
  /^(?:<!--[^]*?-->\s*)*<(?:html|head|body|div|span|p|a|ul|ol|li|table|section|main|nav|header|footer|form|input|button|img|script|style|link|meta|h[1-6]|template|svg)[\s>/]/i;
const TS_WORDS = /\b(?:interface|enum|namespace|declare|implements|readonly)\s+[A-Za-z_]/;
const TS_TYPE = /\btype\s+[A-Z]\w*\s*(?:<[^<>]*>\s*)?=/;
const TS_ANNOTATION = /[)\w]\s*:\s*(?:string|number|boolean|void|any|unknown|never)\b/;
const JS_WORDS = /\b(?:function|const|let|var|return|import|export)\b|=>/;
const JS_HINTS = /\b(?:function|const|let|var|return|import|export|class)\b|=>|\bconsole\.|\bdocument\.|\brequire\(/;

/**
 * `selector { property: value }` somewhere (§5 п. 7): a `{` whose selector starts a line and holds none of `{}();=`,
 * whose block holds a `:` and ends with `}`. One pass over the text — no regular expression that could backtrack.
 */
const hasCssRule = (t: string): boolean => {
  let lastForbidden = -1;
  /** The first line break after the last forbidden character. */
  let firstBreak = -1;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '\n') {
      if (firstBreak === -1) firstBreak = i;
    } else if (c === '{') {
      // The selector: from a line start after the last forbidden character up to this brace, not empty.
      const lineStart = lastForbidden === -1 ? 0 : firstBreak === -1 ? -1 : firstBreak + 1;
      if (lineStart !== -1 && lineStart < i) {
        let colon = false;
        let j = i + 1;
        for (; j < t.length && t[j] !== '{' && t[j] !== '}'; j++) if (t[j] === ':') colon = true;
        if (colon && t[j] === '}') return true;
      }
      lastForbidden = i;
      firstBreak = -1;
    } else if (c === '}' || c === '(' || c === ')' || c === ';' || c === '=') {
      lastForbidden = i;
      firstBreak = -1;
    }
  }
  return false;
};

const CSS_AT_RULE = /(?:^|\n)@(?:media|import|font-face|keyframes|charset|supports|layer)\b/;
const SCSS_VARIABLE = /(?:^|\n)[ \t]*\$[\w-]+[ \t]*:/;
const SCSS_AT_RULE = /@(?:mixin|include|extend|use|forward)\b/;
const LESS_VARIABLE = /(?:^|\n)[ \t]*@[\w-]+[ \t]*:[^;\n]+;/;
const LESS_MIXIN_CALL = /\.[\w-]+\([ \t]*\)[ \t]*;/;
const YAML_LINE = /^(?:\s*-\s|\s*[\w"'.-]+:(?:\s|$)|\s+\S|---)/;

/** Text that parses as JSON is the `json` tool's (§5 п. 5); a long one is judged by its brackets alone. */
const looksLikeJson = (text: string): boolean => {
  const first = text[0];
  if (first !== '{' && first !== '[') return false;
  const trimmed = text.trimEnd();
  const last = trimmed[trimmed.length - 1];
  if (last !== (first === '{' ? '}' : ']')) return false;
  if (trimmed.length > MI) return true;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
};

/**
 * §5 п. 7: the language of a text, by the first DETECT_CHARS characters after a byte-order mark and leading
 * whitespace; the first rule that matches wins; null — none. No library, every expression linear on its input.
 */
export const detectLanguage = (text: string): CodeLanguage | null => {
  const whole = text.replace(/^\uFEFF/, '').trimStart();
  if (whole === '' || looksLikeJson(whole)) return null;
  const t = whole.slice(0, DETECT_CHARS);
  if (/^<\?xml[\s?]/.test(t)) return 'xml';
  if (/^<!doctype\s+html/i.test(t) || HTML_TAG.test(t))
    return /^<svg[\s>]/i.test(t) && !/<(?:div|span|p|body|html)[\s>]/i.test(t) ? 'xml' : 'html';
  if (/^<[A-Za-z_][\w.:-]*[\s>/]/.test(t)) return 'xml';
  if (/^(?:---[ \t]*\n)?(?:#{1,6} \S|```|\* \S|- \[[ x]\] )/.test(t) || (/\n#{1,6} \S/.test(t) && t.includes('\n\n')))
    return 'markdown';
  if (TS_WORDS.test(t) || TS_TYPE.test(t) || TS_ANNOTATION.test(t) || /\bas\s+const\b/.test(t)) return 'typescript';
  const cssish = CSS_AT_RULE.test(t) || hasCssRule(t);
  if (SCSS_VARIABLE.test(t) || SCSS_AT_RULE.test(t) || (cssish && /&[:.\-\w]/.test(t) && /\$[\w-]/.test(t)))
    return 'scss';
  if (LESS_VARIABLE.test(t) || LESS_MIXIN_CALL.test(t)) return 'less';
  if (cssish && !JS_WORDS.test(t)) return 'css';
  if (JS_HINTS.test(t)) return 'javascript';
  const lines = t
    .split('\n')
    .filter(l => l.trim() !== '' && !l.trim().startsWith('#'))
    .slice(0, 50);
  if (lines.length >= 2 && lines.every(l => YAML_LINE.test(l))) return 'yaml';
  return null;
};

/**
 * §7: does pasted text belong here? `detectLanguage` with two exceptions, so as not to take other tools' input: YAML is
 * `yaml-json`'s; a one-line HTML fragment is more often `html-entities`' or `html-to-jsx`'s input.
 */
export const detectCodeFormat = (text: string): boolean => {
  const language = detectLanguage(text);
  if (language === null || language === 'yaml') return false;
  if (language === 'html') {
    const t = text.replace(/^\uFEFF/, '').trim();
    return /^<!doctype/i.test(t) || /[\r\n]/.test(t);
  }
  return true;
};

/**
 * §5 п. 9, printing only: the text must already be well-formed (formatXml checks it with saxes first). One linear pass:
 * the declaration, DOCTYPE, comments and processing instructions each on a line of their own, as written; an empty
 * element (or one holding only whitespace) on one line as `<a/>` or `<a></a>`; an element with text or CDATA among its
 * direct children, or with `xml:space="preserve"`, on one line with its content as written (line breaks would change
 * the text); any other element — its children one per line, a level deeper. Whitespace between elements is dropped.
 * In a tag, the name and the attributes one space apart, the values in their own quotes, `/>` with no space.
 * A result longer than `limit` is not made: null.
 */
export const printXml = (text: string, indent: Indent, limit: number = MAX_RESULT): string | null => {
  const unit = indent === 'tab' ? '\t' : ' '.repeat(indent);
  const n = text.length;
  type Kind = 'open' | 'close' | 'empty' | 'text' | 'cdata' | 'other';
  const kinds: Kind[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const after = (from: number, close: string): number => {
    const at = text.indexOf(close, from);
    return at < 0 ? n : at + close.length;
  };
  /** The end of a tag or a DOCTYPE: the `>` outside quotes (and, for a DOCTYPE, outside its `[…]`). */
  const tagEnd = (from: number, brackets: boolean): number => {
    let quote = '';
    let depth = 0;
    for (let k = from; k < n; k++) {
      const c = text[k];
      if (quote) {
        if (c === quote) quote = '';
      } else if (c === '"' || c === "'") quote = c;
      else if (brackets && c === '[') depth++;
      else if (brackets && c === ']') depth--;
      else if (c === '>' && depth <= 0) return k + 1;
    }
    return n;
  };
  while (i < n) {
    let end: number;
    let kind: Kind = 'other';
    if (text[i] !== '<') {
      const lt = text.indexOf('<', i);
      end = lt < 0 ? n : lt;
      kind = 'text';
    } else if (text.startsWith('<!--', i)) end = after(i + 4, '-->');
    else if (text.startsWith('<![CDATA[', i)) {
      end = after(i + 9, ']]>');
      kind = 'cdata';
    } else if (text.startsWith('<?', i)) end = after(i + 2, '?>');
    else if (text.startsWith('<!', i)) end = tagEnd(i + 2, true);
    else {
      end = tagEnd(i + 1, false);
      kind = text[i + 1] === '/' ? 'close' : text[end - 2] === '/' ? 'empty' : 'open';
    }
    kinds.push(kind);
    starts.push(i);
    ends.push(end);
    i = end;
  }

  const tag = (k: number): string => {
    const raw = text.slice(starts[k], ends[k]);
    if (kinds[k] === 'close') return `</${raw.slice(2, -1).trim()}>`;
    const selfClosing = kinds[k] === 'empty';
    const body = raw.slice(1, selfClosing ? -2 : -1);
    const name = /^[^\s/>]+/.exec(body)?.[0] ?? '';
    const attributes = [...body.slice(name.length).matchAll(/([^\s=]+)\s*=\s*("[^"]*"|'[^']*')/g)].map(
      m => `${m[1]}=${m[2]}`,
    );
    return `<${[name, ...attributes].join(' ')}${selfClosing ? '/>' : '>'}`;
  };

  // Each element's closing token, and whether it holds anything but whitespace.
  const close = new Array<number>(kinds.length).fill(-1);
  const stack: number[] = [];
  for (let k = 0; k < kinds.length; k++) {
    if (kinds[k] === 'open') stack.push(k);
    else if (kinds[k] === 'close') {
      const open = stack.pop();
      if (open !== undefined) close[open] = k;
    }
  }
  const isBlank = (k: number): boolean => {
    for (let c = starts[k]!; c < ends[k]!; c++) {
      const code = text.charCodeAt(c);
      if (code !== 32 && code !== 9 && code !== 10 && code !== 13) return false;
    }
    return true;
  };
  /** Direct children only: a nested element is skipped whole, so every token is looked at once by its parent. */
  const content = (k: number): 'empty' | 'inline' | 'block' => {
    const e = close[k]!;
    if (/\sxml:space\s*=\s*(?:"preserve"|'preserve')/.test(text.slice(starts[k], ends[k]))) return 'inline';
    let children = false;
    for (let m = k + 1; m < e; m++) {
      const kind = kinds[m];
      if (kind === 'text') {
        if (!isBlank(m)) return 'inline';
      } else if (kind === 'cdata') return 'inline';
      else {
        children = true;
        if (kind === 'open') m = close[m]!;
      }
    }
    return children ? 'block' : 'empty';
  };

  const out: string[] = [];
  let depth = 0;
  let length = 0;
  const line = (s: string): void => {
    length += depth * unit.length + s.length + 1;
    if (length <= limit) out.push(unit.repeat(depth) + s);
  };
  for (let k = 0; k < kinds.length; k++) {
    const kind = kinds[k];
    if (kind === 'text') continue;
    if (kind === 'open') {
      const e = close[k]!;
      if (e < 0) {
        line(tag(k));
        depth++;
        continue;
      }
      const shape = content(k);
      if (shape === 'empty') {
        line(tag(k) + tag(e));
        k = e;
      } else if (shape === 'inline') {
        line(tag(k) + text.slice(ends[k], starts[e]) + tag(e));
        k = e;
      } else {
        line(tag(k));
        depth++;
      }
    } else if (kind === 'close') {
      depth = Math.max(depth - 1, 0);
      line(tag(k));
    } else if (kind === 'empty') line(tag(k));
    else line(text.slice(starts[k], ends[k]));
    if (length > limit) return null;
  }
  return out.length === 0 ? '' : `${out.join('\n')}\n`;
};
