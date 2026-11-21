/**
 * The UUID / ULID tool's history entries (schema 1 of `uuidHistory`): their payloads, labels for the History list and
 * the reading of a payload back. Loaded with the component, not with the definition.
 */
import type { GenerateType, NamespaceId, UuidFormat } from '@workspace/tool-logic-uuid';

/** Payload of schema 1. */
export type GeneratePayload = {
  type: GenerateType;
  /** How many, for v4, v7 and ULID. */
  count?: number;
  format: UuidFormat;
  uppercase: boolean;
  /** v3 and v5 only. */
  namespace?: NamespaceId | 'custom';
  customNamespace?: string;
  name?: string;
  /** The identifiers as shown, one per line in the result. */
  ids: string[];
};

export type InspectPayload = { input: string };

export const TYPE_LABELS: Readonly<Record<GenerateType, string>> = {
  v4: 'UUID v4 (random)',
  v7: 'UUID v7 (time-ordered)',
  ulid: 'ULID',
  v5: 'UUID v5 (name, SHA-1)',
  v3: 'UUID v3 (name, MD5)',
  nil: 'Nil UUID',
  max: 'Max UUID',
};

const SHORT: Readonly<Record<GenerateType, string>> = {
  v4: 'UUID v4',
  v7: 'UUID v7',
  ulid: 'ULID',
  v5: 'UUID v5',
  v3: 'UUID v3',
  nil: 'Nil UUID',
  max: 'Max UUID',
};

export const NAMESPACE_LABELS: Readonly<Record<NamespaceId | 'custom', string>> = {
  dns: 'DNS',
  url: 'URL',
  oid: 'OID',
  x500: 'X.500',
  custom: 'Custom…',
};

const clip = (text: string, n = 60): string => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

/** "UUID v7 · 5 identifiers", "UUID v5 · DNS · www.example.com", "ULID · 01ARZ3NDEKTSV4RRFFQ69G5FAV". */
export const generateLabel = (p: GeneratePayload): string => {
  const parts = [SHORT[p.type]];
  if (p.type === 'v3' || p.type === 'v5') {
    parts.push(p.namespace === 'custom' ? clip(p.customNamespace ?? '') : NAMESPACE_LABELS[p.namespace ?? 'dns']);
    parts.push(p.name === '' || p.name === undefined ? '(empty name)' : clip(p.name));
  } else if (p.ids.length === 1) parts.push(p.ids[0]!);
  else parts.push(`${p.ids.length.toLocaleString('en-US')} identifiers`);
  return parts.join(' · ');
};

/** The first characters, for the History list's text search. */
export const excerpt = (text: string): string => text.slice(0, 2000);

const TYPES = new Set(Object.keys(TYPE_LABELS));
const FORMATS = new Set(['standard', 'no-hyphens', 'braces', 'urn']);
const NAMESPACE_IDS = new Set(Object.keys(NAMESPACE_LABELS));

/** A payload read back from History, checked field by field (an older or damaged entry falls back to defaults). */
export const readGeneratePayload = (value: unknown): GeneratePayload => {
  const p = (value ?? {}) as Partial<Record<keyof GeneratePayload, unknown>>;
  return {
    type: typeof p.type === 'string' && TYPES.has(p.type) ? (p.type as GenerateType) : 'v4',
    ...(typeof p.count === 'number' ? { count: p.count } : {}),
    format: typeof p.format === 'string' && FORMATS.has(p.format) ? (p.format as UuidFormat) : 'standard',
    uppercase: p.uppercase === true,
    ...(typeof p.namespace === 'string' && NAMESPACE_IDS.has(p.namespace)
      ? { namespace: p.namespace as NamespaceId | 'custom' }
      : {}),
    ...(typeof p.customNamespace === 'string' ? { customNamespace: p.customNamespace } : {}),
    ...(typeof p.name === 'string' ? { name: p.name } : {}),
    ids: Array.isArray(p.ids) ? p.ids.filter((id): id is string => typeof id === 'string') : [],
  };
};
