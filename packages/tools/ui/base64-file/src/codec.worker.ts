/**
 * The Base64 File tool's work off the page's thread (docs/tools/specs/base64-file.md §5.6): a file arrives as a handle
 * (a File or Blob — not its bytes) and is read a piece at a time; a long Base64 text arrives as a Blob or a string and is
 * decoded a piece at a time. Results that can be large leave as Blobs built from the pieces' Blobs (references, not
 * copies), so the whole Base64 text of a large file is never a string or an array here or on the page. Loaded from this
 * file by `codec.ts` — never from `blob:` or `data:`. Cancelling is the page terminating the worker. Nothing here runs,
 * renders or loads the bytes it reads.
 */
import { runJob } from './jobs';
import type { EncodeOptions, InputError, InputHeader, Recognised } from '@workspace/tool-logic-base64-file';

export type CodecRequest =
  | { id: number; type: 'recognise'; blob: Blob }
  | { id: number; type: 'encode-text'; file: Blob; options: EncodeOptions }
  | { id: number; type: 'preview'; file: Blob; options: EncodeOptions }
  | { id: number; type: 'encode-blob'; file: Blob; options: EncodeOptions }
  | { id: number; type: 'decode'; source: Blob | string };

export interface Decoded {
  blob: Blob;
  size: number;
  header: InputHeader | null;
  recognised: Recognised;
}

export type CodecReply =
  | { id: number; type: 'progress'; done: number; total: number }
  | { id: number; type: 'recognised'; recognised: Recognised }
  | { id: number; type: 'text'; text: string }
  | { id: number; type: 'blob'; blob: Blob }
  | { id: number; type: 'decoded'; decoded: Decoded }
  | { id: number; type: 'invalid'; error: InputError }
  | { id: number; type: 'error'; message: string };

/** The worker's global scope, as much of it as is used here (the package compiles against the page's DOM types). */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<CodecRequest>) => void) | null;
  postMessage: (reply: CodecReply) => void;
};

scope.onmessage = ({ data }) => void runJob(data, reply => scope.postMessage(reply));
