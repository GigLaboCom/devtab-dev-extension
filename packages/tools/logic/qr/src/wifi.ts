/**
 * Wi-Fi details as a QR code's text (docs/tools/specs/qr.md §5.3): the `WIFI:` string of ZXing's "Barcode Contents"
 * — there is no standard; Android's and iOS's cameras read this form — and its parsing back.
 *
 * Writing: `WIFI:T:<type>;S:<name>;P:<password>;H:true;;`, fields in this order; `\`, `;`, `,`, `:` and `"` in the name
 * and the password escaped with a backslash; no `P` for an open network; `H:true;` only for a hidden one.
 *
 * Reading: `key:value` pairs up to an unescaped `;`, `\x` → `x`; a value wrapped in unescaped double quotes (ZXing's way
 * to say "an ASCII name that could be read as hex") loses them. Fields in any order; the first of a repeated key wins.
 */

export type WifiSecurity = 'wpa' | 'wep' | 'none';

export interface WifiDetails {
  ssid: string;
  password: string;
  security: WifiSecurity;
  hidden: boolean;
}

export interface ParsedWifi {
  ssid: string;
  /** The `T` value as written (`WPA`, `WEP`, `nopass`, `SAE`, …); `nopass` without one. */
  security: string;
  password: string;
  hidden: boolean;
}

export const SECURITY_OPTIONS: ReadonlyArray<{ value: WifiSecurity; label: string }> = [
  { value: 'wpa', label: 'WPA/WPA2/WPA3' },
  { value: 'wep', label: 'WEP' },
  { value: 'none', label: 'None' },
];

export const EMPTY_WIFI: WifiDetails = { ssid: '', password: '', security: 'wpa', hidden: false };

const TYPE: Readonly<Record<WifiSecurity, string>> = { wpa: 'WPA', wep: 'WEP', none: 'nopass' };

/** `\`, `;`, `,`, `:` and `"` get a backslash (the backslash first). */
export const escapeWifi = (value: string): string => value.replace(/[\\;,:"]/g, c => `\\${c}`);

/** §5.3: the string the code holds. */
export const wifiString = ({ ssid, password, security, hidden }: WifiDetails): string =>
  `WIFI:T:${TYPE[security]};S:${escapeWifi(ssid)};${security === 'none' ? '' : `P:${escapeWifi(password)};`}${
    hidden ? 'H:true;' : ''
  };`;

/** §5.3, the way back: the fields of a `WIFI:` text that names a network (`S`), or null. */
export const parseWifi = (text: string): ParsedWifi | null => {
  if (!text.startsWith('WIFI:')) return null;
  const fields = new Map<string, string>();
  let i = 5;
  while (i < text.length) {
    if (text[i] === ';') {
      i++;
      continue;
    }
    const colon = text.indexOf(':', i);
    if (colon < 0) return null;
    const key = text.slice(i, colon);
    if (!/^[A-Za-z0-9]{1,8}$/.test(key)) return null;
    let value = '';
    // Whether the value's first and last characters were unescaped double quotes.
    let openQuote = false;
    let lastUnescapedQuote = false;
    let j = colon + 1;
    let ended = false;
    for (; j < text.length; j++) {
      const c = text[j]!;
      if (c === '\\' && j + 1 < text.length) {
        value += text[++j];
        lastUnescapedQuote = false;
        continue;
      }
      if (c === ';') {
        ended = true;
        break;
      }
      if (c === '"' && value === '') openQuote = true;
      lastUnescapedQuote = c === '"';
      value += c;
    }
    if (!ended) return null;
    if (openQuote && lastUnescapedQuote && value.length >= 2) value = value.slice(1, -1);
    if (!fields.has(key)) fields.set(key, value);
    i = j + 1;
  }
  const ssid = fields.get('S');
  if (ssid === undefined) return null;
  return {
    ssid,
    security: fields.get('T') || 'nopass',
    password: fields.get('P') ?? '',
    hidden: (fields.get('H') ?? '').toLowerCase() === 'true',
  };
};

const HEX = /^[0-9A-Fa-f]+$/;

/**
 * What a phone will make of the password, said under the form (§15 of the specification): phones take a password of
 * hexadecimal digits of a key's length as the raw key — WPA: 64 digits (a passphrase has 8 to 63 characters); WEP: 10,
 * 26 or 58 digits — and a WPA password outside 8–63 characters is refused when joining.
 */
export const wifiNotes = ({ password, security }: WifiDetails): string[] => {
  if (security === 'none') return [];
  if (password === '') return ['No password: choose None if the network is open.'];
  const hex = HEX.test(password);
  if (security === 'wpa') {
    if (hex && password.length === 64)
      return ['64 hexadecimal digits: phones use them as the network’s raw key, not as a passphrase.'];
    const length = [...password].length;
    if (length < 8 || length > 63)
      return ['A WPA passphrase has 8 to 63 characters; phones may refuse to join with this one.'];
    return [];
  }
  if (hex && [10, 26, 58].includes(password.length))
    return [`${password.length} hexadecimal digits: phones use them as the WEP key in hex.`];
  return [];
};

/** Shown instead of a password until the person asks to see it. */
export const PASSWORD_MASK = '••••••••';

/**
 * A `WIFI:` text with the password's value masked, for showing (the code and Copy keep the real text): the value of
 * every `P` field, escapes and all, becomes `••••••••`; an empty password stays empty; anything else is untouched.
 */
export const maskWifiPassword = (text: string): string => {
  if (!text.startsWith('WIFI:')) return text;
  let out = 'WIFI:';
  let i = 5;
  while (i < text.length) {
    if (text[i] === ';') {
      out += ';';
      i++;
      continue;
    }
    const colon = text.indexOf(':', i);
    if (colon < 0) return out + text.slice(i);
    let j = colon + 1;
    for (; j < text.length && text[j] !== ';'; j++) if (text[j] === '\\') j++;
    const end = Math.min(j, text.length);
    const key = text.slice(i, colon);
    const value = text.slice(colon + 1, end);
    out += `${key}:${key === 'P' && value !== '' ? PASSWORD_MASK : value}`;
    i = end;
  }
  return out;
};
