/** The types of docs/tools/specs/curl-to-code.md §9, with the additions its §15 lists (binary and file bodies). */

export type Target = 'javascript' | 'python' | 'go' | 'rust';

/** A field of a multipart form: a text value, or a file the code reads when it runs. */
export type FormField = { name: string; value: string } | { name: string; file: string; filename: string };

export type Body =
  | { kind: 'raw'; text: string }
  /** Bytes that are not UTF-8 text (bash's $'\xff'). */
  | { kind: 'binary'; bytes: Uint8Array }
  | { kind: 'multipart'; fields: FormField[] }
  /**
   * The whole body is a file, read by the code when it runs: `-d @file` (curl removes its line breaks: `strip`),
   * `--data-binary @file`, `--json @file`, `-T file`.
   */
  | { kind: 'file'; path: string; strip: boolean };

export interface CurlRequest {
  method: string;
  url: string;
  /** Merged, in order (§5 «Запрос»). */
  headers: Array<[name: string, value: string]>;
  body: Body | null;
  user: [user: string, password: string] | null;
  insecure: boolean;
  timeoutSeconds: number | null;
}

export type Parsed =
  { ok: true; request: CurlRequest; warnings: string[] } | { ok: false; message: string; offset: number };

export interface ErrorInfo {
  message: string;
  offset: number;
  line: number;
  column: number;
}

export type CodeResult =
  { ok: true; text: string; warnings: string[]; hasCredentials: boolean } | { ok: false; error: ErrorInfo };

/** One client's code for a request (generate.ts). */
export interface Generated {
  text: string;
  warnings: string[];
}

/** A client the code is written for: one per Target, all with the same contract (generate.test.ts). */
export interface Generator {
  generate(request: CurlRequest): Generated;
}
