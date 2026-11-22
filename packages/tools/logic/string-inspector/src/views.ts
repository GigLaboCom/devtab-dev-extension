/**
 * What the page shows of the first part of the text (docs/tools/specs/string-inspector.md §5.4, §5.6) and the texts it
 * copies or says (§3, §5.5): the visible text with markers, the table by code point, the summary as lines, the table as
 * TSV and the warnings as sentences. Grapheme numbers come from `Intl.Segmenter`, read lazily — only as far as the
 * limit — so a megabyte costs no more here than the first ten thousand code points.
 */
import {
  categoryName,
  categoryOf,
  codePointLabel,
  hasPictographic,
  invisibleKindOf,
  isEmojiPart,
  lookalikeOf,
  markerOf,
  scriptOf,
} from './kinds.ts';
import { MAX_ROWS, MAX_VISIBLE, MAX_WORD_SHOWN } from './limits.ts';
import { bytesToHex } from '@workspace/tools-shared/hex';
import type { Summary, Warnings } from './inspect.ts';
import type { InvisibleKind } from './kinds.ts';
import type { NameTable } from './names.ts';

export interface CodePointRow {
  /** 1-based grapheme number. */
  grapheme: number;
  codePoint: number;
  /** One code point, or one lone surrogate unit. */
  char: string;
  name: string | null;
  /** Two-letter General_Category, e.g. 'Ll'. */
  category: string;
  script: string;
  utf8: Uint8Array;
  utf16: readonly number[];
  escape: string;
  invisible: InvisibleKind | null;
  /** The marker of §5.3 when invisible. */
  marker: string | null;
  /** The ASCII look-alike of §5.5, or null. */
  lookalike: string | null;
}

export type VisiblePart = { text: string } | { marker: string; name: string | null; codePoint: number };

const GRAPHEMES = new Intl.Segmenter('en', { granularity: 'grapheme' });

/** The UTF-8 bytes of one code point; a lone surrogate is U+FFFD, `EF BF BD` (as TextEncoder writes it). */
export const utf8Of = (cp: number): Uint8Array => {
  if (cp >= 0xd800 && cp <= 0xdfff) return Uint8Array.of(0xef, 0xbf, 0xbd);
  if (cp < 0x80) return Uint8Array.of(cp);
  if (cp < 0x800) return Uint8Array.of(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
  if (cp < 0x10000) return Uint8Array.of(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  return Uint8Array.of(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
};

const hex4 = (unit: number): string => unit.toString(16).toUpperCase().padStart(4, '0');

/** `é` up to U+FFFF (a lone surrogate too), `\u{1F44D}` above; hex in upper case. */
export const escapeOf = (cp: number): string =>
  cp > 0xffff ? `\\u{${cp.toString(16).toUpperCase()}}` : `\\u${hex4(cp)}`;

/**
 * Walks the code points of the first graphemes, `limit` code points at most: each with its grapheme number and whether
 * it is invisible there (§5.4: ZWJ, VS1–VS16 and tag characters inside a grapheme with an emoji are part of it).
 */
const walk = (
  text: string,
  limit: number,
  visit: (cp: number, char: string, grapheme: number, kind: InvisibleKind | null) => void,
): void => {
  if (limit <= 0) return;
  let count = 0;
  let grapheme = 0;
  for (const { segment } of GRAPHEMES.segment(text)) {
    grapheme++;
    let emoji: boolean | null = null;
    for (let i = 0; i < segment.length;) {
      const cp = segment.codePointAt(i)!;
      const width = cp > 0xffff ? 2 : 1;
      let kind = invisibleKindOf(cp);
      if (kind !== null && isEmojiPart(cp)) {
        emoji ??= hasPictographic(segment);
        if (emoji) kind = null;
      }
      visit(cp, segment.slice(i, i + width), grapheme, kind);
      i += width;
      if (++count >= limit) return;
    }
  }
};

/** A row per code point of the first `limit` (§5.6); names from the table when it is given, otherwise null. */
export const rows = (text: string, limit: number = MAX_ROWS, names?: NameTable): CodePointRow[] => {
  const out: CodePointRow[] = [];
  walk(text, limit, (cp, char, grapheme, kind) => {
    out.push({
      grapheme,
      codePoint: cp,
      char,
      name: names?.get(cp) ?? null,
      category: categoryOf(cp),
      script: scriptOf(cp),
      utf8: utf8Of(cp),
      utf16: cp > 0xffff ? [0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 0x3ff)] : [cp],
      escape: escapeOf(cp),
      invisible: kind,
      marker: kind === null ? null : markerOf(cp),
      lookalike: lookalikeOf(cp),
    });
  });
  return out;
};

/**
 * The visible text of the first `limit` code points (§5.4): visible code points as they are, joined into runs; every
 * invisible one a marker part — the bidirectional controls too, so none of them ever reaches the page. `\n` stays a
 * line break.
 */
export const visibleParts = (text: string, limit: number = MAX_VISIBLE, names?: NameTable): VisiblePart[] => {
  const parts: VisiblePart[] = [];
  let run = '';
  walk(text, limit, (cp, char, _grapheme, kind) => {
    if (kind === null || cp === 0x0a) {
      run += char;
      return;
    }
    if (run !== '') parts.push({ text: run });
    run = '';
    parts.push({ marker: markerOf(cp), name: names?.get(cp) ?? null, codePoint: cp });
  });
  if (run !== '') parts.push({ text: run });
  return parts;
};

/** A word quoted in a warning: its visible parts, at most MAX_WORD_SHOWN code points, and whether it was cut. */
export const wordParts = (word: string): { parts: VisiblePart[]; cut: boolean } => {
  const parts = visibleParts(word, MAX_WORD_SHOWN);
  let shown = 0;
  for (const p of parts) shown += 'text' in p ? [...p.text].length : 1;
  return { parts, cut: shown < [...word].length };
};

/** The plain-text form of visible parts: markers in brackets, `[ZWSP]`. */
export const partsText = (parts: readonly VisiblePart[]): string =>
  parts.map(p => ('text' in p ? p.text : `[${p.marker}]`)).join('');

const number = (n: number): string => n.toLocaleString('en-US');

/** The summary's names, in the order of §3 and §8. */
export const SUMMARY_LABELS: ReadonlyArray<readonly [keyof Summary, string]> = [
  ['graphemes', 'Characters'],
  ['codePoints', 'Code points'],
  ['utf16Units', 'UTF-16 code units'],
  ['utf8Bytes', 'UTF-8 bytes'],
  ['utf16Bytes', 'UTF-16 bytes'],
  ['words', 'Words'],
  ['lines', 'Lines'],
  ['normalization', 'Normalization'],
];

/** A summary value as shown: numbers with `,` between thousands. */
export const summaryValue = (s: Summary, key: keyof Summary): string => {
  const v = s[key];
  return typeof v === 'number' ? number(v) : v;
};

/** What Copy summary copies: `Characters: 10` lines joined by `\n`, as shown. */
export const summaryText = (s: Summary): string =>
  SUMMARY_LABELS.map(([key, label]) => `${label}: ${summaryValue(s, key)}`).join('\n');

/** The table's columns, in order (§5.6). */
export const TABLE_COLUMNS = ['#', 'Char', 'Code point', 'Name', 'Category', 'Script', 'UTF-8', 'UTF-16', 'Escape'];

/** The `Char` cell: the marker of an invisible code point; a mark (`\p{M}`) on a dotted circle U+25CC; else itself. */
export const charCell = (row: CodePointRow): string =>
  row.marker ?? (row.category.startsWith('M') ? `\u{25CC}${row.char}` : row.char);

/** A row's cells as the table and the TSV show them. */
export const rowCells = (row: CodePointRow): string[] => [
  String(row.grapheme),
  charCell(row),
  codePointLabel(row.codePoint),
  row.name ?? '\u{2014}',
  categoryName(row.category),
  row.script,
  bytesToHex(row.utf8, { format: 'spaced', uppercase: true }),
  row.utf16.map(hex4).join(' '),
  row.escape,
];

/** What Copy table copies: a header line, then a line per row; fields joined by `\t`, lines by `\n`. */
export const tableTsv = (shown: readonly CodePointRow[]): string =>
  [TABLE_COLUMNS, ...shown.map(rowCells)].map(cells => cells.join('\t')).join('\n');

const plural = (n: number, one: string, many: string): string => `${number(n)} ${n === 1 ? one : many}`;
const counted = (label: string, count: number): string => (count > 1 ? `${label} \u{D7}${number(count)}` : label);
/** At most `max` items joined by `, `, then ` and k more kinds`. */
const listed = (items: string[], max: number): string => {
  const shown = items.slice(0, max).join(', ');
  const more = items.length - max;
  return more > 0 ? `${shown} and ${plural(more, 'more kind', 'more kinds')}` : shown;
};

/** How many different words the mixed-script warning quotes. */
export const MAX_MIXED_WORDS = 3;

/** The first MAX_MIXED_WORDS different words that mix scripts, in the order they appear (the count is of all). */
export const quotedMixedWords = (w: Warnings): Warnings['mixedScripts'] => {
  const seen = new Set<string>();
  const out: Warnings['mixedScripts'] = [];
  for (const m of w.mixedScripts) {
    if (seen.has(m.word)) continue;
    seen.add(m.word);
    out.push(m);
    if (out.length === MAX_MIXED_WORDS) break;
  }
  return out;
};
const MAX_KINDS = 5;

/**
 * The English sentences of §5.5, in order. A quoted word is the plain form of its visible parts (`[RLO]` for a
 * marker), at most MAX_WORD_SHOWN code points and `…`: a page renders words itself, from `wordParts`, never from here.
 */
export const warningLines = (w: Warnings): string[] => {
  const lines: string[] = [];
  const invisible = w.invisible.reduce((n, x) => n + x.count, 0);
  if (invisible > 0)
    lines.push(
      `${plural(invisible, 'invisible character', 'invisible characters')}: ${listed(
        w.invisible.map(x => counted(x.marker, x.count)),
        MAX_KINDS,
      )}.`,
    );
  if (w.bidi.length > 0)
    lines.push(`Bidirectional controls (${w.bidi.join(', ')}) can change the order in which text is displayed.`);
  if (w.mixedScripts.length > 0) {
    const words = quotedMixedWords(w).map(m => {
      const { parts, cut } = wordParts(m.word);
      return `"${partsText(parts)}${cut ? '\u{2026}' : ''}" (${m.scripts.join(', ')})`;
    });
    lines.push(`Mixed scripts in ${plural(w.mixedScripts.length, 'word', 'words')}: ${words.join(', ')}.`);
  }
  const lookalikes = w.lookalikes.reduce((n, x) => n + x.count, 0);
  if (lookalikes > 0)
    lines.push(
      `${lookalikes === 1 ? '1 character looks' : `${number(lookalikes)} characters look`} like ASCII: ${listed(
        w.lookalikes.map(x => `${x.char} \u{2192} ${x.ascii}`),
        MAX_KINDS,
      )}.`,
    );
  if (w.loneSurrogates > 0)
    lines.push(
      `${plural(w.loneSurrogates, 'lone surrogate', 'lone surrogates')}: not valid Unicode. UTF-8 counts each as U+FFFD (3 bytes).`,
    );
  const unusual = w.privateOrUnassigned.reduce((n, x) => n + x.count, 0);
  if (unusual > 0)
    lines.push(
      `${unusual === 1 ? '1 code point is' : `${number(unusual)} code points are`} private-use, unassigned or noncharacters: ${listed(
        w.privateOrUnassigned.map(x => codePointLabel(x.codePoint)),
        MAX_KINDS,
      )}.`,
    );
  return lines;
};
