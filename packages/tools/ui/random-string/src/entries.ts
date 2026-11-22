/**
 * The form's fields and the history entries of the Random String tool: the draft a batch is recorded as, its label, and
 * reading an entry back. An entry comes from storage and maybe from an older or edited file, so it is checked field by
 * field and against its settings, never trusted.
 */
import {
  DEFAULTS,
  ENCODING_LABELS,
  ENCODING_ORDER,
  PRESET_LABELS,
  PRESET_ORDER,
  encodeBytes,
  fitsSettings,
  parseWholeNumber,
} from '@workspace/tool-logic-random-string';
import type { RandomStringPayload } from './history';
import type { Encoding, Generated, Mode, Preset, Settings } from '@workspace/tool-logic-random-string';
import type { HistoryDraft, OpenedEntry } from '@workspace/tools-host';

/** The form: number fields as typed (an empty or a fractional one is an error at the field, §3). */
export interface Fields {
  mode: Mode;
  preset: Preset;
  custom: string;
  length: string;
  bytes: string;
  encoding: Encoding;
  count: string;
}

export const DEFAULT_FIELDS: Fields = {
  mode: DEFAULTS.mode,
  preset: DEFAULTS.preset,
  custom: DEFAULTS.custom,
  length: String(DEFAULTS.length),
  bytes: String(DEFAULTS.bytes),
  encoding: DEFAULTS.encoding,
  count: String(DEFAULTS.count),
};

export const settingsOf = (f: Fields): Settings =>
  f.mode === 'chars'
    ? {
        mode: 'chars',
        preset: f.preset,
        custom: f.custom,
        length: parseWholeNumber(f.length),
        count: parseWholeNumber(f.count),
      }
    : { mode: 'bytes', bytes: parseWholeNumber(f.bytes), encoding: f.encoding, count: parseWholeNumber(f.count) };

/** The form showing `settings`; what they do not name (the other mode's fields) stays as in `base`. */
export const fieldsOf = (settings: Settings, base: Fields): Fields =>
  settings.mode === 'chars'
    ? {
        ...base,
        mode: 'chars',
        preset: settings.preset,
        custom: settings.custom,
        length: String(settings.length),
        count: String(settings.count),
      }
    : {
        ...base,
        mode: 'bytes',
        bytes: String(settings.bytes),
        encoding: settings.encoding,
        count: String(settings.count),
      };

type Made = Extract<Generated, { ok: true }>;

const thousands = (n: number): string => n.toLocaleString('en-US');

/** The History list's line for an entry (inside the encryption, like the rest of a secret entry). No string in it. */
export const generatedLabel = (settings: Settings, bits: number): string => {
  const what = settings.count === 1 ? 'String' : `${thousands(settings.count)} strings`;
  const shape =
    settings.mode === 'chars'
      ? `${thousands(settings.length)} characters · ${
          settings.preset === 'custom' ? 'Custom alphabet' : PRESET_LABELS[settings.preset]
        }`
      : `${thousands(settings.bytes)} bytes · ${ENCODING_LABELS[settings.encoding]}`;
  return `${what} · ${shape} · ${thousands(bits)} bits`;
};

/** A batch as a history draft: the settings in the payload, the strings (or the raw bytes) as a blob. */
export const draftOf = (settings: Settings, made: Made, bits: number): HistoryDraft => {
  const payload: RandomStringPayload = { settings };
  return {
    kind: 'generated',
    // Plain JSON (numbers and strings); TypeScript does not take the logic's union type for a JSON object.
    payload: payload as unknown as HistoryDraft['payload'],
    label: generatedLabel(settings, bits),
    blobs:
      settings.mode === 'bytes' && made.bytes
        ? { bytes: new Blob([made.bytes.slice()], { type: 'application/octet-stream' }) }
        : { strings: new Blob([made.values.join('\n')], { type: 'text/plain;charset=utf-8' }) },
  };
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isWhole = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** The settings of a payload of schema 1, or null when it is not one. */
export const readSettings = (payload: unknown): Settings | null => {
  if (!isRecord(payload) || !isRecord(payload.settings)) return null;
  const s = payload.settings;
  if (!isWhole(s.count)) return null;
  if (s.mode === 'chars') {
    const preset = PRESET_ORDER.find(p => p === s.preset);
    if (!preset || typeof s.custom !== 'string' || !isWhole(s.length)) return null;
    return { mode: 'chars', preset, custom: s.custom, length: s.length, count: s.count };
  }
  if (s.mode === 'bytes') {
    const encoding = ENCODING_ORDER.find(e => e === s.encoding);
    if (!encoding || !isWhole(s.bytes)) return null;
    return { mode: 'bytes', bytes: s.bytes, encoding, count: s.count };
  }
  return null;
};

/** An opened entry as settings and the batch it showed, or null when it is not a whole, consistent entry. */
export const readEntry = async (
  opened: Extract<OpenedEntry, { ok: true }>,
): Promise<{ settings: Settings; values: string[]; bytes?: Uint8Array } | null> => {
  const settings = readSettings(opened.payload);
  if (!settings) return null;
  if (settings.mode === 'bytes') {
    const blob = opened.blobs.bytes;
    if (!blob || blob.size !== settings.bytes * settings.count) return null;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const values = Array.from({ length: settings.count }, (_, i) =>
      encodeBytes(bytes.subarray(i * settings.bytes, (i + 1) * settings.bytes), settings.encoding),
    );
    return fitsSettings(values, settings) ? { settings, values, bytes } : null;
  }
  const blob = opened.blobs.strings;
  if (!blob) return null;
  const values = (await blob.text()).split('\n');
  return fitsSettings(values, settings) ? { settings, values } : null;
};
