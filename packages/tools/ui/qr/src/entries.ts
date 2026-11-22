/**
 * The QR Code tool's history entries (schema 1 of its payload): what each kind carries, how the History list labels
 * it, and reading a payload back. Kept out of history.ts, which every host page that lists the tools loads.
 */
import {
  DEFAULT_LEVEL,
  DEFAULT_MODULE_PX,
  DEFAULT_QUIET,
  LEVELS,
  MODULE_PX,
  QUIET_ZONES,
} from '@workspace/tool-logic-qr';
import type { Level, ModulePx, QuietZone, WifiDetails, WifiSecurity } from '@workspace/tool-logic-qr';
import type { HistoryDraft } from '@workspace/tools-host';

export interface CodeOptions {
  level: Level;
  quiet: QuietZone;
  px: ModulePx;
}

/** A code made (`made`, `made-secret`): the text, or the Wi-Fi form's fields, and the options. */
export type MadePayload = CodeOptions & ({ content: 'text'; text: string } | { content: 'wifi'; wifi: WifiDetails });

/** A code read (`read`, `read-secret`): its text only — never the image. */
export interface ReadPayload {
  text: string;
  /** Codes found in the image. */
  count: number;
  /** The code's bytes in hex when they are not text. */
  hex?: string;
}

const short = (text: string, n = 60): string => {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > n ? `${line.slice(0, n - 1)}…` : line || '(spaces)';
};

/** The first characters of the text, for the History list's search (inside the encrypted record for a secret). */
const excerpt = (text: string): string => text.slice(0, 2000);

export const madeDraft = (payload: MadePayload, encoded: string, secret: boolean): HistoryDraft => ({
  kind: secret ? 'made-secret' : 'made',
  payload: { ...payload } as unknown as HistoryDraft['payload'],
  label:
    payload.content === 'wifi'
      ? `Wi-Fi · ${short(payload.wifi.ssid, 40)} · level ${payload.level}`
      : `${short(payload.text)} · level ${payload.level}`,
  text: excerpt(encoded),
});

export const readDraft = (payload: ReadPayload, secret: boolean): HistoryDraft => ({
  kind: secret ? 'read-secret' : 'read',
  payload: { ...payload },
  label: `Read · ${short(payload.text)}`,
  text: excerpt(payload.text),
});

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const oneOf = <T>(list: readonly T[], v: unknown, fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);
const SECURITIES: readonly WifiSecurity[] = ['wpa', 'wep', 'none'];

/** A made entry's payload, with defaults for anything missing or odd. */
export const readMade = (payload: unknown): MadePayload => {
  const p = isRecord(payload) ? payload : {};
  const options: CodeOptions = {
    level: oneOf(LEVELS, p.level, DEFAULT_LEVEL),
    quiet: oneOf(QUIET_ZONES, p.quiet, DEFAULT_QUIET),
    px: oneOf(MODULE_PX, p.px, DEFAULT_MODULE_PX),
  };
  if (p.content === 'wifi' && isRecord(p.wifi)) {
    const w = p.wifi;
    return {
      ...options,
      content: 'wifi',
      wifi: {
        ssid: typeof w.ssid === 'string' ? w.ssid : '',
        password: typeof w.password === 'string' ? w.password : '',
        security: oneOf(SECURITIES, w.security, 'wpa'),
        hidden: w.hidden === true,
      },
    };
  }
  return { ...options, content: 'text', text: typeof p.text === 'string' ? p.text : '' };
};

/** A read entry's payload. */
export const readRead = (payload: unknown): ReadPayload => {
  const p = isRecord(payload) ? payload : {};
  return {
    text: typeof p.text === 'string' ? p.text : '',
    count: typeof p.count === 'number' && p.count >= 1 ? p.count : 1,
    ...(typeof p.hex === 'string' ? { hex: p.hex } : {}),
  };
};
