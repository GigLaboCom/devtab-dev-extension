/**
 * Formatting with the libraries handed in (docs/tools/specs/code-format.md §5, §9): whoever loaded Prettier's modules —
 * the tool's worker in a page, the tests in Node — passes them here, so this package never imports a library and the
 * start page's `detect` and the component's chunk never carry one.
 */
import {
  LANGUAGE_LABELS,
  RESULT_TOO_LARGE_MESSAGE,
  mapPrettierError,
  positionOf,
  prettierOptions,
  printXml,
} from './logic';
import type { FormatResult, FormatSettings, Indent, PrettierErrorLike, PrettierLanguage } from './logic';

/** What of `prettier/standalone` is used. */
export interface PrettierLike {
  format: (text: string, options: Record<string, unknown>) => Promise<string>;
}

const errorLike = (error: unknown): PrettierErrorLike => {
  if (error instanceof Error || (typeof error === 'object' && error !== null && 'message' in error)) {
    const e = error as { name?: unknown; message?: unknown; loc?: PrettierErrorLike['loc'] };
    return { name: typeof e.name === 'string' ? e.name : undefined, message: String(e.message), loc: e.loc };
  }
  return { message: String(error) };
};

/** §5 п. 1, 6, 10: the formatted text with Prettier, or the error with its place. Empty or blank input — empty. */
export const formatWithPrettier = async (
  prettier: PrettierLike,
  plugins: readonly unknown[],
  language: PrettierLanguage,
  text: string,
  settings: FormatSettings,
): Promise<FormatResult> => {
  if (text.trim() === '') return { ok: true, text: '' };
  try {
    return { ok: true, text: await prettier.format(text, { ...prettierOptions(language, settings), plugins }) };
  } catch (error) {
    return { ok: false, error: mapPrettierError(text, errorLike(error)) };
  }
};

/** What of saxes' `SaxesParser` is used: well-formedness only (no namespaces), with positions. */
export interface SaxParser {
  ENTITIES: Record<string, string>;
  readonly position: number;
  on(event: 'doctype', handler: (doctype: string) => void): void;
  on(event: 'error', handler: (error: Error) => void): void;
  write(chunk: string): SaxParser;
  close(): SaxParser;
}
export type SaxParserClass = new (options: { xmlns: false; position: true }) => SaxParser;

const ENTITY = /<!ENTITY\s+([A-Za-z_][\w.-]*)\s+(?:"([^"]*)"|'([^']*)')\s*>/g;

/**
 * §5 п. 9: XML checked by saxes (XML 1.0 well-formedness, no DTD validation) and printed by `printXml`. Entities of the
 * internal subset are declared to the parser when it reports the DOCTYPE (saxes reads no DTD). The first error: saxes'
 * text without its `L:C: ` prefix and final full stop, at the parser's position when it failed — just after the
 * construct it stumbled on.
 */
export const formatXml = (Parser: SaxParserClass, text: string, indent: Indent): FormatResult => {
  if (text.trim() === '') return { ok: true, text: '' };
  const parser = new Parser({ xmlns: false, position: true });
  let failure: { message: string; position: number } | null = null;
  parser.on('doctype', doctype => {
    for (const m of doctype.matchAll(ENTITY)) parser.ENTITIES[m[1]!] = m[2] ?? m[3] ?? '';
  });
  parser.on('error', error => {
    failure ??= {
      message: error.message.replace(/^\d+:\d+: /, '').replace(/\.$/, ''),
      position: parser.position,
    };
    // Stop at the first error: saxes would go on and report what follows from it.
    throw error;
  });
  try {
    parser.write(text).close();
  } catch (error) {
    failure ??= { message: error instanceof Error ? error.message : String(error), position: parser.position };
  }
  if (failure !== null) {
    const { message, position } = failure;
    const offset = Math.min(position, text.length);
    return { ok: false, error: { message, offset, ...positionOf(text, offset) } };
  }
  // Line ends of the result are `\n` (§3), also inside content kept as written; the places above are the input's own.
  const printed = printXml(text.replace(/\r\n?/g, '\n'), indent);
  return printed === null ? { ok: false, error: { message: RESULT_TOO_LARGE_MESSAGE } } : { ok: true, text: printed };
};

/** `JavaScript · 12 lines`: what a formatted text is, for a status or a history label. */
export const describeText = (language: PrettierLanguage | 'xml', text: string): string => {
  let lines = text === '' ? 0 : 1;
  for (let i = text.indexOf('\n'); i !== -1 && i < text.length - 1; i = text.indexOf('\n', i + 1)) lines++;
  return `${LANGUAGE_LABELS[language]} · ${lines.toLocaleString('en-US')} ${lines === 1 ? 'line' : 'lines'}`;
};
