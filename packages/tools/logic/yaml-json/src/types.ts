/**
 * The types and limits of the YAML and JSON tool (docs/tools/specs/yaml-json.md §9, §12). No code of the library here:
 * the component, the worker and the converter all read these, and only the converter loads `yaml`.
 */
import type { JsonErrorInfo, Layout } from '@workspace/tools-shared/json-scan';

export type YamlVersion = '1.1' | '1.2';
export type Direction = 'yaml-to-json' | 'json-to-yaml';

export interface YamlNote {
  message: string;
  offset: number;
  line: number;
  column: number;
}

export interface ConvertNotes {
  documents: number;
  aliasesExpanded: boolean;
  unknownTags: YamlNote[];
  inexactNumbers: number;
}

export type ConvertResult =
  { ok: true; text: string; notes: ConvertNotes } | { ok: false; error: JsonErrorInfo; moreErrors: number };

export interface YamlToJsonOptions {
  version: YamlVersion;
  layout: Layout;
}

export interface JsonToYamlOptions {
  indent: 2 | 4;
}

/** Characters of input converted 150 ms after each edit (§12); above it, by Run. */
export const LIVE_INPUT = 64 * 1024;
/** Characters of input (and bytes of a file) accepted at all (§12). */
export const MAX_INPUT = 8 * 1024 * 1024;
/** How long the live conversion waits after the last edit (§9). */
export const SETTLE_MS = 150;
/** Nodes produced from inside aliases, over the whole input (§5 «Чтение», 7). */
export const ALIAS_BUDGET = 1_000_000;
/** A result larger than either is not put into the result field (§3; json.md §12): the shared scanner's limits. */
export { SHOW_RESULT_CHARS, SHOW_RESULT_LINES } from '@workspace/tools-shared/json-scan';
