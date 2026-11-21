/** Payload, labels, search text and guards of the tool's history entries (the component's chunk only). */
import type { Direction, Layout, YamlVersion } from '@workspace/tool-logic-yaml-json';

/** Payload of schema 1. `action` is set when the person took the result (committed), absent for an edit snapshot. */
export type YamlJsonPayload = {
  direction: Direction;
  version: YamlVersion;
  layout: Layout;
  indent: 2 | 4;
  outcome: 'ok' | 'error';
  documents?: number;
  error?: { message: string; line: number; column: number };
  action?: 'copy' | 'save' | 'swap';
};

const LAYOUT_LABEL: Record<string, string> = { 2: '2 spaces', 4: '4 spaces', tab: 'Tab', minify: 'Minified' };

export const kindOf = (direction: Direction): string => (direction === 'yaml-to-json' ? 'to-json' : 'to-yaml');

export const entryLabel = (p: YamlJsonPayload, inputLength: number): string =>
  [
    p.direction === 'yaml-to-json' ? `YAML ${p.version} → JSON` : 'JSON → YAML',
    LAYOUT_LABEL[String(p.direction === 'yaml-to-json' ? p.layout : p.indent)] ?? '',
    p.outcome === 'error' && p.error ? `error at line ${p.error.line}, column ${p.error.column}` : '',
    p.documents !== undefined && p.documents > 1 ? `${p.documents} documents` : '',
    `${inputLength.toLocaleString('en-US')} characters`,
    p.action === 'copy' ? 'copied' : p.action === 'save' ? 'saved' : p.action === 'swap' ? 'swapped' : '',
  ]
    .filter(Boolean)
    .join(' · ');

/** What History's text search looks in: the start of the input and of the result. */
export const excerpt = (input: string, output: string): string =>
  output === '' ? input.slice(0, 2000) : `${input.slice(0, 1000)}\n${output.slice(0, 1000)}`;

export const isDirection = (v: unknown): v is Direction => v === 'yaml-to-json' || v === 'json-to-yaml';
export const isVersion = (v: unknown): v is YamlVersion => v === '1.1' || v === '1.2';
export const isLayout = (v: unknown): v is Layout => v === 2 || v === 4 || v === 'tab' || v === 'minify';
export const isYamlIndent = (v: unknown): v is 2 | 4 => v === 2 || v === 4;
