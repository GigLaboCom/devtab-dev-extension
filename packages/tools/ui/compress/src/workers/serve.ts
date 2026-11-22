/**
 * The body of every worker of the tool (and of the page where there are no workers): runs one request with the codecs
 * that worker carries. Progress is posted at most every 16 MiB of input or 100 ms, whichever comes later.
 */
import { NOT_SAVED, blobSource, bytesSource, createCollector, run } from '@workspace/tool-logic-compress';
import type { WorkReply, WorkRequest } from './protocol';
import type { Codecs, Sink } from '@workspace/tool-logic-compress';

const PROGRESS_BYTES = 16 * 1024 * 1024;
const PROGRESS_MS = 100;
const WRITE_BYTES = 1024 * 1024;

export const handle = async (request: WorkRequest, codecs: Codecs, post: (reply: WorkReply) => void): Promise<void> => {
  const { id, job, input, sink: target } = request;
  const source = input.kind === 'bytes' ? bytesSource(input.bytes) : blobSource(input.file);
  let posted = 0;
  let postedAt = 0;
  const onProgress = (read: number, total: number): void => {
    const now = Date.now();
    if (read - posted < PROGRESS_BYTES && now - postedAt < PROGRESS_MS && read < total) return;
    posted = read;
    postedAt = now;
    post({ id, type: 'progress', read, total });
  };
  try {
    if (target.kind === 'collect') {
      const collector = createCollector();
      const outcome = await run(job, source, collector, {
        codecs,
        onProgress,
        ...(request.limit ? { limit: request.limit } : {}),
      });
      post({ id, type: 'done', outcome, collected: outcome.ok ? collector.result() : null });
      return;
    }
    // Save as a stream into the file the person chose: nothing is collected.
    const writable = await target.handle.createWritable();
    // Each write is a round trip to the browser's file writer: the output (often 16 KiB pieces) goes in 1 MiB writes
    // (measured: 1.2 GiB took 164 s in pieces, see the specification's §15).
    const buffer = new Uint8Array(WRITE_BYTES);
    let filled = 0;
    const flush = async (): Promise<void> => {
      if (filled === 0) return;
      await writable.write(buffer.slice(0, filled));
      filled = 0;
    };
    const sink: Sink = {
      write: async chunk => {
        for (let at = 0; at < chunk.length;) {
          const take = Math.min(chunk.length - at, WRITE_BYTES - filled);
          buffer.set(chunk.subarray(at, at + take), filled);
          filled += take;
          at += take;
          if (filled === WRITE_BYTES) await flush();
        }
      },
      reset: async () => {
        filled = 0;
        await writable.truncate(0);
      },
    };
    const outcome = await run(job, source, sink, {
      codecs,
      onProgress,
      ...(request.limit ? { limit: request.limit } : {}),
    });
    if (outcome.ok) {
      await flush();
      await writable.close();
    } else await writable.abort().catch(() => undefined);
    post({ id, type: 'done', outcome, collected: null });
  } catch (error) {
    post({
      id,
      type: 'failure',
      message: target.kind === 'file' ? NOT_SAVED : error instanceof Error ? error.message : String(error),
    });
  }
};

/** The worker's global scope, as much of it as is used here (the package compiles against the page's DOM types). */
export const serve = (codecs: Codecs): void => {
  const scope = self as unknown as {
    onmessage: ((event: MessageEvent<WorkRequest>) => void) | null;
    postMessage: (reply: WorkReply, transfer?: Transferable[]) => void;
  };
  scope.onmessage = ({ data }) =>
    void handle(data, codecs, reply => {
      const transfer: Transferable[] = [];
      if (reply.type === 'done' && reply.collected) {
        if (reply.collected.bytes) transfer.push(reply.collected.bytes.buffer);
        if (reply.collected.head.buffer !== reply.collected.bytes?.buffer) transfer.push(reply.collected.head.buffer);
      }
      scope.postMessage(reply, transfer);
    });
};
