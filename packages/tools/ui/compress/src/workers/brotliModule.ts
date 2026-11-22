/*! brotli decoder: Google's brotli (MIT) compiled to wasm by @tootallnate/brotli-wasm 0.1.0 (MIT) — licences in the package's licenses/. */
import { dataUrlBytes } from './wasm';
import brotliWasm from '@tootallnate/brotli-wasm/brotli.wasm?url&inline';

export const brotliBytes = async (): Promise<Uint8Array> => dataUrlBytes(brotliWasm);
