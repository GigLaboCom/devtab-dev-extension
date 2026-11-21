/** Small byte helpers of the history: UTF-8, hex, Base64 (standard alphabet, padded), ids. Pure; Node and pages. */

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export const utf8 = (text: string): Uint8Array<ArrayBuffer> => encoder.encode(text) as Uint8Array<ArrayBuffer>;
export const fromUtf8 = (bytes: Uint8Array): string => decoder.decode(bytes);
export const utf8Length = (text: string): number => encoder.encode(text).byteLength;

export const toHex = (bytes: Uint8Array): string => {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
};

export const fromHex = (hex: string): Uint8Array<ArrayBuffer> => {
  if (hex.length % 2 || /[^0-9a-f]/i.test(hex)) throw new Error('not hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};

export const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

export const fromBase64 = (text: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
};

export const concatBytes = (parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
};

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * A history id: 26 characters of Crockford Base32 — 10 for the time in ms, 16 random (80 bits), the layout of a ULID —
 * so ids sort by time as text. Monotonic within one generator: two ids in the same millisecond still sort in order.
 */
export const idGenerator = (random: (n: number) => Uint8Array = n => crypto.getRandomValues(new Uint8Array(n))) => {
  let lastTime = -1;
  let last: number[] = [];
  return (time: number): string => {
    let tail: number[];
    if (time <= lastTime) {
      tail = [...last];
      for (let i = tail.length - 1; i >= 0; i--) {
        if (tail[i] < 31) {
          tail[i]++;
          break;
        }
        tail[i] = 0;
      }
      time = lastTime;
    } else {
      const bytes = random(16);
      tail = [...bytes].map(b => b & 31);
    }
    lastTime = time;
    last = tail;
    let head = '';
    let t = time;
    for (let i = 0; i < 10; i++) {
      head = CROCKFORD[t % 32] + head;
      t = Math.floor(t / 32);
    }
    return head + tail.map(n => CROCKFORD[n]).join('');
  };
};

export const ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
