/**
 * Converts off the page's thread (docs/tools/specs/yaml-json.md §9, §12): the request is the text and its options, the
 * reply the result. The converter and the yaml library are bundled into this worker (a worker is built as one file);
 * the page never loads them while it has workers. Loaded from this file by `conversion.ts` — never from `blob:` or
 * `data:`. Cancelling is the page terminating the worker.
 */
import { jsonToYaml, yamlToJson } from '@workspace/tool-logic-yaml-json';
import type { ConvertJob } from './conversion';
import type { ConvertResult } from '@workspace/tool-logic-yaml-json';

export type ConvertRequest = ConvertJob & { id: number };
export type ConvertReply = { id: number; result: ConvertResult } | { id: number; failure: string };

/** The worker's global scope, as much of it as is used here (the package compiles against the page's DOM types). */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ConvertRequest>) => void) | null;
  postMessage: (reply: ConvertReply) => void;
};

scope.onmessage = ({ data }) => {
  try {
    const result =
      data.direction === 'yaml-to-json'
        ? yamlToJson(data.text, { version: data.version, layout: data.layout })
        : jsonToYaml(data.text, { indent: data.indent });
    scope.postMessage({ id: data.id, result });
  } catch (error) {
    scope.postMessage({ id: data.id, failure: error instanceof Error ? error.message : String(error) });
  }
};
