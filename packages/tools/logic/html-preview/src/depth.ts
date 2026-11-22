/**
 * How deep the HTML parser's stack of open elements will grow on this markup — before the markup reaches the parser
 * (docs/tools/specs/html-preview.md §12, §15). Chrome's parser spends time on every token in proportion to that depth
 * (its DOM stops nesting at 512 levels, the stack does not): measured in the built extension, 40 000 nested <div> took
 * 2 s in DOMParser, a megabyte of them 100 s; `<b><div></b>` repeated 20 000 times — 8.6 s. The tool refuses markup that
 * would nest deeper than MAX_DEPTH, which bounds the parse of a megabyte to well under a second.
 *
 * A linear scan that follows the tree builder of the HTML standard closely enough to bound the depth from above for
 * real documents and for the known ways to grow it: tags, comments, raw text, the elements a start tag closes (p, li,
 * dd, dt, cells, rows, options, headings, buttons), the active formatting elements and their reconstruction (`<b><p>…`
 * reopens `b` in every paragraph), the adoption agency's furthest block (`<b><div></b>` keeps `div` open), SVG and
 * MathML with their self-closing tags and the HTML tags that break out of them, implied table sections and rows. Pure:
 * no DOM.
 */

/** The deepest nesting the tool previews (§12): Chrome's own DOM stops at 512 levels. */
export const MAX_DEPTH = 512;

const VOID = new Set(
  'area base basefont bgsound br col embed frame hr img input keygen link meta param source track wbr image'.split(' '),
);
const RAW = new Set('script style textarea title xmp iframe noembed noframes'.split(' '));
const FORMATTING = new Set('a b big code em font i nobr s small strike strong tt u'.split(' '));
const SPECIAL_HTML = new Set(
  (
    'address applet area article aside base basefont bgsound blockquote body br button caption center col colgroup dd ' +
    'details dir div dl dt embed fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header ' +
    'hgroup hr html iframe img input keygen li link listing main marquee menu meta nav noembed noframes noscript object ' +
    'ol p param plaintext pre script search section select source style summary table tbody td template textarea tfoot ' +
    'th thead title tr track ul wbr xmp'
  ).split(' '),
);
const SPECIAL_MATH = new Set(['mi', 'mo', 'mn', 'ms', 'mtext', 'annotation-xml']);
const SPECIAL_SVG = new Set(['foreignobject', 'desc', 'title']);
/** Start tags that close an open <p> (and do not reconstruct the formatting elements). */
const BLOCK = new Set(
  (
    'address article aside blockquote center details dialog dir div dl fieldset figcaption figure footer header hgroup ' +
    'main menu nav ol p search section summary ul h1 h2 h3 h4 h5 h6 pre listing form table hr li dd dt plaintext xmp'
  ).split(' '),
);
const HEADINGS = new Set('h1 h2 h3 h4 h5 h6'.split(' '));
const MARKERS = new Set('td th caption applet marquee object template'.split(' '));
const SCOPE_HTML = new Set('applet caption html table td th marquee object template'.split(' '));
const BREAKOUT = new Set(
  (
    'b big blockquote body br center code dd div dl dt em embed h1 h2 h3 h4 h5 h6 head hr i img li listing menu meta ' +
    'nobr ol p pre ruby s small span strong strike sub sup table tt u ul var'
  ).split(' '),
);
/** Where SVG or MathML lets HTML in again: SVG's HTML integration points, MathML's text integration points. */
const SVG_INTEGRATION = new Set(['foreignobject', 'desc', 'title']);
const MATH_INTEGRATION = new Set(['mi', 'mo', 'mn', 'ms', 'mtext']);
/** annotation-xml lets HTML in only when it says its content is HTML. */
const HTML_ENCODING = /\bencoding\s*=\s*["']?\s*(?:text\/html|application\/xhtml\+xml)\s*["'>\s]/i;
const SECTIONS = new Set(['tbody', 'thead', 'tfoot']);
const TABLE_PARTS = new Set(['td', 'th', 'tr', 'tbody', 'thead', 'tfoot', 'caption', 'col', 'colgroup']);
/** End tags the tree builder closes when the element is in scope (the rest: the nearest open one, up to a special). */
const END_IN_SCOPE = new Set(
  (
    'address article aside blockquote button center details dialog dir div dl fieldset figcaption figure footer header ' +
    'hgroup listing main menu nav ol pre search section summary ul p li dd dt h1 h2 h3 h4 h5 h6 applet marquee object ' +
    'table tbody thead tfoot tr td th caption select'
  ).split(' '),
);
/** In a select, the parser ignores these start tags (a newer select parser may not: then the scan counts more). */
const RAW_IN_SELECT = new Set(['script', 'textarea']);

interface Open {
  name: string;
  /** The element's namespace, as far as the parser is concerned. */
  ns: 'html' | 'svg' | 'math';
  /** Do its children parse as SVG or MathML? */
  foreign: boolean;
}
type Formatting = { key: string; name: string; open: Open | null } | 'marker';

/** The tree builder's "special" category, by namespace. */
const isSpecial = (o: Open): boolean =>
  o.ns === 'html' ? SPECIAL_HTML.has(o.name) : o.ns === 'math' ? SPECIAL_MATH.has(o.name) : SPECIAL_SVG.has(o.name);

const isLetter = (c: number): boolean => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
const isSpace = (c: number): boolean => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d;

/**
 * Where a script's text ends: its `</script`, the tokenizer's escaped states honoured (`<!--` and a `<script` inside
 * it make the next `</script>` part of the text).
 */
const scriptEnd = (html: string, from: number): number => {
  const tag = /<!--|-->|<\/?script(?=[\t\n\f\r />])/gi;
  tag.lastIndex = from;
  let state: 'data' | 'escaped' | 'double' = 'data';
  for (let m = tag.exec(html); m; m = tag.exec(html)) {
    const t = m[0].toLowerCase();
    if (t === '<!--') {
      // `<!-->` and `<!--->` open and close at once
      const after = html.slice(m.index + 4, m.index + 6);
      if (state === 'data' && !after.startsWith('>') && after !== '->') state = 'escaped';
    } else if (t === '-->') state = 'data';
    else if (t === '<script') {
      if (state === 'escaped') state = 'double';
    } else if (state === 'double') state = 'escaped';
    else return m.index;
  }
  return html.length;
};

/**
 * The deepest the parser's stack of open elements gets on `html`, counting <html> and <body>; the scan stops as soon
 * as it passes `limit` (the answer is then more than `limit`).
 */
export const nestingDepth = (html: string, limit = MAX_DEPTH): number => {
  const stack: Open[] = [];
  const afl: Formatting[] = [];
  let deepest = 2;
  const n = html.length;
  const top = (): Open | undefined => stack[stack.length - 1];
  const inForeign = (): boolean => top()?.foreign ?? false;
  // How many of each name are open: most lookups end here, without walking the stack.
  const count = new Map<string, number>();
  const counted = (name: string, by: number): void => void count.set(name, (count.get(name) ?? 0) + by);
  const push = (name: string, ns: Open['ns'] = 'html', attributes = ''): Open => {
    const foreign =
      ns === 'svg'
        ? !SVG_INTEGRATION.has(name)
        : ns === 'math'
          ? !MATH_INTEGRATION.has(name) && !(name === 'annotation-xml' && HTML_ENCODING.test(`${attributes} `))
          : false;
    const open = { name, ns, foreign };
    stack.push(open);
    counted(name, 1);
    if (stack.length + 2 > deepest) deepest = stack.length + 2;
    return open;
  };
  const indexOf = (name: string, stop?: (o: Open) => boolean): number => {
    if (!count.get(name)) return -1;
    for (let k = stack.length - 1; k >= 0; k--) {
      if (stack[k]!.name === name) return k;
      if (stop?.(stack[k]!)) return -1;
    }
    return -1;
  };
  const popTo = (index: number): void => {
    while (stack.length > index) {
      const gone = stack.pop()!;
      counted(gone.name, -1);
      for (const f of afl) if (f !== 'marker' && f.open === gone) f.open = null;
      if (MARKERS.has(gone.name)) {
        // the list of active formatting elements up to its last marker goes with the cell, caption or object
        while (afl.length > 0 && afl.pop() !== 'marker');
      }
    }
  };
  /** The tree builder's "has an element in scope": stops at the scope's boundaries, by namespace. */
  const inScope = (name: string, extra?: Set<string>): number =>
    indexOf(
      name,
      o =>
        (o.ns === 'html' && (SCOPE_HTML.has(o.name) || (extra?.has(o.name) ?? false))) ||
        (o.ns === 'math' && SPECIAL_MATH.has(o.name)) ||
        (o.ns === 'svg' && SPECIAL_SVG.has(o.name)),
    );
  const BUTTON = new Set(['button']);
  const LIST = new Set(['ol', 'ul']);
  const closeP = (): void => {
    const p = inScope('p', BUTTON);
    if (p >= 0) popTo(p);
  };
  const reconstruct = (): void => {
    let k = afl.length;
    while (k > 0) {
      const f = afl[k - 1]!;
      if (f === 'marker' || f.open) break;
      k--;
    }
    for (; k < afl.length; k++) {
      const f = afl[k] as Exclude<Formatting, 'marker'>;
      f.open = push(f.name);
    }
  };
  /** The adoption agency for an end tag (or an `a`/`nobr` start tag) of formatting element `name`. */
  const adopt = (name: string): boolean => {
    let at = afl.length - 1;
    for (; at >= 0; at--) {
      const f = afl[at]!;
      if (f === 'marker') return false;
      if (f.name === name) break;
    }
    if (at < 0) return false;
    const entry = afl[at] as Exclude<Formatting, 'marker'>;
    if (!entry.open) {
      afl.splice(at, 1);
      return true;
    }
    const index = stack.indexOf(entry.open);
    const furthest = stack.slice(index + 1).some(isSpecial);
    if (furthest) {
      // The block stays open and gets a copy of the formatting element inside it: the stack is as deep as before.
      stack.splice(index, 1);
      counted(name, -1);
      entry.open = push(name);
    } else {
      popTo(index);
      afl.splice(at, 1);
    }
    return true;
  };
  const endTag = (name: string): void => {
    if (inForeign()) {
      if (name === 'p' || name === 'br') {
        // these end tags leave the foreign content, then act as in HTML
        while (stack.length > 0 && top()!.foreign) popTo(stack.length - 1);
      } else {
        // the nearest foreign element of that name; an HTML element first: the end tag acts as in HTML
        let k = stack.length - 1;
        for (; k >= 0 && stack[k]!.ns !== 'html'; k--)
          if (stack[k]!.name === name) {
            popTo(k);
            return;
          }
      }
    }
    // in a select, the parser ignores every end tag but its own and its options' (a newer select parser may not)
    if (count.get('select') && name !== 'select' && name !== 'option' && name !== 'optgroup') return;
    if (FORMATTING.has(name) && adopt(name)) return;
    if (name === 'html' || name === 'body') return; // never opened here
    // a frameset nests in a frameset document, and is ignored in a body: closed only when it is the current element
    if (name === 'frameset') {
      if (top()?.name === 'frameset') popTo(stack.length - 1);
      return;
    }
    if (name === 'form') {
      // `</form>` takes the form out of the stack and leaves what is open inside it open — and inside it in the DOM:
      // counted as still open then (the DOM keeps the depth), closed when it is the current element
      if (top()?.name === 'form' && top()!.ns === 'html') popTo(stack.length - 1);
      return;
    }
    if (END_IN_SCOPE.has(name)) {
      const k = inScope(name, name === 'p' ? BUTTON : name === 'li' ? LIST : undefined);
      if (k >= 0) popTo(k);
      return;
    }
    // any other end tag: the nearest open element of that name, unless a special element comes first
    const k = indexOf(name, isSpecial);
    if (k >= 0) popTo(k);
  };
  const startTag = (name: string, attributes: string, selfClosing: boolean): void => {
    const current = top();
    if (current?.ns === 'math' && !current.foreign && (name === 'mglyph' || name === 'malignmark')) {
      if (!selfClosing) push(name, 'math', attributes);
      return;
    }
    if (inForeign()) {
      if (BREAKOUT.has(name) || (name === 'font' && /\b(color|face|size)\s*=/i.test(attributes))) {
        // back to HTML: everything opened since the foreign content began closes
        while (stack.length > 0 && top()!.foreign) popTo(stack.length - 1);
      } else {
        // a foreign element takes its parent's namespace; only an annotation-xml's <svg> is SVG in MathML
        const parent = top()!;
        const ns = name === 'svg' && parent.ns === 'math' && parent.name === 'annotation-xml' ? 'svg' : parent.ns;
        if (!selfClosing) push(name, ns === 'html' ? 'svg' : ns, attributes);
        return;
      }
    }
    if (name === 'html' || name === 'body' || name === 'head') return;
    // a cell, row, section, caption or column outside any table: the parser ignores it
    if (TABLE_PARTS.has(name) && indexOf('table') < 0) return;
    // a table closes an open <p> only in a document with the standard doctype (DOMParser: quirks mode without one)
    if (BLOCK.has(name) && (name !== 'table' || noQuirks)) closeP();
    if (HEADINGS.has(name) && HEADINGS.has(top()?.name ?? '')) popTo(stack.length - 1);
    if (name === 'li' || name === 'dd' || name === 'dt') {
      // the nearest open item, unless a special element other than address, div or p comes first
      const items = name === 'li' ? ['li'] : ['dd', 'dt'];
      for (let k = stack.length - 1; k >= 0; k--) {
        const o = stack[k]!;
        if (o.ns === 'html' && items.includes(o.name)) {
          popTo(k);
          break;
        }
        if (isSpecial(o) && !(o.ns === 'html' && (o.name === 'address' || o.name === 'div' || o.name === 'p'))) break;
      }
    } else if (name === 'td' || name === 'th' || name === 'tr' || SECTIONS.has(name)) {
      const table = indexOf('table');
      const within = (k: number): boolean => k > table;
      const cell = Math.max(indexOf('td'), indexOf('th'));
      if (within(cell)) popTo(cell);
      if (name !== 'td' && name !== 'th') {
        const row = indexOf('tr');
        if (within(row)) popTo(row);
      }
      if (SECTIONS.has(name)) {
        const section = Math.max(indexOf('tbody'), indexOf('thead'), indexOf('tfoot'));
        if (within(section)) popTo(section);
      }
      // the sections and rows the parser adds by itself
      if (table >= 0 && name !== 'tr' && !SECTIONS.has(name) && !within(indexOf('tr'))) {
        if (!within(Math.max(indexOf('tbody'), indexOf('thead'), indexOf('tfoot')))) push('tbody');
        push('tr');
      } else if (table >= 0 && name === 'tr' && !within(Math.max(indexOf('tbody'), indexOf('thead'), indexOf('tfoot'))))
        push('tbody');
    } else if (name === 'option') {
      if (top()?.name === 'option') popTo(stack.length - 1);
    } else if (name === 'optgroup') {
      if (top()?.name === 'option') popTo(stack.length - 1);
      if (top()?.name === 'optgroup') popTo(stack.length - 1);
    } else if (name === 'button') {
      const k = inScope('button');
      if (k >= 0) popTo(k);
    } else if (name === 'a' || name === 'nobr') {
      adopt(name);
    }
    // every other start tag reopens the formatting elements first (applet, marquee and object too)
    if (!BLOCK.has(name) && !TABLE_PARTS.has(name) && name !== 'template') reconstruct();
    if (VOID.has(name)) return;
    const open = push(name, name === 'svg' ? 'svg' : name === 'math' ? 'math' : 'html', attributes);
    if ((name === 'svg' || name === 'math') && selfClosing) popTo(stack.length - 1);
    if (MARKERS.has(name)) afl.push('marker');
    if (FORMATTING.has(name)) {
      const key = `${name} ${attributes.trim()}`;
      // Noah's Ark: at most three identical entries after the last marker
      let same = 0;
      for (let k = afl.length - 1; k >= 0 && afl[k] !== 'marker'; k--) {
        const f = afl[k] as Exclude<Formatting, 'marker'>;
        if (f.key === key && ++same === 3) {
          afl.splice(k, 1);
          break;
        }
      }
      afl.push({ key, name, open });
    }
  };

  const noQuirks = /^\s*(?:<!--[^]*?-->\s*)*<!doctype\s+html\s*>/i.test(html.slice(0, 4096));
  let i = 0;
  while (i < n && deepest <= limit) {
    const lt = html.indexOf('<', i);
    const textEnd = lt === -1 ? n : lt;
    for (let k = i; k < textEnd; k++)
      if (!isSpace(html.charCodeAt(k))) {
        if (!inForeign()) reconstruct();
        break;
      }
    if (lt === -1) break;
    const next = html.charCodeAt(lt + 1);
    if (html.startsWith('<!--', lt)) {
      // `<!-->` and `<!--->` end at once; otherwise `-->`, or `--!>`, whichever comes first
      if (html.startsWith('>', lt + 4)) i = lt + 5;
      else if (html.startsWith('->', lt + 4)) i = lt + 6;
      else {
        const end = html.indexOf('--', lt + 4);
        let at = end;
        while (at !== -1 && !html.startsWith('-->', at) && !html.startsWith('--!>', at))
          at = html.indexOf('--', at + 1);
        i = at === -1 ? n : at + (html.startsWith('-->', at) ? 3 : 4);
      }
      continue;
    }
    // CDATA in SVG or MathML (in a select, where the older parser ignores an <svg>, a bogus comment as in HTML)
    if (inForeign() && !count.get('select') && html.startsWith('<![CDATA[', lt)) {
      const end = html.indexOf(']]>', lt + 9);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (next === 0x21 /* ! */ || next === 0x3f /* ? */) {
      const end = html.indexOf('>', lt + 2);
      i = end === -1 ? n : end + 1;
      continue;
    }
    const closing = next === 0x2f;
    const nameStart = closing ? lt + 2 : lt + 1;
    if (!isLetter(html.charCodeAt(nameStart))) {
      if (closing) {
        // `</` and no letter: a bogus comment up to `>`
        const end = html.indexOf('>', lt + 2);
        i = end === -1 ? n : end + 1;
      } else i = lt + 1;
      continue;
    }
    let k = nameStart;
    while (k < n) {
      const c = html.charCodeAt(k);
      if (isSpace(c) || c === 0x2f || c === 0x3e) break;
      k++;
    }
    const name = html.slice(nameStart, k).toLowerCase();
    // the attributes, quotes honoured, up to `>`
    const attrStart = k;
    let quote = 0;
    let last = 0;
    for (; k < n; k++) {
      const c = html.charCodeAt(k);
      if (quote) {
        if (c === quote) quote = 0;
      } else if (c === 0x22 || c === 0x27) {
        // a quote opens a value only after `=` (and spaces)
        let b = k - 1;
        while (b > attrStart && isSpace(html.charCodeAt(b))) b--;
        if (html.charCodeAt(b) === 0x3d) quote = c;
      } else if (c === 0x3e) break;
      if (!isSpace(c)) last = c;
    }
    const attributes = html.slice(attrStart, k);
    i = k + 1;
    if (closing) {
      endTag(name);
      continue;
    }
    const selfClosing = last === 0x2f;
    if (!inForeign() && count.get('select') && (name === 'plaintext' || (RAW.has(name) && !RAW_IN_SELECT.has(name))))
      continue; // ignored in a select: what follows is markup still
    if (name === 'plaintext' && !inForeign()) {
      startTag(name, attributes, false);
      break;
    }
    if (name === 'script' && !inForeign()) {
      startTag(name, attributes, false);
      i = scriptEnd(html, i);
      continue;
    }
    if (RAW.has(name) && !inForeign()) {
      startTag(name, attributes, false);
      const close = new RegExp(`</${name}`, 'gi');
      close.lastIndex = i;
      const end = close.exec(html);
      i = end ? end.index : n;
      continue;
    }
    startTag(name, attributes, selfClosing);
  }
  return deepest;
};
