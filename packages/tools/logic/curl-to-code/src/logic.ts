/**
 * The cURL to Code tool's logic (docs/tools/specs/curl-to-code.md §9): a curl command to the code of one of seventeen
 * clients. Pure: no React, no DOM, no chrome, no network — the command is text, its address is never fetched or
 * resolved, and nothing is run. The words are read as a shell reads them (words.ts), the request as curl builds it
 * (parse.ts), the code by one writer per client (clients/, loaded on first need by load.ts) whose literals are written per
 * language (literals/).
 */
import { parseCurl } from './parse';
import { splitWords } from './words';
import { errorAt } from '@workspace/tools-shared/json-scan';
import type { CodeResult, Generator } from './types';

/** Up to this many characters the result follows every change; above it, Convert (§12). */
export const LIVE_INPUT = 1024 * 1024;
/** Above this many characters the input is refused (§12). */
export const MAX_INPUT = 16 * 1024 * 1024;

export const SHELL_VARIABLES = 'Shell variables and $(…) are not expanded; they stay in the code as written.';
export const CREDENTIALS_NOTE = 'The code contains credentials from the command. Do not share it as is.';

/** The rest of a paste after the command, as the warning shows it: blanks folded, 20 characters at most. */
const restShown = (rest: string): string => {
  const folded = rest.replace(/\s+/g, ' ');
  const chars = Array.from(folded);
  return chars.length > 20 ? `${chars.slice(0, 20).join('')}…` : folded;
};

const CREDENTIAL_HEADERS = new Set(['authorization', 'cookie', 'proxy-authorization']);

/** The code of one client (its writer from loadGenerator) for a command. */
export const curlToCode = (text: string, generator: Generator): CodeResult => {
  if (text.trim() === '') return { ok: true, text: '', warnings: [], hasCredentials: false };
  const words = splitWords(text);
  if (!words.ok) return { ok: false, error: errorAt(text, words.message, words.offset) };
  if (words.words.length === 0) return { ok: true, text: '', warnings: [], hasCredentials: false };
  const parsed = parseCurl(words.words);
  if (!parsed.ok) return { ok: false, error: errorAt(text, parsed.message, parsed.offset) };
  const code = generator.generate(parsed.request);
  const warnings = new Set<string>();
  const add = (w: string): void => void warnings.add(w);
  if (words.expansions) add(SHELL_VARIABLES);
  parsed.warnings.forEach(add);
  if (words.rest !== '') add(`Only the curl command is translated; "${restShown(words.rest)}" after it is ignored.`);
  code.warnings.forEach(add);
  const { request } = parsed;
  const hasCredentials =
    request.user !== null || request.headers.some(([name]) => CREDENTIAL_HEADERS.has(name.toLowerCase()));
  return { ok: true, text: code.text, warnings: [...warnings], hasCredentials };
};

/**
 * Does pasted text look like a curl command (§7)? After leading blanks it starts with `curl` or `curl.exe` (any case,
 * maybe after a `$ ` prompt) and a blank, and has `://` or a word that starts with `-`. Only the first 4 KiB are read.
 */
export const detectCurl = (text: string): boolean => {
  const head = text.slice(0, 4096).trimStart();
  const start = /^(?:\$[ \t]+)?curl(?:\.exe)?\s/i.exec(head);
  if (!start) return false;
  const after = head.slice(start[0].length - 1);
  return after.includes('://') || /\s-/.test(after);
};
