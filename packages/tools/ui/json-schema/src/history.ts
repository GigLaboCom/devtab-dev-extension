/**
 * What the tool history keeps of the JSON Schema tool (D17; docs/tools/history.md §10, row `json-schema`), as the JSON
 * and JSON Query tools do — in clear: a validation's schema, document and referenced schemas, and a generation's
 * samples, as edit snapshots; each result a person takes — Copy violations, Copy problems, Copy of the generated
 * schema, Validate with it — at once. The inputs go into blobs; the copied text is not kept (the inputs give it again).
 * The declaration and the payload's types only: labels and readers live in entries.ts.
 */
import type { HistoryDeclaration } from '@workspace/tools-host';

export const jsonSchemaHistory: HistoryDeclaration = {
  kinds: [
    { id: 'validate', title: 'Validation' },
    { id: 'infer', title: 'Generated schema' },
    { id: 'result', title: 'Copied' },
  ],
  schema: 1,
  records:
    'The schema, the document and the referenced schemas you validated, the samples you generated a schema from, the options, and each result you copied.',
  never:
    'Inputs over the size limits (the tool does not take them) and the copied text itself. Kept in clear as written — a master password does not encrypt it.',
};

export type DraftId = '2020-12' | '2019-09' | 'draft-07' | 'draft-06' | 'draft-04';

/** Schema 1: a validation snapshot (`validate`). The texts are blobs `schema`, `document`, `referenced-<n>`. */
export type ValidatePayload = {
  draft: DraftId;
  formats: boolean;
  referenced: number;
  /** What the check of this state gave, when it had answered. */
  outcome?: { valid: boolean; count: number } | { problems: number } | { error: string };
};

/** Schema 1: a generation snapshot (`infer`). The samples are the blob `samples`. */
export type InferPayload = {
  draft: DraftId;
  enums: boolean;
  formats: boolean;
  closed: boolean;
  samples?: number;
};

/** Schema 1: a result taken (`result`), with the options and blobs of its task. */
export type ResultPayload =
  | ({ task: 'validate'; action: 'copy-violations' | 'copy-problems'; count: number } & Omit<
      ValidatePayload,
      'outcome'
    >)
  | ({ task: 'infer'; action: 'copy-schema' | 'validate-with-it' } & InferPayload);
