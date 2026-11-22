/**
 * The request a curl command sends (docs/tools/specs/curl-to-code.md §5, «Параметры `curl`» and «Запрос»), read from
 * its words. Every rule that the specification marks as checked was compared with what curl 8.7.1 sends to a loopback
 * server; where curl does something else than the draft said, curl wins and the specification's §15 says so.
 */
import { longOption, shortOption } from './options';
import type { OptionInfo } from './options';
import type { Body, CurlRequest, FormField, Parsed } from './types';
import type { Word } from './words';

const utf8 = new TextEncoder();
const HEX = '0123456789ABCDEF';

/** `--data-urlencode` (§5): UTF-8, everything but A–Z a–z 0–9 - . _ ~ as %HH in capitals, a space as +. */
export const curlUrlEncodeBytes = (bytes: Uint8Array): string => {
  let out = '';
  for (const b of bytes) {
    if ((b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a) || b === 0x2d || b === 0x2e)
      out += String.fromCharCode(b);
    else if (b === 0x5f || b === 0x7e) out += String.fromCharCode(b);
    else if (b === 0x20) out += '+';
    else out += `%${HEX[b >> 4]}${HEX[b & 15]}`;
  }
  return out;
};

export const curlUrlEncode = (text: string): string => curlUrlEncodeBytes(utf8.encode(text));

/** A piece of the body from -d and its kin, in the order of the command. */
type DataPart =
  | { kind: 'text'; text: string; bytes?: Uint8Array; json: boolean }
  /** A file: `readable` when the code can read it (not standard input, not --data-urlencode's). */
  | {
      kind: 'file';
      option: string;
      shown: string;
      path: string;
      strip: boolean;
      json: boolean;
      readable: boolean;
      /** Already named in a warning (--data-urlencode's files). */
      warned: boolean;
    };

/** A header that an option other than -H sets (-A, -e, -b, --oauth2-bearer), with the option as written. */
interface OptionHeader {
  name: string;
  value: string;
  option: string;
}

const lower = (s: string): string => s.toLowerCase();
const article = (name: string): string => (name === 'Authorization' ? 'an' : 'a');
const basename = (path: string): string => path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);

/** Shown in a warning: a header text, but never the value of a credential header. */
const shownHeader = (text: string): string => {
  const secret = /^\s*(proxy-authorization|authorization|cookie)\b/i.exec(text);
  return secret ? secret[1]! : text;
};

const POSITIVE = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Text and bytes of the body parts joined as curl joins them: `&` before a part unless it comes from --json. */
const joinParts = (parts: Array<Extract<DataPart, { kind: 'text' }>>): Body | null => {
  if (parts.length === 0) return null;
  const binary = parts.some(p => p.bytes);
  if (!binary) {
    let text = '';
    for (const p of parts) text += (text.length > 0 && !p.json ? '&' : '') + p.text;
    return { kind: 'raw', text };
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (const p of parts) {
    if (length > 0 && !p.json) {
      chunks.push(Uint8Array.of(0x26));
      length++;
    }
    const b = p.bytes ?? utf8.encode(p.text);
    chunks.push(b);
    length += b.length;
  }
  const bytes = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  return { kind: 'binary', bytes };
};

/** The URL with its scheme: http:// in front when it has none, as curl guesses. */
const withScheme = (url: string): string => (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(url) ? url : `http://${url}`);

/** `-T file` to a URL with no file name in it (`…/` or a bare host): curl appends the file's name. */
const uploadUrl = (url: string, file: string): string => {
  const authority = url.indexOf('://') + 3;
  const pathStart = url.slice(authority).search(/[/?#]/);
  if (pathStart < 0) return `${url}/${encodeURIComponent(basename(file))}`;
  const at = authority + pathStart;
  const tail = url.slice(at).search(/[?#]/);
  const pathEnd = tail < 0 ? url.length : at + tail;
  if (url[at] !== '/' || url[pathEnd - 1] === '/' || pathEnd === at)
    return `${url.slice(0, pathEnd)}${url[pathEnd - 1] === '/' ? '' : '/'}${basename(file)}${url.slice(pathEnd)}`;
  return url;
};

export const parseCurl = (words: Word[]): Parsed => {
  let first = 0;
  if (words[0]?.text === '$') first = 1;
  const head = words[first];
  if (!head || !/^curl(?:\.exe)?$/i.test(head.text))
    return { ok: false, message: 'the command must start with curl', offset: words[0]?.offset ?? 0 };

  const warnings: string[] = [];
  const seen = new Set<string>();
  const warn = (text: string): void => {
    if (seen.has(text)) return;
    seen.add(text);
    warnings.push(text);
  };
  const urls: string[] = [];
  let method: string | null = null;
  const headers: Array<[string, string]> = [];
  const optionHeaders: OptionHeader[] = [];
  const cookies: string[] = [];
  let cookieOption = '';
  const data: DataPart[] = [];
  const form: FormField[] = [];
  let get = false;
  let headRequest = false;
  let user: [string, string] | null = null;
  let userOption = '-u';
  let insecure = false;
  let timeoutSeconds: number | null = null;
  let upload: { path: string } | null = null;

  const addHeader = (text: string): void => {
    if (text.startsWith('@')) {
      warn(`--header ${text}: files are not read; left out.`);
      return;
    }
    const colon = text.indexOf(':');
    let name: string;
    let value: string;
    if (colon < 0) {
      const empty = /^([^\s:;]+);\s*$/.exec(text);
      if (!empty) {
        warn(`-H "${shownHeader(text)}" is not a header (no colon); ignored.`);
        return;
      }
      [name, value] = [empty[1]!, ''];
    } else {
      name = text.slice(0, colon);
      value = text.slice(colon + 1).replace(/^[ \t]+|[ \t]+$/g, '');
      if (name === '' || /\s/.test(name)) {
        warn(`-H "${shownHeader(text)}" is not a header (no colon); ignored.`);
        return;
      }
      if (value === '') {
        warn(`-H "${name}:" removes a header curl adds itself; ignored.`);
        return;
      }
    }
    headers.push([name, value]);
  };

  const addData = (option: OptionInfo, written: string, word: Word): void => {
    const value = word.text;
    const json = option.name === 'json';
    if (option.name === 'data-raw' || (!value.startsWith('@') && option.name !== 'data-urlencode')) {
      data.push({ kind: 'text', text: value, ...(word.bytes ? { bytes: word.bytes } : {}), json });
      return;
    }
    if (option.name !== 'data-urlencode') {
      const path = value.slice(1);
      data.push({
        kind: 'file',
        option: `--${option.name}`,
        shown: value,
        path,
        strip: option.name === 'data' || option.name === 'data-ascii',
        json,
        readable: path !== '' && path !== '-',
        warned: false,
      });
      return;
    }
    // --data-urlencode: [name]=content, [name]@file, or content alone (curl looks for '=' first, then '@').
    let sep = value.indexOf('=');
    if (sep < 0) sep = value.indexOf('@');
    if (sep >= 0 && value[sep] === '@') {
      warn(`--data-urlencode ${value}: files are not read; left out.`);
      data.push({
        kind: 'file',
        option: written,
        shown: value,
        path: value.slice(sep + 1),
        strip: false,
        json,
        readable: false,
        warned: true,
      });
      return;
    }
    const name = sep >= 0 ? value.slice(0, sep) : '';
    const content = sep >= 0 ? value.slice(sep + 1) : value;
    data.push({ kind: 'text', text: (name ? `${name}=` : '') + curlUrlEncode(content), json: false });
  };

  const addForm = (text: string, literal: boolean): void => {
    const eq = text.indexOf('=');
    if (eq < 0) {
      warn(`-F "${text}" is not a form field (no =); ignored.`);
      return;
    }
    const name = text.slice(0, eq);
    let value = text.slice(eq + 1);
    if (literal) {
      form.push({ name, value });
      return;
    }
    const file = value.startsWith('@');
    if (value.startsWith('<')) {
      warn(`-F ${text}: files are not read; that field is left out.`);
      return;
    }
    if (file) value = value.slice(1);
    // A value in double quotes may hold ';' (curl: backslash escapes '"' and '\' inside); otherwise ';' starts the
    // part's parameters — type=, filename=, headers=, encoder= — which the clients do not get.
    let params = '';
    if (value.startsWith('"')) {
      let v = '';
      let i = 1;
      for (; i < value.length && value[i] !== '"'; i++) {
        if (value[i] === '\\' && (value[i + 1] === '"' || value[i + 1] === '\\')) i++;
        v += value[i];
      }
      params = value.slice(i + 1);
      value = v;
    } else {
      const semi = value.indexOf(';');
      if (semi >= 0) [value, params] = [value.slice(0, semi), value.slice(semi)];
    }
    const filename = /;\s*filename=("?)([^;"]*)\1/i.exec(params)?.[2];
    if (params.replace(/;\s*filename=("?)[^;"]*\1/i, '').trim() !== '' || (!file && filename !== undefined))
      warn(`-F ${name}: ";type=", ";filename=" and similar are not translated; left out.`);
    if (!file) form.push({ name, value });
    else if (value === '' || value === '-') warn(`-F ${name}=@${value}: files are not read; that field is left out.`);
    else form.push({ name, file: value, filename: filename || basename(value) });
  };

  /** Applies one option; `written` is how the person wrote it (`-H`, `--header`). */
  const apply = (option: OptionInfo, written: string, word: Word | undefined): void => {
    const value = word?.text ?? '';
    switch (option.role) {
      case 'silent':
        return;
      case 'ignored':
        warn(`${written} is not translated; ignored.`);
        return;
    }
    switch (option.name) {
      case 'url':
        urls.push(value);
        return;
      case 'request':
        method = value;
        return;
      case 'header':
        addHeader(value);
        return;
      case 'data':
      case 'data-ascii':
      case 'data-binary':
      case 'data-raw':
      case 'data-urlencode':
      case 'json':
        addData(option, written, word!);
        return;
      case 'form':
        addForm(value, false);
        return;
      case 'form-string':
        addForm(value, true);
        return;
      case 'get':
        get = true;
        return;
      case 'head':
        headRequest = true;
        return;
      case 'user': {
        userOption = written;
        const colon = value.indexOf(':');
        if (colon < 0) {
          warn(`${written} has no password: curl would ask for one; the code uses an empty password.`);
          user = [value, ''];
        } else user = [value.slice(0, colon), value.slice(colon + 1)];
        return;
      }
      case 'oauth2-bearer':
        optionHeaders.push({ name: 'Authorization', value: `Bearer ${value}`, option: written });
        return;
      case 'cookie':
        if (!value.includes('=')) {
          warn(`${written} ${value}: a cookie file is not read; ignored.`);
          return;
        }
        if (cookies.length === 0) {
          cookieOption = written;
          optionHeaders.push({ name: 'Cookie', value: '', option: written });
        }
        cookies.push(value);
        return;
      case 'user-agent':
        if (value !== '') optionHeaders.push({ name: 'User-Agent', value, option: written });
        return;
      case 'referer': {
        const referer = value.replace(/;auto$/, '');
        if (referer !== '') optionHeaders.push({ name: 'Referer', value: referer, option: written });
        return;
      }
      case 'insecure':
        insecure = true;
        return;
      case 'max-time': {
        const n = Number(value);
        if (POSITIVE.test(value) && n > 0 && Number.isFinite(n)) timeoutSeconds = n;
        else warn(`--max-time ${value} is not a positive number of seconds; ignored.`);
        return;
      }
      case 'upload-file':
        upload = { path: value };
        return;
    }
  };

  let optionsEnd = false;
  for (let w = first + 1; w < words.length; w++) {
    const word = words[w]!;
    const text = word.text;
    if (optionsEnd || !text.startsWith('-') || text === '-') {
      urls.push(text);
      continue;
    }
    if (text === '--') {
      optionsEnd = true;
      continue;
    }
    if (text.startsWith('--')) {
      const option = longOption(text.slice(2));
      if (!option) {
        warn(`Unknown option ${text}; ignored.`);
        continue;
      }
      if (option.value) {
        const next = words[w + 1];
        if (!next) return { ok: false, message: `${text} needs a value`, offset: word.offset };
        w++;
        apply(option, text, next);
      } else apply(option, text, undefined);
      continue;
    }
    // Short options, glued (-sSL); one that takes a value takes the rest of the word or the next word.
    for (let k = 1; k < text.length; k++) {
      const letter = text[k]!;
      const option = shortOption(letter);
      if (!option) {
        warn(`Unknown option -${letter}; ignored.`);
        break;
      }
      if (!option.value) {
        apply(option, `-${letter}`, undefined);
        continue;
      }
      if (k + 1 < text.length) {
        const restText = text.slice(k + 1);
        // The option letters are ASCII: the value's bytes are the word's after them.
        apply(option, `-${letter}`, {
          text: restText,
          offset: word.offset + k + 1,
          ...(word.bytes ? { bytes: word.bytes.subarray(k + 1) } : {}),
        });
      } else {
        const next = words[w + 1];
        if (!next) return { ok: false, message: `-${letter} needs a value`, offset: word.offset };
        w++;
        apply(option, `-${letter}`, next);
      }
      break;
    }
  }

  if (urls.length === 0) return { ok: false, message: 'no URL in the command', offset: head.offset };
  if (urls.length > 1) warn(`${urls.length} URLs: only the first one is translated.`);
  let url = withScheme(urls[0]!);

  // The body (§5 «Запрос» п. 2): a form wins over -d; with -G the -d parts go into the URL.
  const texts = data.filter((p): p is Extract<DataPart, { kind: 'text' }> => p.kind === 'text');
  const leaveOut = (p: DataPart): void => {
    if (p.kind === 'file' && !p.warned)
      warn(`${p.option} ${p.shown}: files are not read; that part of the body is left out.`);
  };
  let body: Body | null = null;
  const fromData = data.length > 0 && form.length === 0;
  if (form.length > 0) {
    if (data.length > 0) warn('-F together with -d: curl refuses this; the form is used.');
    body = { kind: 'multipart', fields: form };
  } else if (data.length > 0 && get) {
    data.forEach(leaveOut);
    const joined = joinParts(texts);
    if (joined) {
      const query =
        joined.kind === 'raw' ? joined.text : new TextDecoder().decode((joined as { bytes: Uint8Array }).bytes);
      // A fragment is never sent; curl drops it when it adds the query.
      const hash = url.indexOf('#');
      const base = hash < 0 ? url : url.slice(0, hash);
      url = `${base}${base.includes('?') ? '&' : '?'}${query}`;
    }
  } else if (data.length === 1 && data[0]!.kind === 'file' && data[0]!.readable) {
    body = { kind: 'file', path: data[0]!.path, strip: data[0]!.strip };
  } else if (data.length > 0) {
    data.forEach(leaveOut);
    body = joinParts(texts);
  } else if (upload) {
    const { path } = upload as { path: string };
    if (path === '' || path === '-' || path === '.') warn(`--upload-file ${path}: files are not read; left out.`);
    else {
      body = { kind: 'file', path, strip: false };
      url = uploadUrl(url, path);
    }
  }
  if (upload && (data.length > 0 || form.length > 0))
    warn(`--upload-file ${(upload as { path: string }).path}: files are not read; left out.`);

  // The method (§5 «Запрос» п. 1).
  const finalMethod =
    method ??
    (headRequest ? 'HEAD' : get ? 'GET' : data.length > 0 || form.length > 0 ? 'POST' : upload ? 'PUT' : 'GET');

  // Headers (§5 «Запрос» п. 4): -H in order, merged by name; then those other options set, unless -H set the same
  // name (curl sends the custom one); then the implicit ones.
  const merged: Array<[string, string]> = [];
  const byName = new Map<string, [string, string]>();
  const add = (name: string, value: string): void => {
    const header: [string, string] = [name, value];
    merged.push(header);
    byName.set(lower(name), header);
  };
  const find = (name: string): number => {
    const header = byName.get(lower(name));
    return header ? merged.indexOf(header) : -1;
  };
  for (const [name, value] of headers) {
    const existing = byName.get(lower(name));
    if (!existing) add(name, value);
    else existing[1] += (lower(name) === 'cookie' ? ';' : ', ') + value;
  }
  for (const h of optionHeaders) {
    const value = h.name === 'Cookie' ? cookies.join(';') : h.value;
    if (find(h.name) >= 0) {
      warn(
        `${h.name === 'Cookie' ? cookieOption : h.option} is ignored: the command also sets ${article(h.name)} ${h.name} header, which curl sends instead.`,
      );
      continue;
    }
    add(h.name, value);
  }
  if (body?.kind === 'multipart') {
    const at = find('Content-Type');
    if (at >= 0) {
      warn('-H "Content-Type: …" is left out: the client writes the form\'s own Content-Type with its boundary.');
      merged.splice(at, 1);
      byName.delete('content-type');
    }
  }
  if (data.some(p => p.json) && !get && form.length === 0) {
    if (find('Content-Type') < 0) add('Content-Type', 'application/json');
    if (find('Accept') < 0) add('Accept', 'application/json');
  }
  if (fromData && !get && find('Content-Type') < 0) add('Content-Type', 'application/x-www-form-urlencoded');

  if (user && find('Authorization') >= 0) {
    warn(`${userOption} is ignored: the command also sets an Authorization header, which curl sends instead.`);
    user = null;
  }

  const request: CurlRequest = {
    method: finalMethod,
    url,
    headers: merged,
    body,
    user,
    insecure,
    timeoutSeconds,
  };
  return { ok: true, request, warnings };
};
