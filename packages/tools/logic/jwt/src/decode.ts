/**
 * Splitting a pasted token into its parts and decoding them (docs/tools/specs/jwt.md §5.1, §5.2, §5.7): the compact
 * JWS (three parts) and the protected header of a JWE (five parts). A part that is not base64url stops the decoding
 * with the segment and the position; a header or a payload that is not what a JWT needs is still shown, with why.
 */
import { decodeBase64url, strictUtf8 } from './base64url';
import { bytesToHex } from '@workspace/tools-shared/hex';

/** The largest token the tool decodes (§6, §12): 1 MiB of text. The component checks it before decoding. */
export const MAX_TOKEN = 1024 * 1024;
export const TOO_LARGE = 'The token is larger than 1 MB. This tool decodes tokens up to 1 MB.';

/** A decoded header or payload. */
export type Part =
  // display: pretty JSON with numbers as in the source; raw: the value whose numbers keep that source (JSON.rawJSON)
  | { ok: true; json: unknown; display: string; raw: unknown }
  | { ok: false; text?: string; hex?: string; message: string };

export type Decoded = {
  kind: 'jws' | 'jwe';
  /** Notes under the token field: what preparation removed, padding warnings, the JWE message. */
  notes: string[];
  /** Notes about the header: a nested token (`cty: JWT`), a key or key URL carried in the header. */
  headerNotes: string[];
  header: Part;
  /** Absent for a JWE. */
  payload?: Part;
  /** Absent for a JWE. */
  signature?: { text: string; bytes: Uint8Array };
  /** "<header>.<payload>" as in the token (a JWE: its protected header). */
  signingInput: string;
  alg?: string;
};

export type DecodeResult =
  { ok: true; token: Decoded } | { ok: false; message: string; segment?: number; position?: number };

export const PARTS_MESSAGE = (n: number): string =>
  `A JWT has 3 parts separated by dots (5 for an encrypted token). This has ${n}.`;
export const JWE_MESSAGE = 'This is an encrypted token (JWE). Only its header can be read without the decryption key.';
export const PAYLOAD_NOT_OBJECT =
  "Payload is not a JSON object, so it isn't a JWT claims set (RFC 7519 §7.2). The signature can still be checked.";
export const PAYLOAD_NOT_TEXT = 'Payload is not text.';
export const NESTED_NOTE = 'The payload is another JWT (cty: JWT). Paste it into the token field to decode it.';
export const HEADER_KEY_NOTE =
  "The header carries a key or a key URL. It is not used: a token can't vouch for itself. Paste the key you trust.";

/** Pasted text made into a compact token (§5.1, steps 1–3), and what was taken away on the way. */
export interface PreparedToken {
  text: string;
  /** A leading `Bearer ` was removed. */
  bearer: boolean;
  /** Whitespace inside the token was removed: line breaks among it, or spaces and tabs only. */
  whitespace?: 'line breaks' | 'spaces';
}

const BEARER = /^bearer\s+/i;
const ASCII_SPACE = /[\t\n\f\r ]/;
const ASCII_SPACES = /[\t\n\f\r ]+/g;
const LINE_BREAK = /[\n\r]/;

/** Trims, takes away a leading `Bearer` with its whitespace, then every ASCII whitespace character inside. */
export const prepareToken = (input: string): PreparedToken => {
  const trimmed = input.trim();
  const text = trimmed.replace(BEARER, '');
  const bearer = text.length !== trimmed.length;
  if (!ASCII_SPACE.test(text)) return { text, bearer };
  const whitespace = LINE_BREAK.test(text) ? 'line breaks' : 'spaces';
  return { text: text.replace(ASCII_SPACES, ''), bearer, whitespace };
};

/** The note of §5.1 step 3 for what `prepareToken` took away; undefined when nothing was. */
export const preparationNote = ({ bearer, whitespace }: PreparedToken): string | undefined =>
  bearer && whitespace
    ? `Removed "Bearer " and ${whitespace}.`
    : bearer
      ? 'Removed "Bearer ".'
      : whitespace
        ? `Removed ${whitespace}.`
        : undefined;

type Reviver = (this: unknown, key: string, value: unknown, context?: { source?: string }) => unknown;
const rawJSON = (JSON as unknown as { rawJSON?: (text: string) => unknown }).rawJSON;
/** Numbers as written in the source (Chrome 114+, Node 21+); without JSON.rawJSON, numbers as JavaScript reads them. */
const keepNumbers: Reviver | undefined = rawJSON
  ? (_key, value, context) =>
      typeof value === 'number' && context?.source !== undefined ? rawJSON(context.source) : value
  : undefined;

/** JSON text → the plain value and the one that keeps numbers' source; undefined when it is not JSON. */
export const parseJson = (text: string): { json: unknown; raw: unknown } | undefined => {
  try {
    const json: unknown = JSON.parse(text);
    const raw: unknown = keepNumbers ? JSON.parse(text, keepNumbers as Parameters<typeof JSON.parse>[1]) : json;
    return { json, raw };
  } catch {
    return undefined;
  }
};

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hex = (bytes: Uint8Array): string => bytesToHex(bytes, { format: 'spaced' });

const decodeHeader = (bytes: Uint8Array): Part => {
  const text = strictUtf8(bytes);
  if (text === null) return { ok: false, hex: hex(bytes), message: 'The header is not UTF-8 text.' };
  const parsed = parseJson(text);
  if (!parsed) return { ok: false, text, message: 'The header is not JSON.' };
  if (!isObject(parsed.json)) return { ok: false, text, message: 'The header must be a JSON object.' };
  return { ok: true, json: parsed.json, raw: parsed.raw, display: JSON.stringify(parsed.raw, null, 2) };
};

const decodePayload = (bytes: Uint8Array): Part => {
  const text = strictUtf8(bytes);
  if (text === null) return { ok: false, hex: hex(bytes), message: PAYLOAD_NOT_TEXT };
  const parsed = parseJson(text);
  if (!parsed || !isObject(parsed.json)) return { ok: false, text, message: PAYLOAD_NOT_OBJECT };
  return { ok: true, json: parsed.json, raw: parsed.raw, display: JSON.stringify(parsed.raw, null, 2) };
};

type Segment = { ok: true; bytes: Uint8Array; padded: boolean } | { ok: false; message: string; position?: number };

/** One part (§5.1 step 5): base64url, `=` padding tolerated at the end, `+` and `/` named as standard Base64. */
const decodeSegment = (segment: string, n: number): Segment => {
  let end = segment.length;
  while (end > 0 && segment.length - end < 2 && segment[end - 1] === '=') end--;
  const body = segment.slice(0, end);
  for (let i = 0; i < body.length; i++) {
    const c = body.charCodeAt(i);
    const ok =
      (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45 /* - */ || c === 95; /* _ */
    if (ok) continue;
    const char = String.fromCodePoint(body.codePointAt(i)!);
    const at = `Segment ${n}, position ${i + 1}: `;
    const message =
      char === '+' || char === '/'
        ? `${at}"${char}" is not used in Base64url. This looks like standard Base64.`
        : char === '='
          ? `${at}"=" may only end a segment.`
          : `${at}${JSON.stringify(char)} is not a Base64url character.`;
    return { ok: false, message, position: i + 1 };
  }
  const bytes = decodeBase64url(body);
  if (!bytes) return { ok: false, message: `Segment ${n} has an impossible length for Base64url.` };
  return { ok: true, bytes, padded: end < segment.length };
};

/** Splits and decodes a pasted token (§5.1, §5.2, §5.7). Any text; the component checks the size first. */
export const decodeToken = (input: string): DecodeResult => {
  const prepared = prepareToken(input);
  if (prepared.text === '') return { ok: false, message: '' };
  const parts = prepared.text.split('.');
  if (parts.length !== 3 && parts.length !== 5) return { ok: false, message: PARTS_MESSAGE(parts.length) };

  const notes: string[] = [];
  const note = preparationNote(prepared);
  if (note) notes.push(note);
  const segments: Uint8Array[] = [];
  for (let i = 0; i < parts.length; i++) {
    const s = decodeSegment(parts[i]!, i + 1);
    if (!s.ok) return { ok: false, message: s.message, segment: i + 1, position: s.position };
    if (s.padded) notes.push(`Segment ${i + 1} has "=" padding, which JWT doesn't use (RFC 7515 §2).`);
    segments.push(s.bytes);
  }

  const header = decodeHeader(segments[0]!);
  const fields = header.ok ? (header.json as Record<string, unknown>) : {};
  const alg = typeof fields.alg === 'string' ? fields.alg : undefined;
  const headerNotes: string[] = [];
  if (typeof fields.cty === 'string' && fields.cty.toUpperCase() === 'JWT') headerNotes.push(NESTED_NOTE);
  if (['jwk', 'x5c', 'jku', 'x5u'].some(name => name in fields)) headerNotes.push(HEADER_KEY_NOTE);

  if (parts.length === 5) {
    notes.push(JWE_MESSAGE);
    return { ok: true, token: { kind: 'jwe', notes, headerNotes, header, signingInput: parts[0]!, alg } };
  }
  return {
    ok: true,
    token: {
      kind: 'jws',
      notes,
      headerNotes,
      header,
      payload: decodePayload(segments[1]!),
      signature: { text: parts[2]!, bytes: segments[2]! },
      signingInput: `${parts[0]}.${parts[1]}`,
      alg,
    },
  };
};
