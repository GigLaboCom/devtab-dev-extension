/*! zstd: libzstd (BSD, Meta Platforms) compiled to wasm by @tootallnate/zstd-wasm 0.1.0 (MIT) — licences in the package's licenses/. */
import { dataUrlBytes } from './wasm';
import zstdWasm from '@tootallnate/zstd-wasm/zstd.wasm?url&inline';

export const zstdBytes = async (): Promise<Uint8Array> => dataUrlBytes(zstdWasm);
