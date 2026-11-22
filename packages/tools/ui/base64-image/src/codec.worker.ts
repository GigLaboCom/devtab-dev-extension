/**
 * Encoding a file and decoding a pasted text off the page's thread (docs/tools/specs/base64-image.md §12, §15): 10 MiB
 * of image are 14 Mi characters of Base64, and either direction takes the better part of a second of the shared code —
 * a second the page would stand still. The logic is bundled into this worker (a worker is built as one file); the
 * image's bytes come back transferred, not copied. Loaded from this file by `codec.ts` — never from `blob:` or `data:`.
 * Cancelling is the page terminating the worker. Nothing here decodes pixels: the bytes are read, never drawn.
 */
import { decodeImageInput, encodeImage } from '@workspace/tool-logic-base64-image';
import type { DecodeImageResult } from '@workspace/tool-logic-base64-image';

export type Encoded = ReturnType<typeof encodeImage>;

export type CodecRequest =
  { id: number; type: 'encode'; bytes: Uint8Array } | { id: number; type: 'decode'; text: string };
export type CodecReply =
  | { id: number; type: 'encode'; result: Encoded }
  | { id: number; type: 'decode'; result: DecodeImageResult }
  | { id: number; failure: string };

/** The worker's global scope, as much of it as is used here (the package compiles against the page's DOM types). */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<CodecRequest>) => void) | null;
  postMessage: (reply: CodecReply, transfer: Transferable[]) => void;
};

scope.onmessage = ({ data }) => {
  try {
    if (data.type === 'encode') {
      const result = encodeImage(data.bytes);
      scope.postMessage({ id: data.id, type: 'encode', result }, result.ok ? [result.image.bytes.buffer] : []);
    } else {
      const result = decodeImageInput(data.text);
      scope.postMessage(
        { id: data.id, type: 'decode', result },
        result.ok && result.image ? [result.image.bytes.buffer] : [],
      );
    }
  } catch (error) {
    scope.postMessage({ id: data.id, failure: error instanceof Error ? error.message : String(error) }, []);
  }
};
