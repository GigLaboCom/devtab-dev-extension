/**
 * Inline event handlers (docs/tools/specs/html-to-jsx.md §5 «Атрибуты» п. 2): the attribute's code becomes the body of
 * an arrow function. The code is the person's and is not rewritten, but it must not reach outside that body — a `}}`
 * too many would end the function and the JSX expression and leave the rest as markup. So the code is scanned first,
 * as JavaScript tokens: brackets must pair up, strings, template literals, regular expressions and comments must end.
 * Code that does not is left out and named in a note. A `//` comment that runs to the end gets a line break before the
 * closing braces, which it would otherwise swallow.
 */

/** Characters that end a `//` comment (and may not stand inside a quoted string). */
const LINE_END = /[\n\r\u{2028}\u{2029}]/u;
const WORD = /[\p{ID_Continue}$\u{200C}\u{200D}]/u;
/** After these words a `/` starts a regular expression, not a division. */
const BEFORE_EXPRESSION = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'case',
  'do',
  'else',
  'yield',
  'await',
]);

export interface CodeScan {
  /** Every bracket closes, every string, template, regular expression and block comment ends. */
  balanced: boolean;
  /** The code ends inside a `//` comment. */
  lineCommentAtEnd: boolean;
}

/** Scans `code` as JavaScript tokens (§ above). Linear in the code's length. */
export const scanCode = (code: string): CodeScan => {
  const stack: string[] = [];
  /** What the last token was, for `/`: 'value' (a name, a number, `)`, `]`) or 'operator' (a regular expression may follow). */
  let last: 'value' | 'operator' = 'operator';
  const fail: CodeScan = { balanced: false, lineCommentAtEnd: false };
  let i = 0;
  const n = code.length;
  while (i < n) {
    const c = code[i]!;
    if (stack.at(-1) === '`') {
      // Inside a template literal: only `\`, the closing backtick and `${` matter.
      if (c === '\\') i += 2;
      else if (c === '`') {
        stack.pop();
        last = 'value';
        i++;
      } else if (c === '$' && code[i + 1] === '{') {
        stack.push('${');
        last = 'operator';
        i += 2;
      } else i++;
      continue;
    }
    if (c === '/' && code[i + 1] === '/') {
      let j = i + 2;
      while (j < n && !LINE_END.test(code[j]!)) j++;
      if (j >= n) return { balanced: stack.length === 0, lineCommentAtEnd: true };
      i = j;
      continue;
    }
    if (c === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2);
      if (end === -1) return fail;
      i = end + 2;
      continue;
    }
    if (c === '/' && last === 'operator') {
      // A regular expression: to the `/` outside a class, then its flags.
      let j = i + 1;
      let inClass = false;
      for (; j < n; j++) {
        const d = code[j]!;
        if (LINE_END.test(d)) return fail;
        if (d === '\\') j++;
        else if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) break;
      }
      if (j >= n) return fail;
      i = j + 1;
      while (i < n && WORD.test(code[i]!)) i++;
      last = 'value';
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      for (; j < n && code[j] !== c; j++) {
        if (code[j] === '\\') j++;
        else if (code[j] === '\n' || code[j] === '\r') return fail;
      }
      if (j >= n) return fail;
      i = j + 1;
      last = 'value';
      continue;
    }
    if (c === '`') {
      stack.push('`');
      i++;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') {
      stack.push(c);
      last = 'operator';
      i++;
      continue;
    }
    if (c === ')' || c === ']' || c === '}') {
      const open = stack.pop();
      const pairs = (c === ')' && open === '(') || (c === ']' && open === '[') || (c === '}' && open === '{');
      if (c === '}' && open === '${') {
        last = 'operator';
        i++;
        continue; // back inside the template literal
      }
      if (!pairs) return fail;
      last = c === '}' ? 'operator' : 'value';
      i++;
      continue;
    }
    if (WORD.test(c)) {
      let j = i + 1;
      while (j < n && WORD.test(code[j]!)) j++;
      const word = code.slice(i, j);
      last = BEFORE_EXPRESSION.has(word) ? 'operator' : 'value';
      i = j;
      continue;
    }
    if (!/\s/u.test(c)) last = 'operator';
    i++;
  }
  return { balanced: stack.length === 0, lineCommentAtEnd: false };
};

/**
 * The prop's value for a handler: `{() => { code }}`, with `(event)` when the code names `event`. The code loses its
 * surrounding whitespace and trailing semicolons. Null when the code is not balanced (§ above).
 */
export const handlerValue = (value: string): string | null => {
  let end = value.length;
  while (end > 0 && (value[end - 1] === ';' || /\s/u.test(value[end - 1]!))) end--;
  const code = value.slice(0, end).trim();
  const scan = scanCode(code);
  if (!scan.balanced) return null;
  if (code === '') return '{() => {}}';
  const parameter = /(?<![\p{ID_Continue}$])event(?![\p{ID_Continue}$])/u.test(code) ? '(event)' : '()';
  return `{${parameter} => { ${code}${scan.lineCommentAtEnd ? '\n' : ' '}}}`;
};
