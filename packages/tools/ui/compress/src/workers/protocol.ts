/**
 * What the page and the tool's workers say to each other (docs/tools/specs/compress.md §5.8, §5.10). The input is bytes
 * (transferred) or a file (a handle: the worker reads it by slices); the output is collected (the whole result up to
 * HOLD_BYTES, the head always, the text verdict) or written to a file the person chose, as it comes.
 */
import type { Collected, Job, RunOutcome } from '@workspace/tool-logic-compress';

export type WorkInput = { kind: 'bytes'; bytes: Uint8Array } | { kind: 'file'; file: Blob };
export type WorkSink = { kind: 'collect' } | { kind: 'file'; handle: FileSystemFileHandle };

export interface WorkRequest {
  id: number;
  job: Job;
  input: WorkInput;
  sink: WorkSink;
  limit?: number;
}

export type WorkReply =
  | { id: number; type: 'progress'; read: number; total: number }
  | { id: number; type: 'done'; outcome: RunOutcome; collected: Collected | null }
  | { id: number; type: 'failure'; message: string };
