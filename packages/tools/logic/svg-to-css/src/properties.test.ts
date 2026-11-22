// @vitest-environment jsdom
// What the tool promises and examples cannot cover, on generated inputs from a fixed seed (a failure is reproducible
// and never flaky):
// - the percent-encoding reads back — by decodeURIComponent and by the WHATWG «data: URL processor» (Node's fetch) — to
//   exactly the text it encoded, every ASCII character, astral characters and unpaired surrogates included (those
//   come back as U+FFFD, as TextEncoder and a Blob write them);
// - the whole result reads back to the prepared SVG byte for byte: URL-encoded with the attribute quotes swapped,
//   Base64 as it is;
// - the cleanup changes nothing in the document the parser builds, except the nodes it promises to drop (comments,
//   the XML declaration, a DOCTYPE without declarations, white space between elements outside text) — so nothing
//   drawn can change. That pixels are equal too is proved in Chrome by scripts/e2e-tools/svg-to-css.mjs.
import { encodeSvgPayload, minifySvg, swapAttributeQuotes, svgToCss } from '.';
import { describe, expect, it } from 'vitest';

const parse = (text: string): Document => new DOMParser().parseFromString(text, 'image/svg+xml');

/** xorshift32 from a fixed seed. */
const seeded = (seed: number) => {
  let s = seed >>> 0 || 1;
  return (n: number): number => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s % n;
  };
};

/** Bytes as hex: compared as strings (the bytes of fetch and of TextEncoder may come from different realms). */
const hex = (bytes: ArrayBuffer | Uint8Array): string => Buffer.from(bytes as ArrayBuffer).toString('hex');
/** Unpaired surrogates as U+FFFD (String.prototype.toWellFormed is ES2024; the packages compile to ES2022). */
const wellFormed = (text: string): string =>
  text.replace(/[\u{D800}-\u{DBFF}](?![\u{DC00}-\u{DFFF}])|(?<![\u{D800}-\u{DBFF}])[\u{DC00}-\u{DFFF}]/gu, '\u{FFFD}');
const fetchText = async (uri: string): Promise<string> => hex(await (await fetch(uri)).arrayBuffer());
const utf8 = (text: string): string => hex(new TextEncoder().encode(text));

describe('percent-encoding reads back exactly', () => {
  it('every ASCII character, alone and in a run', async () => {
    const all = Array.from({ length: 128 }, (_, c) => String.fromCharCode(c)).join('');
    expect(decodeURIComponent(encodeSvgPayload(all))).toBe(all);
    expect(await fetchText(`data:image/svg+xml,${encodeSvgPayload(all)}`)).toEqual(utf8(all));
  });

  it('500 random strings of any UTF-16 code units, unpaired surrogates as U+FFFD', async () => {
    const pick = seeded(0x5eed);
    const unit = (): string => {
      const r = pick(10);
      if (r < 4) return String.fromCharCode(pick(128));
      if (r < 6) return String.fromCharCode(0x80 + pick(0x800 - 0x80));
      if (r < 7) return String.fromCharCode(0x800 + pick(0xd800 - 0x800));
      if (r < 8) return String.fromCodePoint(0x10000 + pick(0x10ffff - 0x10000));
      if (r < 9) return String.fromCharCode(0xd800 + pick(0x800)); // an unpaired surrogate, high or low
      return String.fromCharCode(0xe000 + pick(0x2000));
    };
    for (let n = 0; n < 500; n++) {
      const text = Array.from({ length: 1 + pick(64) }, unit).join('');
      const payload = encodeSvgPayload(text);
      // Only printable ASCII that is not encoded stays raw; nothing else does.
      expect(payload).toMatch(/^(?:%[0-9A-F]{2}|[ !$'-;=?-[\]-~])*$/);
      expect(decodeURIComponent(payload)).toBe(wellFormed(text));
      expect(await fetchText(`data:image/svg+xml,${payload}`)).toEqual(utf8(text));
    }
  });
});

// ---- Generated SVG documents
const NAMES = ['rect', 'g', 'circle', 'path', 'text', 'tspan', 'desc', 'title', 'style', 'use', 'foreignObject'];
/** Characters an attribute value may hold raw (no `<`, `&` alone, no controls but tab / LF / CR). */
const valueChar = (pick: (n: number) => number): string => {
  const r = pick(12);
  if (r < 7) {
    const c = String.fromCharCode(0x20 + pick(95));
    return c === '<' || c === '&' ? 'x' : c;
  }
  if (r < 8) return ['\t', '\n', '\r\n', '\r'][pick(4)]!;
  if (r < 9) return ['&amp;', '&lt;', '&#10;', '&quot;', '&apos;'][pick(5)]!;
  if (r < 10) return String.fromCodePoint(0x400 + pick(0x100));
  if (r < 11) return String.fromCodePoint(0x1f600 + pick(0x40));
  return ' ';
};
const textChar = (pick: (n: number) => number): string => {
  const c = valueChar(pick);
  return c === '"' || c === "'" ? c : c;
};

const attribute = (pick: (n: number) => number): string => {
  const quote = pick(2) ? '"' : "'";
  let value = '';
  for (let i = pick(12); i > 0; i--) {
    const c = valueChar(pick);
    value += c === quote ? (quote === '"' ? '&quot;' : '&apos;') : c;
  }
  const space = () => [' ', '\n  ', '\t', '  '][pick(4)];
  return `${space()}a${pick(1000)}${pick(3) ? '' : ' '}=${pick(3) ? '' : ' '}${quote}${value}${quote}`;
};

const element = (pick: (n: number) => number, depth: number): string => {
  const name = NAMES[pick(NAMES.length)]!;
  const seen = new Set<string>();
  let attributes = '';
  for (let i = pick(4); i > 0; i--) {
    const a = attribute(pick);
    const key = a.trim().split('=')[0]!.trim();
    if (!seen.has(key)) attributes += a;
    seen.add(key);
  }
  if (name === 'foreignObject') attributes += ' xmlns:h="http://www.w3.org/1999/xhtml"';
  if (depth > 3 || pick(4) === 0) return `<${name}${attributes}${pick(2) ? ' ' : ''}/>`;
  let inner = '';
  for (let i = pick(5); i > 0; i--) {
    const r = pick(7);
    if (r < 3) inner += element(pick, depth + 1);
    else if (r < 4) inner += ['\n', '\n    ', ' ', '\t'][pick(4)];
    else if (r < 5) {
      let t = '';
      for (let j = 1 + pick(10); j > 0; j--) t += textChar(pick);
      inner += t.replaceAll('>', '&gt;');
    } else if (r < 6) inner += `<!-- c${pick(9)} -->`;
    else inner += `<![CDATA[ ${pick(9)} <x> && ]]>`;
  }
  return `<${name}${attributes}>${inner}</${name}>`;
};

const documentOf = (pick: (n: number) => number): string => {
  const prolog = [
    '',
    '<?xml version="1.0" encoding="UTF-8"?>\n',
    '<!-- generator -->\n',
    '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n',
  ][pick(4)];
  const xmlns = pick(3) ? ' xmlns="http://www.w3.org/2000/svg"' : '';
  let body = '';
  for (let i = 1 + pick(5); i > 0; i--) body += ['\n  ', ''][pick(2)] + element(pick, 0);
  return `${prolog}<svg${xmlns} viewBox="0 0 10 10">${body}\n</svg>\n`;
};

/** The document as the parser built it, without what the cleanup drops — a string to compare. */
const canonical = (doc: Document): string => {
  const keep = new Set(['text', 'foreignObject', 'style', 'script']);
  const walk = (node: Element, keeping: boolean): string => {
    const k = keeping || keep.has(node.localName);
    const attributes = Array.from(node.attributes)
      .filter(a => a.name !== 'xmlns')
      .map(a => `${a.name}=${JSON.stringify(a.value)}`)
      .join(' ');
    let children = '';
    let text = '';
    const flush = () => {
      if (text && (k || text.trim() !== '')) children += JSON.stringify(text);
      text = '';
    };
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3 || child.nodeType === 4) text += child.nodeValue ?? '';
      else if (child.nodeType === 1) {
        flush();
        children += walk(child as Element, k);
      }
      // comments and processing instructions: none survive or matter here
    }
    flush();
    return `<${node.namespaceURI ?? ''}|${node.localName} ${attributes}>${children}</>`;
  };
  return walk(doc.documentElement, false);
};

describe('generated SVG documents', () => {
  const pick = seeded(20261122);
  const docs = Array.from({ length: 300 }, () => documentOf(pick));

  it('are well-formed (the generator is right)', () => {
    for (const doc of docs) expect(parse(doc).getElementsByTagName('parsererror')).toHaveLength(0);
  });

  it('the cleanup changes nothing the parser builds but the nodes it drops', () => {
    for (const doc of docs) {
      const minified = minifySvg(doc.replace(/^\s+/, ''));
      const a = canonical(parse(minified));
      const b = canonical(parse(doc.replace(/^\s+/, '')));
      if (a !== b) {
        let i = 0;
        while (a[i] === b[i]) i++;
        expect(a.slice(i - 80, i + 80), `${doc}\n---\n${minified}`).toBe(b.slice(i - 80, i + 80));
      }
    }
  });

  it('the data: URI reads back to the prepared SVG byte for byte, in both encodings, with and without the cleanup', async () => {
    for (const doc of docs)
      for (const minify of [true, false]) {
        const url = svgToCss(doc, { output: 'data-uri', encoding: 'url', minify }, parse);
        const base64 = svgToCss(doc, { output: 'data-uri', encoding: 'base64', minify }, parse);
        if (!url.ok || !base64.ok) throw new Error(`${doc}: ${!url.ok ? url.error.message : ''}`);
        expect(base64.svg).toBe(url.svg);
        expect(await fetchText(url.dataUri)).toEqual(utf8(swapAttributeQuotes(url.svg)));
        expect(await fetchText(base64.dataUri)).toEqual(utf8(base64.svg));
        // The swapped quotes are the only difference, and the document is still the same one.
        expect(canonical(parse(swapAttributeQuotes(url.svg)))).toBe(canonical(parse(url.svg)));
        // Both sizes are the lengths of the URIs, whichever was built.
        expect(url.sizes).toEqual({ url: url.dataUri.length, base64: base64.dataUri.length });
        expect(base64.sizes).toEqual(url.sizes);
      }
  });
});
