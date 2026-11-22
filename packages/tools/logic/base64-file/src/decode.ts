/**
 * Decode's input to bytes, as a stream (docs/tools/specs/base64-file.md §5.3): bare Base64 of either alphabet, a data:
 * URI in any spelling (the Fetch standard's «data: URL processor», as base64-image reads it), or a PEM block — text in,
 * pieces of bytes out, or the first error with its place in the input as typed.
 *
 * Base64 is read only by the shared `parseBase64`. A long input is cut into pieces of a multiple of 4 characters (white
 * space aside) and the last four characters always wait for the last piece, where padding may stand: `=` in an earlier
 * piece is misplaced, and the offset of an error in a piece is moved to the whole input. So the outcome — the bytes, or
 * the error with its message, offset, line and column — is the one `parseBase64` of the whole input would give
 * (properties.test.ts proves it on generated inputs and piece sizes). Nothing is held but the current piece.
 */
import { parseBase64 } from '@workspace/tools-shared/base64';
import type { Base64Error } from '@workspace/tools-shared/base64';

export interface InputError extends Partial<Pick<Base64Error, 'offset' | 'line' | 'column'>> {
  message: string;
}

export type InputShape = 'base64' | 'data-uri' | 'pem';

export interface InputHeader {
  shape: InputShape;
  /** A data URI's body is Base64 (`;base64`); always true for the other shapes. */
  base64: boolean;
  /** The type a data URI declared, lower case, without parameters; null when none. */
  declaredMime: string | null;
  /** A data URI's `name` or `filename` parameter, percent-decoded (not yet cleaned: see `cleanFileName`). */
  name: string | null;
  /** A PEM block's label. */
  pemLabel: string | null;
}

export type DecodeStep = { ok: true; bytes: Uint8Array[] } | { ok: false; error: InputError };

export interface InputDecoder {
  /** The next piece of the input. */
  push(piece: string): DecodeStep;
  /** The input is over. */
  end(): DecodeStep;
  /** Known once the input's start was read (null for an input of white space only). */
  readonly header: InputHeader | null;
}

/** Non-white characters of Base64 per piece handed to the shared reader. */
export const DECODE_CHUNK_CHARS = 1_048_576;
/** A data URI's comma is looked for in the first 64 KiB. */
export const META_MAX_CHARS = 64 * 1024;

export const NO_COMMA = 'a data URI needs a comma before the data';
export const ADDRESS = 'This is an address, not Base64: this tool never fetches anything.';
export const PEM_BEGIN = 'a PEM BEGIN line looks like -----BEGIN LABEL-----';
export const pemNoEnd = (label: string): string => `PEM text needs its END line: -----END ${label}-----`;

const isWhite = (c: number): boolean => c === 9 || c === 10 || c === 12 || c === 13 || c === 32;
const isHigh = (c: number): boolean => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number): boolean => c >= 0xdc00 && c <= 0xdfff;

/** Lines and columns over the input consumed so far (1-based, UTF-16, lines split at `\n` — as the shared reader). */
class Places {
  private consumed = 0;
  private line = 1;
  private lineStart = 0;

  get offset(): number {
    return this.consumed;
  }

  advance(text: string): void {
    for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) {
      this.line++;
      this.lineStart = this.consumed + i + 1;
    }
    this.consumed += text.length;
  }

  /** The place of `local` within `text`, the next text after what was consumed. */
  at(text: string, local: number): { offset: number; line: number; column: number } {
    let line = this.line;
    let lineStart = this.lineStart;
    for (let i = text.indexOf('\n'); i >= 0 && i < local; i = text.indexOf('\n', i + 1)) {
      line++;
      lineStart = this.consumed + i + 1;
    }
    const offset = this.consumed + local;
    return { offset, line, column: offset - lineStart + 1 };
  }
}

/** Base64 in pieces through the shared reader (see the module's comment). */
class Base64Pieces {
  private text = '';
  /** Non-white code points in `text`. */
  private count = 0;
  private held = '';

  constructor(
    private readonly places: Places,
    private readonly chunk: number,
    /** Whether an error at this absolute offset can be placed (a data URI's escapes move the offsets). */
    private readonly placeable: (offset: number) => boolean,
  ) {}

  private fail(text: string, local: number, message: string): DecodeStep {
    const place = this.places.at(text, local);
    return { ok: false, error: this.placeable(place.offset) ? { message, ...place } : { message } };
  }

  private add(piece: string): void {
    for (let i = 0; i < piece.length; i++) {
      const c = piece.charCodeAt(i);
      if (isWhite(c)) continue;
      if (isHigh(c) && i + 1 < piece.length && isLow(piece.charCodeAt(i + 1))) i++;
      this.count++;
    }
    this.text += piece;
  }

  /** The first `m` non-white code points of `text` (and the white space among them) as one piece. */
  private cut(m: number): DecodeStep {
    let seen = 0;
    let idx = 0;
    const text = this.text;
    while (seen < m) {
      const c = text.charCodeAt(idx);
      if (!isWhite(c)) {
        seen++;
        if (isHigh(c) && isLow(text.charCodeAt(idx + 1))) idx++;
      }
      idx++;
    }
    const piece = text.slice(0, idx);
    const read = parseBase64(piece);
    if (!read.ok) return this.fail(piece, read.error.offset, read.error.message);
    // The shared reader took `=` at the piece's end as padding: here it stands before more Base64.
    if (read.bytes.length !== (m / 4) * 3) return this.fail(piece, piece.indexOf('='), 'misplaced padding "="');
    this.places.advance(piece);
    this.text = text.slice(idx);
    this.count -= m;
    return { ok: true, bytes: [read.bytes] };
  }

  push(piece: string): DecodeStep {
    let text = this.held + piece;
    this.held = '';
    if (text.length && isHigh(text.charCodeAt(text.length - 1))) {
      this.held = text.slice(-1);
      text = text.slice(0, -1);
    }
    this.add(text);
    const out: Uint8Array[] = [];
    while (this.count >= this.chunk + 4) {
      const step = this.cut(Math.floor(Math.min(this.count - 4, this.chunk) / 4) * 4);
      if (!step.ok) return step;
      out.push(...step.bytes);
    }
    return { ok: true, bytes: out };
  }

  end(): DecodeStep {
    this.add(this.held);
    this.held = '';
    const text = this.text;
    const read = parseBase64(text);
    if (!read.ok) return this.fail(text, read.error.offset, read.error.message);
    this.places.advance(text);
    this.text = '';
    this.count = 0;
    return { ok: true, bytes: read.bytes.length ? [read.bytes] : [] };
  }
}

const hexValue = (c: number): number =>
  c >= 0x30 && c <= 0x39 ? c - 0x30 : c >= 0x41 && c <= 0x46 ? c - 0x37 : c >= 0x61 && c <= 0x66 ? c - 0x57 : -1;

/**
 * A Base64 body with percent-escapes (`%2B`): each `%XX` becomes its character, as a piece at a time. Offsets stay the
 * input's until the first escape (`firstEscape`, relative to the body's start); after it an error has no place.
 */
class PercentText {
  private carry = '';
  private out = 0;
  firstEscape: number | null = null;

  push(piece: string, last: boolean): string {
    let text = this.carry + piece;
    this.carry = '';
    if (!last) {
      const p = text.lastIndexOf('%');
      if (p >= 0 && p > text.length - 3) {
        this.carry = text.slice(p);
        text = text.slice(0, p);
      }
    }
    if (!text.includes('%')) {
      this.out += text.length;
      return text;
    }
    let result = '';
    let i = 0;
    for (let j = text.indexOf('%'); j >= 0; j = text.indexOf('%', i)) {
      result += text.slice(i, j);
      const high = hexValue(text.charCodeAt(j + 1));
      const low = hexValue(text.charCodeAt(j + 2));
      if (j + 2 < text.length && high >= 0 && low >= 0) {
        this.firstEscape ??= this.out + result.length;
        result += String.fromCharCode((high << 4) | low);
        i = j + 3;
      } else {
        result += '%';
        i = j + 1;
      }
    }
    result += text.slice(i);
    this.out += result.length;
    return result;
  }
}

/** The URL standard's percent-decode over the UTF-8 bytes of the text, a piece at a time (a non-Base64 data URI body). */
class PercentBytes {
  private carry = '';
  private readonly encoder = new TextEncoder();

  push(piece: string, last: boolean): Uint8Array {
    let text = this.carry + piece;
    this.carry = '';
    if (!last) {
      let keep = text.length;
      const p = text.lastIndexOf('%');
      if (p >= 0 && p > text.length - 3) keep = p;
      if (keep > 0 && keep === text.length && isHigh(text.charCodeAt(keep - 1))) keep--;
      this.carry = text.slice(keep);
      text = text.slice(0, keep);
    }
    const input = this.encoder.encode(text);
    const out = new Uint8Array(input.length);
    let n = 0;
    for (let i = 0; i < input.length; i++) {
      const b = input[i]!;
      if (b === 0x25 && i + 2 < input.length) {
        const high = hexValue(input[i + 1]!);
        const low = hexValue(input[i + 2]!);
        if (high >= 0 && low >= 0) {
          out[n++] = (high << 4) | low;
          i += 2;
          continue;
        }
      }
      out[n++] = b;
    }
    return out.subarray(0, n);
  }
}

/** Percent-decoding of a parameter's value as UTF-8, never throwing (bad bytes become U+FFFD). */
const percentText = (value: string): string => new TextDecoder('utf-8').decode(new PercentBytes().push(value, true));

/** A data URI's part before the comma (§5.3 п. 2): the declared type, `;base64`, and `name` / `filename`. */
export const parseDataUriMeta = (raw: string): Pick<InputHeader, 'base64' | 'declaredMime' | 'name'> => {
  let meta = raw.replace(/[\t\n\r]/g, '').replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '');
  const base64 = /;[ ]*base64$/i.exec(meta);
  if (base64) meta = meta.slice(0, base64.index);
  const parts = meta.split(';');
  const declaredMime = parts[0]!.trim().toLowerCase() || null;
  let name: string | null = null;
  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    if (key !== 'name' && key !== 'filename') continue;
    let value = part.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    name ??= percentText(value);
  }
  return { base64: !!base64, declaredMime, name };
};

/**
 * An address: a scheme (Base64 has no `:`), or `//` and a host with a dot (Base64 has no `.`; `//79` is Base64).
 */
const ADDRESS_START =
  /^(?:(?:https?|ftp|file|blob|chrome-extension):|\/\/[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?::[0-9]+)?(?:[/?#]|$))/i;
/** The longest start the shape is told by (`chrome-extension:`). */
const SHAPE_CHARS = 17;

type Phase = 'start' | 'meta' | 'pem-begin' | 'body' | 'pem-end' | 'done' | 'failed';

/** §5.3: a decoder for one input. `chunkChars` (a multiple of 4) sizes the pieces given to the shared reader. */
export const createInputDecoder = (options: { chunkChars?: number } = {}): InputDecoder => {
  const chunk = Math.max(4, Math.floor((options.chunkChars ?? DECODE_CHUNK_CHARS) / 4) * 4);
  const places = new Places();
  let phase: Phase = 'start';
  let pending = '';
  let header: InputHeader | null = null;
  let failure: InputError | null = null;
  let body: Base64Pieces | null = null;
  let percent: PercentText | null = null;
  let raw: PercentBytes | null = null;
  let bodyStart = 0;
  let pemTail = '';
  let pemLabel = '';

  const fail = (error: InputError): DecodeStep => {
    phase = 'failed';
    failure = error;
    return { ok: false, error };
  };
  const ok = (bytes: Uint8Array[] = []): DecodeStep => ({ ok: true, bytes });
  const merge = (steps: DecodeStep[]): DecodeStep => {
    const bytes: Uint8Array[] = [];
    for (const s of steps) {
      if (!s.ok) return s;
      bytes.push(...s.bytes);
    }
    return ok(bytes);
  };

  /** Text of the body, in order, through the stage the shape needs. */
  const feedBody = (text: string, last: boolean): DecodeStep => {
    if (raw) return ok([raw.push(text, last)].filter(b => b.length > 0));
    const plain = percent ? percent.push(text, last) : text;
    const step = body!.push(plain);
    if (!step.ok || !last) return step;
    return merge([step, body!.end()]);
  };

  /** A PEM body: Base64 up to `-----END` (looked for across pieces), then the END line. */
  const feedPem = (text: string, last: boolean): DecodeStep => {
    if (phase === 'pem-end') {
      pemTail += text;
      return checkEnd(last);
    }
    const all = pemTail + text;
    const end = all.indexOf('-----END');
    if (end < 0) {
      // Keep the last 7 characters: they may be the start of `-----END`.
      let keep = last ? all.length : Math.max(0, all.length - 7);
      if (keep > 0 && keep < all.length && isLow(all.charCodeAt(keep))) keep--;
      pemTail = all.slice(keep);
      const step = body!.push(all.slice(0, keep));
      if (!last || !step.ok) return step;
      return merge([step, fail({ message: pemNoEnd(pemLabel) })]);
    }
    const step = merge([body!.push(all.slice(0, end)), body!.end()]);
    if (!step.ok) return step;
    phase = 'pem-end';
    pemTail = all.slice(end);
    const checked = checkEnd(last);
    return checked.ok ? merge([step, checked]) : checked;
  };

  const checkEnd = (last: boolean): DecodeStep => {
    const expected = `-----END ${pemLabel}-----`;
    if (pemTail.length >= expected.length || last) {
      if (!pemTail.startsWith(expected)) return fail({ message: pemNoEnd(pemLabel) });
      phase = 'done';
      pemTail = '';
    }
    return ok();
  };

  const step = (piece: string, last: boolean): DecodeStep => {
    if (phase === 'failed') return { ok: false, error: failure! };
    if (phase === 'done') return ok();
    if (phase === 'body') return header!.shape === 'pem' ? feedPem(piece, last) : feedBody(piece, last);
    if (phase === 'pem-end') return feedPem(piece, last);
    pending += piece;

    if (phase === 'start') {
      let i = 0;
      while (i < pending.length && isWhite(pending.charCodeAt(i))) i++;
      const rest = pending.slice(i);
      if (rest.length === 0) return ok();
      // Too short to tell yet whether it is a data URI, a PEM block or an address.
      if (!last && rest.length < SHAPE_CHARS && couldBeShape(rest)) return ok();
      if (ADDRESS_START.test(rest)) return fail({ message: ADDRESS });
      if (/^data:/i.test(rest)) {
        places.advance(pending.slice(0, i));
        pending = rest;
        phase = 'meta';
      } else if (rest.startsWith('-----BEGIN ')) {
        places.advance(pending.slice(0, i));
        pending = rest;
        phase = 'pem-begin';
      } else {
        header = { shape: 'base64', base64: true, declaredMime: null, name: null, pemLabel: null };
        body = new Base64Pieces(places, chunk, () => true);
        phase = 'body';
        const text = pending;
        pending = '';
        return feedBody(text, last);
      }
    }

    if (phase === 'meta') {
      const comma = pending.indexOf(',');
      if (comma < 0) {
        if (last || pending.length > META_MAX_CHARS) return fail({ message: NO_COMMA });
        return ok();
      }
      const meta = parseDataUriMeta(pending.slice(5, comma));
      header = { shape: 'data-uri', ...meta, pemLabel: null };
      places.advance(pending.slice(0, comma + 1));
      bodyStart = places.offset;
      const text = pending.slice(comma + 1);
      pending = '';
      phase = 'body';
      if (meta.base64) {
        const escapes = new PercentText();
        percent = escapes;
        body = new Base64Pieces(
          places,
          chunk,
          offset => escapes.firstEscape === null || offset < bodyStart + escapes.firstEscape,
        );
      } else raw = new PercentBytes();
      return feedBody(text, last);
    }

    // pem-begin: `-----BEGIN <label>-----` on one line.
    const close = pending.indexOf('-----', 11);
    const newline = pending.indexOf('\n');
    if (close < 0 || (newline >= 0 && newline < close)) {
      if (last || newline >= 0 || pending.length > 256) return fail({ message: PEM_BEGIN });
      return ok();
    }
    pemLabel = pending.slice(11, close);
    if (!/^[\x21-\x2C\x2E-\x7E](?:[\x20-\x2C\x2E-\x7E]*[\x21-\x2C\x2E-\x7E])?$/.test(pemLabel))
      return fail({ message: PEM_BEGIN });
    header = { shape: 'pem', base64: true, declaredMime: null, name: null, pemLabel };
    places.advance(pending.slice(0, close + 5));
    body = new Base64Pieces(places, chunk, () => true);
    const text = pending.slice(close + 5);
    pending = '';
    phase = 'body';
    return feedPem(text, last);
  };

  return {
    push: piece => step(piece, false),
    end: () => step('', true),
    get header() {
      return header;
    },
  };
};

/** Could this short start still grow into `data:`, `-----BEGIN ` or an address? */
const couldBeShape = (rest: string): boolean => {
  const lower = rest.toLowerCase();
  if (lower.startsWith('//')) return !/^\/\/[A-Za-z0-9+/_=-]*$/.test(rest) || rest.length < 4;
  return ['data:', '-----begin ', 'https:', 'http:', 'ftp:', 'file:', 'blob:', 'chrome-extension:'].some(
    p => p.startsWith(lower) || lower.startsWith(p),
  );
};

export type DecodeInputResult =
  { ok: true; bytes: Uint8Array; header: InputHeader | null } | { ok: false; error: InputError };

/** The whole text at once (the page, up to LIVE_CHARS) — through the same decoder, in pieces of `piece` characters. */
export const decodeInput = (text: string, options: { chunkChars?: number; piece?: number } = {}): DecodeInputResult => {
  const decoder = createInputDecoder(options);
  const parts: Uint8Array[] = [];
  const piece = options.piece ?? 4 * 1024 * 1024;
  for (let at = 0; at <= text.length; at += piece) {
    const last = at + piece >= text.length;
    const step = last ? merge2(decoder.push(text.slice(at)), decoder.end()) : decoder.push(text.slice(at, at + piece));
    if (!step.ok) return step;
    parts.push(...step.bytes);
    if (last) break;
  }
  return { ok: true, bytes: concat(parts), header: decoder.header };
};

const merge2 = (a: DecodeStep, b: DecodeStep): DecodeStep =>
  !a.ok ? a : !b.ok ? b : { ok: true, bytes: [...a.bytes, ...b.bytes] };

export const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  if (parts.length === 1) return parts[0]!;
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

export interface TextBlobControl {
  /** Bytes of the Blob read at a time (4 MiB). */
  readBytes?: number;
  chunkChars?: number;
  signal?: AbortSignal;
  onBytes?: (done: number) => void;
}

const abortError = (): Error => Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });

/**
 * A text Blob — a pasted text kept out of the field, a dropped text file — read a slice at a time as UTF-8 (a streaming
 * TextDecoder: a character cut by a slice waits for the next) and decoded; each piece of bytes goes to `sink` in order.
 */
export const decodeTextBlob = async (
  blob: Blob,
  sink: (bytes: Uint8Array) => void,
  control: TextBlobControl = {},
): Promise<{ ok: true; header: InputHeader | null; size: number } | { ok: false; error: InputError }> => {
  const decoder = createInputDecoder(control.chunkChars ? { chunkChars: control.chunkChars } : {});
  const text = new TextDecoder('utf-8');
  const readBytes = control.readBytes ?? 4 * 1024 * 1024;
  let size = 0;
  const take = (step: DecodeStep): InputError | null => {
    if (!step.ok) return step.error;
    for (const b of step.bytes) {
      size += b.length;
      sink(b);
    }
    return null;
  };
  for (let at = 0; at < blob.size; at += readBytes) {
    if (control.signal?.aborted) throw abortError();
    const bytes = new Uint8Array(await blob.slice(at, Math.min(at + readBytes, blob.size)).arrayBuffer());
    const error = take(decoder.push(text.decode(bytes, { stream: true })));
    if (error) return { ok: false, error };
    control.onBytes?.(Math.min(at + readBytes, blob.size));
  }
  const error = take(decoder.push(text.decode())) ?? take(decoder.end());
  if (error) return { ok: false, error };
  return { ok: true, header: decoder.header, size };
};
