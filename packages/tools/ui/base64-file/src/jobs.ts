/**
 * The jobs of the Base64 File tool (docs/tools/specs/base64-file.md §5.6), run by its worker (codec.worker.ts) — or on
 * the page where there are no workers (jsdom tests, a host without them). Each job reports through `post`: progress
 * every PROGRESS_BYTES, then its result. Large results are Blobs made of the pieces' Blobs (references, not copies).
 */
import {
  PREVIEW_BYTES,
  PROGRESS_BYTES,
  SHOWN_CHARS,
  createInputDecoder,
  decodeTextBlob,
  encodeBlob,
  previewOutput,
  recogniseBlob,
} from '@workspace/tool-logic-base64-file';
import type { CodecReply, CodecRequest, Decoded } from './codec.worker';
import type { InputError, InputHeader } from '@workspace/tool-logic-base64-file';

const BINARY = 'application/octet-stream';

/** At most one progress report per PROGRESS_BYTES. */
const reporter = (id: number, total: number, post: (reply: CodecReply) => void) => {
  let last = 0;
  return (done: number) => {
    if (done - last < PROGRESS_BYTES && done < total) return;
    last = done;
    post({ id, type: 'progress', done, total });
  };
};
/** The decoded bytes of a string or a Blob, as a Blob of their pieces, with the type of what they are. */
export const decodeSource = async (
  source: Blob | string,
  onBytes?: (done: number) => void,
): Promise<{ ok: true; decoded: Decoded } | { ok: false; error: InputError }> => {
  const parts: Blob[] = [];
  let size = 0;
  let header: InputHeader | null;
  if (typeof source === 'string') {
    const decoder = createInputDecoder();
    const piece = 4 * 1024 * 1024;
    for (let at = 0; ; at += piece) {
      const last = at + piece >= source.length;
      const steps = [decoder.push(source.slice(at, at + piece)), ...(last ? [decoder.end()] : [])];
      for (const step of steps) {
        if (!step.ok) return { ok: false, error: step.error };
        for (const b of step.bytes) {
          parts.push(new Blob([b as Uint8Array<ArrayBuffer>]));
          size += b.length;
        }
      }
      onBytes?.(Math.min(at + piece, source.length));
      if (last) break;
    }
    header = decoder.header;
  } else {
    const r = await decodeTextBlob(
      source,
      b => {
        parts.push(new Blob([b as Uint8Array<ArrayBuffer>]));
        size += b.length;
      },
      onBytes ? { onBytes } : {},
    );
    if (!r.ok) return r;
    header = r.header;
  }
  const blob = new Blob(parts, { type: BINARY });
  return { ok: true, decoded: { blob, size, header, recognised: await recogniseBlob(blob) } };
};

export const runJob = async (data: CodecRequest, post: (reply: CodecReply) => void): Promise<void> => {
  const { id } = data;
  const fail = (error: unknown) =>
    post({ id, type: 'error', message: error instanceof Error ? error.message : String(error) });
  const run = async (): Promise<void> => {
    switch (data.type) {
      case 'recognise':
        return post({ id, type: 'recognised', recognised: await recogniseBlob(data.blob) });
      case 'preview': {
        const head = new Uint8Array(await data.file.slice(0, PREVIEW_BYTES).arrayBuffer());
        return post({
          id,
          type: 'text',
          text: previewOutput(head, data.file.size, data.options, SHOWN_CHARS),
        });
      }
      case 'encode-text': {
        const parts: string[] = [];
        await encodeBlob(data.file, data.options, t => parts.push(t), { onBytes: reporter(id, data.file.size, post) });
        return post({ id, type: 'text', text: parts.join('') });
      }
      case 'encode-blob': {
        const parts: Blob[] = [];
        await encodeBlob(data.file, data.options, t => parts.push(new Blob([t])), {
          onBytes: reporter(id, data.file.size, post),
        });
        return post({ id, type: 'blob', blob: new Blob(parts, { type: BINARY }) });
      }
      case 'decode': {
        const total = typeof data.source === 'string' ? data.source.length : data.source.size;
        const r = await decodeSource(data.source, reporter(id, total, post));
        return post(r.ok ? { id, type: 'decoded', decoded: r.decoded } : { id, type: 'invalid', error: r.error });
      }
    }
  };
  await run().catch(fail);
};
