/**
 * Base64url without padding (RFC 4648 §5, RFC 7515 §2) and strict UTF-8 — the two decoders a token's parts need. The tool's own
 * strict decoder: a part of a token admits only `A–Z a–z 0–9 - _`, unlike the forgiving shared `parseBase64`.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const VALUE = new Int8Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) VALUE[ALPHABET.charCodeAt(i)] = i;

/** Is every character of `text` one of `A–Z a–z 0–9 - _`? */
export const isBase64url = (text: string): boolean => {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 128 || VALUE[c]! < 0) return false;
  }
  return true;
};

/**
 * The bytes of unpadded base64url text, or null when a character is outside the alphabet or the length leaves a
 * remainder of 1 modulo 4 (no byte ends there). Left-over bits of the last character are ignored, as decoders do.
 */
export const decodeBase64url = (text: string): Uint8Array<ArrayBuffer> | null => {
  if (text.length % 4 === 1 || !isBase64url(text)) return null;
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let bits = 0;
  let acc = 0;
  let o = 0;
  for (let i = 0; i < text.length; i++) {
    acc = (acc << 6) | VALUE[text.charCodeAt(i)]!;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out;
};

let decoder: InstanceType<typeof TextDecoder> | undefined;

/** Strict UTF-8 (a byte order mark kept as U+FEFF); null when the bytes are not UTF-8. */
export const strictUtf8 = (bytes: Uint8Array): string | null => {
  decoder ??= new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  try {
    return decoder.decode(bytes);
  } catch {
    return null;
  }
};
