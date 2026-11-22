/**
 * The command-line clients (docs/tools/specs/curl-to-code.md §5, «Код»): HTTPie 3 (`http`) and GNU wget. One family:
 * both are a POSIX shell command line whose words are written by literals/shell.ts.
 */
import { bodyWithoutType, capitals, defaultType, perWaitTimeout, queryWarnings } from './common';
import { printfFormat, shellBytes, shellWord } from '../literals/shell';
import type { Clients, Generator } from '../types';

const utf8 = new TextEncoder();
const basename = (path: string): string => path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
const nul = (what: string): string => `${what} has a NUL character, which a command line cannot hold; left out.`;

/** A command: the first line, then one continuation line per further group, as "Copy as cURL" writes curl's. */
const command = (first: string[], rest: string[], prefix = '', suffix = ''): string =>
  `${prefix}${[first.join(' '), ...rest].join(' \\\n  ')}${suffix}\n`;

// ----------------------------------------------------------------------------------------------------------------------
// HTTPie

/**
 * HTTPie's request items (httpie/cli/argtypes.py, `KeyValueArgType`): the separators are `:`, `;`, `:@`, `==`, `=`,
 * `:=`, `@`, `=@`, `:=@`, and an item splits at the first one, the longest one there. A backslash before one of their
 * characters (`:`, `;`, `=`, `@`) makes it text, in the name and in the value alike; a backslash before anything else
 * stays a backslash. So every such character of a name is escaped, and of a value only a first `=` or `@` (which would
 * make `:=`, `:@`, `==` or `=@` with the separator before it); a backslash that the text itself has right before one of
 * them cannot be written at all (null).
 */
const itemName = (text: string): string | null =>
  /\\[:;=@]/.test(text) ? null : text.replace(/[:;=@]/g, c => `\\${c}`);
const itemValue = (text: string): string | null =>
  /\\[:;=@]/.test(text) ? null : text.replace(/^[=@]/, c => `\\${c}`);

const httpie: Generator = {
  generate(request) {
    const warnings: string[] = [];
    const options: string[] = [];
    const rest: string[] = [];
    let prefix = '';
    let suffix = '';
    if (request.insecure) options.push('--verify=no');
    if (request.timeoutSeconds !== null) {
      options.push(`--timeout=${request.timeoutSeconds}`);
      warnings.push(perWaitTimeout('HTTPie'));
    }
    if (request.followRedirects) options.push('--follow');
    if (request.user) {
      const auth = shellWord(`${request.user[0]}:${request.user[1]}`);
      if (auth) options.push(`--auth ${auth}`);
      else warnings.push(nul('-u'));
    }
    if (!/^[A-Za-z]+$/.test(request.method))
      warnings.push(`HTTPie takes a method of letters only; ${request.method} will not run.`);
    else if (request.method !== request.method.toUpperCase()) warnings.push(capitals('HTTPie', request.method));

    for (const [name, value] of request.headers) {
      const n = itemName(name);
      const v = itemValue(value);
      const word = n !== null && v !== null ? shellWord(value === '' ? `${n};` : `${n}:${v}`) : null;
      if (word) rest.push(word);
      else
        warnings.push(
          n === null || v === null
            ? `The ${name} header: HTTPie cannot write a backslash before ":", ";", "=" or "@"; left out.`
            : nul(`The ${name} header`),
        );
    }
    const body = request.body;
    // A body from standard input or --raw is JSON to HTTPie unless the command says what it is; `Content-Type:`
    // takes HTTPie's own away.
    if (bodyWithoutType(request)) rest.push(`'Content-Type:'`);
    if (body?.kind === 'raw') {
      const raw = shellWord(body.text);
      if (raw) rest.push(`--raw ${raw}`);
      else prefix = `printf ${printfFormat(utf8.encode(body.text))} | `;
    } else if (body?.kind === 'binary') prefix = `printf ${printfFormat(body.bytes)} | `;
    else if (body?.kind === 'file') {
      const path = shellWord(body.path);
      if (!path) warnings.push(nul(`The file name ${JSON.stringify(body.path)}`));
      else if (body.strip) prefix = `tr -d '\\r\\n' < ${path} | `;
      else suffix = ` < ${path}`;
    } else if (body?.kind === 'multipart') {
      options.push('--multipart');
      let seenFile = false;
      for (const f of body.fields) {
        const n = itemName(f.name);
        const v = itemValue('file' in f ? f.file : f.value);
        const word = n !== null && v !== null ? shellWord('file' in f ? `${n}@${v}` : `${n}=${v}`) : null;
        if (!word) {
          warnings.push(`-F ${f.name}: HTTPie cannot write this field; left out.`);
          continue;
        }
        rest.push(word);
        if ('file' in f) {
          seenFile = true;
          if (f.filename !== basename(f.file))
            warnings.push(`-F ${f.name}: HTTPie names the file after its path; filename=${f.filename} is left out.`);
        } else if (seenFile) warnings.push("HTTPie sends a form's text fields before its files; the order differs.");
      }
    }
    const url = shellWord(request.url) ?? "''";
    if (url === "''") warnings.push(nul('The URL'));
    warnings.push(...queryWarnings(request.url, 'HTTPie'));
    return {
      text: command(['http', ...options, request.method, url], rest, prefix, suffix),
      warnings: [...new Set(warnings)],
    };
  },
};

// ----------------------------------------------------------------------------------------------------------------------
// wget

/**
 * GNU wget 1.21+, checked against a loopback server (wget 1.25): it sends a body only with `--method`, adds
 * `Content-Type: application/x-www-form-urlencoded` to a body without one, sends the method in capitals, follows
 * redirects by default, asks for compression only with `--compression=auto`, and sends Basic credentials before being
 * asked only with `--auth-no-challenge`. It reads a body file by its size, so it cannot read a pipe.
 */
const wget: Generator = {
  generate(request) {
    const warnings: string[] = [];
    const lines: string[] = [];
    const body = request.body;
    const sendsBody = body !== null && body.kind !== 'multipart';
    if (request.method !== 'GET' || sendsBody) lines.push(`--method=${request.method}`);
    if (request.method !== request.method.toUpperCase()) warnings.push(capitals('wget', request.method));
    for (const [name, value] of request.headers) {
      const word = shellWord(`${name}: ${value}`);
      if (word) lines.push(`--header ${word}`);
      else warnings.push(nul(`The ${name} header`));
    }
    if (request.user) {
      const user = shellWord(request.user[0]);
      const password = shellWord(request.user[1]);
      if (user && password) lines.push(`--user ${user} --password ${password} --auth-no-challenge`);
      else warnings.push(nul('-u'));
    }
    if (body?.kind === 'raw' || body?.kind === 'binary') {
      const data = body.kind === 'raw' ? shellWord(body.text) : shellBytes(body.bytes);
      if (data) lines.push(`--body-data ${data}`);
      else warnings.push(nul('The body'));
    } else if (body?.kind === 'file') {
      const path = shellWord(body.path);
      if (!path) warnings.push(nul(`The file name ${JSON.stringify(body.path)}`));
      else lines.push(body.strip ? `--body-data "$(tr -d '\\r\\n' < ${path})"` : `--body-file ${path}`);
    } else if (body?.kind === 'multipart')
      warnings.push('wget cannot send a multipart form (-F); the form is left out.');
    if (sendsBody && bodyWithoutType(request)) warnings.push(defaultType('wget'));
    if (request.insecure) lines.push('--no-check-certificate');
    if (request.timeoutSeconds !== null) {
      lines.push(`--timeout=${request.timeoutSeconds}`);
      warnings.push(perWaitTimeout('wget'));
    }
    if (request.compressed) lines.push('--compression=auto');
    const url = shellWord(request.url);
    if (!url) warnings.push(nul('The URL'));
    warnings.push(...queryWarnings(request.url, 'wget'));
    return { text: command(['wget', '--quiet', '--output-document=-'], [...lines, url ?? "''"]), warnings };
  },
};

export const clients: Clients = { httpie, wget };
