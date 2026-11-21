/**
 * @workspace/tool-logic-yaml-json — the YAML and JSON tool's logic. The definition on the start page uses `detectYaml`
 * only; the bundler takes from a package without side effects only what is used, so the converter and the `yaml`
 * library stay out of that chunk. The tool's worker uses `yamlToJson` / `jsonToYaml` (bundled into the worker: workers
 * are built as one file, without dynamic imports); a page without workers loads them with `loadConverter`, a chunk of
 * its own.
 */
export { detectYaml } from './detect';
export { jsonToYaml, yamlToJson } from './convert';
export { loadConverter } from './load';
export type { Converter } from './load';
export { ALIASES_EXPANDED, LOST_IN_JSON, describeNotes } from './notes';
export { MAX_DEPTH, decodeTextFile, isInexactNumber, parseJsonTree, positionOf } from './json-scan';
export type { Indent, JsonErrorInfo, JsonNode, JsonTreeResult, Layout } from './json-scan';
export * from './types';
