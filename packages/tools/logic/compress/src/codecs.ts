/**
 * zstd and brotli (docs/tools/specs/compress.md §5.9): libzstd of `@tootallnate/zstd-wasm` 0.1.0 and Google's brotli
 * decoder of `@tootallnate/brotli-wasm` 0.1.0, driven here through the C functions their modules export (neither module
 * imports anything). The packages' own JavaScript is not used: their zstd reader never checks that the last frame
 * ended (a cut stream passes as whole) and may leave the tail of the output unwritten, and their brotli reader skips
 * the bytes after the end of the stream without a word. These drivers pull: one call into the module per step, at
 * most one output buffer (128 KiB zstd, 64 KiB brotli) per step — so the caller holds the output limit exactly and
 * waits on its sink between steps. Brotli compression is the `brotli` package's encoder (no stream: whole input).
 *
 * The module's bytes come through a seam (`WasmSource`): from a Base64 string built into the worker's chunk on a page,
 * from the package's file in Node's tests.
 */
import { libraryFailed } from './messages';

/** The module's bytes. (The logic compiles without the DOM library, which is where WebAssembly's types live.) */
export type WasmBytes = ArrayBuffer | ArrayBufferView;
export type WasmSource = () => Promise<WasmBytes>;
type CompiledModule = object;
declare const WebAssembly: {
  compile(bytes: WasmBytes): Promise<CompiledModule>;
  instantiate(module: CompiledModule, imports: object): Promise<{ exports: unknown }>;
};

/** The structure both modules' `*_stream` functions read and update (their `JsBuf`: six u32, little-endian). */
const SRC = 0;
const SRC_SIZE = 4;
const SRC_POS = 8;
const DST = 12;
const DST_SIZE = 16;
const DST_POS = 20;
const JSBUF = 24;

type Fn = (...args: number[]) => number;
interface ModuleExports {
  memory: { buffer: ArrayBuffer };
  [name: string]: unknown;
}

const modules = new WeakMap<WasmSource, Promise<unknown>>();

/** Compiles a module once per source (the compiled module is reused; every stream gets its own instance). */
const instantiate = async (source: WasmSource, what: string): Promise<ModuleExports> => {
  try {
    let compiled = modules.get(source);
    if (!compiled) {
      compiled = source().then(bytes => WebAssembly.compile(bytes));
      modules.set(source, compiled);
      compiled.catch(() => modules.delete(source));
    }
    const instance = await WebAssembly.instantiate((await compiled) as CompiledModule, {});
    return instance.exports as unknown as ModuleExports;
  } catch {
    throw new LibraryError(what);
  }
};

export class LibraryError extends Error {}

/** One step of a stream: the bytes it produced (a copy), what it returned, and whether its input is used up. */
export interface Step {
  out: Uint8Array;
  ret: number;
  /** The step's input is consumed. */
  drained: boolean;
  /** The output buffer filled: call again before giving more input. */
  full: boolean;
  /** Bytes of the current input consumed so far. */
  consumed: number;
}

class WasmStream {
  private srcSize = 0;
  private srcPos = 0;
  constructor(
    protected readonly ex: ModuleExports,
    protected readonly ctx: number,
    private readonly inPtr: number,
    private readonly inCap: number,
    private readonly outPtr: number,
    private readonly outCap: number,
    private readonly bufPtr: number,
  ) {}

  protected fn(name: string): Fn {
    return this.ex[name] as Fn;
  }

  /** Gives the stream its next input (at most `inCap` bytes); the previous one must be drained. */
  setInput(bytes: Uint8Array): void {
    if (bytes.length > this.inCap) throw new RangeError('input too large for the stream buffer');
    new Uint8Array(this.ex.memory.buffer).set(bytes, this.inPtr);
    this.srcSize = bytes.length;
    this.srcPos = 0;
  }

  protected call(run: (buf: number) => number): Step {
    let view = new DataView(this.ex.memory.buffer, this.bufPtr, JSBUF);
    view.setUint32(SRC, this.inPtr, true);
    view.setUint32(SRC_SIZE, this.srcSize, true);
    view.setUint32(SRC_POS, this.srcPos, true);
    view.setUint32(DST, this.outPtr, true);
    view.setUint32(DST_SIZE, this.outCap, true);
    view.setUint32(DST_POS, 0, true);
    const ret = run(this.bufPtr);
    // The call may have grown the memory: views are taken again.
    view = new DataView(this.ex.memory.buffer, this.bufPtr, JSBUF);
    const dstPos = view.getUint32(DST_POS, true);
    this.srcPos = view.getUint32(SRC_POS, true);
    const out = new Uint8Array(this.ex.memory.buffer, this.outPtr, dstPos).slice();
    return { out, ret, drained: this.srcPos >= this.srcSize, full: dstPos === this.outCap, consumed: this.srcPos };
  }
}

const IN_CAP = 1 << 20;

// ---- zstd

export class ZstdDecoder extends WasmStream {
  /** One ZSTD_decompressStream call; `ret` 0 — a frame ended and is flushed, an error code — see `error`. */
  step(): Step {
    return this.call(buf => this.fn('decompress_stream')(this.ctx, buf));
  }
  /** The error's name (`checksum_wrong`), or null — by its code: the module is built without the error strings. */
  error(ret: number): string | null {
    if (this.fn('is_error')(ret) === 0) return null;
    return zstdErrorName(ret);
  }
  dispose(): void {
    this.fn('dctx_free')(this.ctx);
  }
}

export class ZstdEncoder extends WasmStream {
  /** One ZSTD_compressStream2 call: `end` false — continue, true — end the frame (ret 0 when all is flushed). */
  step(end: boolean): Step {
    return this.call(buf => this.fn('compress_stream')(this.ctx, buf, end ? 2 : 0));
  }
  /** The error's name (`checksum_wrong`), or null — by its code: the module is built without the error strings. */
  error(ret: number): string | null {
    if (this.fn('is_error')(ret) === 0) return null;
    return zstdErrorName(ret);
  }
  dispose(): void {
    this.fn('cctx_free')(this.ctx);
  }
}

/** zstd_errors.h: ZSTD_ErrorCode values and their names. */
const ZSTD_ERRORS: Readonly<Record<number, string>> = {
  1: 'GENERIC',
  10: 'prefix_unknown',
  12: 'version_unsupported',
  14: 'frameParameter_unsupported',
  16: 'frameParameter_windowTooLarge',
  20: 'corruption_detected',
  22: 'checksum_wrong',
  24: 'literals_headerWrong',
  30: 'dictionary_corrupted',
  32: 'dictionary_wrong',
  44: 'tableLog_tooLarge',
  46: 'maxSymbolValue_tooLarge',
  48: 'maxSymbolValue_tooSmall',
  64: 'memory_allocation',
  70: 'dstSize_tooSmall',
  72: 'srcSize_wrong',
  80: 'noForwardProgress_destFull',
  82: 'noForwardProgress_inputEmpty',
};

/** A size_t error return (-code, seen as a signed or an unsigned 32-bit number) as the error's name. */
export const zstdErrorName = (ret: number): string => {
  const code = ret < 0 ? -ret : 2 ** 32 - ret;
  return ZSTD_ERRORS[code] ?? `error ${code}`;
};

const cString = (ex: ModuleExports, ptr: number): string => {
  const bytes = new Uint8Array(ex.memory.buffer, ptr);
  const end = bytes.indexOf(0);
  return new TextDecoder().decode(bytes.subarray(0, end === -1 ? 0 : end));
};

export const createZstdDecoder = async (source: WasmSource): Promise<ZstdDecoder> => {
  const ex = await instantiate(source, libraryFailed('zstd', 'decoder'));
  const f = (n: string) => ex[n] as Fn;
  const ctx = f('dctx_new')();
  const outCap = f('dstream_out_size')();
  const inPtr = f('zstd_malloc')(IN_CAP);
  const outPtr = f('zstd_malloc')(outCap);
  const bufPtr = f('zstd_malloc')(JSBUF);
  if (!ctx || !inPtr || !outPtr || !bufPtr) throw new LibraryError(libraryFailed('zstd', 'decoder'));
  return new ZstdDecoder(ex, ctx, inPtr, IN_CAP, outPtr, outCap, bufPtr);
};

export const createZstdEncoder = async (source: WasmSource, level: number): Promise<ZstdEncoder> => {
  const ex = await instantiate(source, libraryFailed('zstd', 'encoder'));
  const f = (n: string) => ex[n] as Fn;
  const ctx = f('cctx_new')();
  if (!ctx || f('is_error')(f('cctx_set_level')(ctx, level)) !== 0)
    throw new LibraryError(libraryFailed('zstd', 'encoder'));
  const outCap = f('cstream_out_size')();
  const inPtr = f('zstd_malloc')(IN_CAP);
  const outPtr = f('zstd_malloc')(outCap);
  const bufPtr = f('zstd_malloc')(JSBUF);
  if (!inPtr || !outPtr || !bufPtr) throw new LibraryError(libraryFailed('zstd', 'encoder'));
  return new ZstdEncoder(ex, ctx, inPtr, IN_CAP, outPtr, outCap, bufPtr);
};

// ---- brotli

/** BrotliDecoderResult: 0 error, 1 success, 2 needs more input, 3 needs more output. */
export const BROTLI_ERROR = 0;
export const BROTLI_SUCCESS = 1;
export const BROTLI_NEEDS_INPUT = 2;
export const BROTLI_NEEDS_OUTPUT = 3;

export class BrotliDecoder extends WasmStream {
  step(): Step {
    return this.call(buf => this.fn('decompress_stream')(this.ctx, buf));
  }
  /** The decoder's error name without its leading underscore: `ERROR_FORMAT_PADDING_1`. */
  errorName(): string {
    const code = this.fn('get_error_code')(this.ctx);
    return cString(this.ex, this.fn('get_error_name')(code)).replace(/^_/, '') || `error ${code}`;
  }
  dispose(): void {
    this.fn('dctx_free')(this.ctx);
  }
}

export const createBrotliDecoder = async (source: WasmSource): Promise<BrotliDecoder> => {
  const ex = await instantiate(source, libraryFailed('brotli', 'decoder'));
  const f = (n: string) => ex[n] as Fn;
  const ctx = f('dctx_new')();
  const outCap = 64 * 1024;
  const inPtr = f('brotli_malloc')(IN_CAP);
  const outPtr = f('brotli_malloc')(outCap);
  const bufPtr = f('brotli_malloc')(JSBUF);
  if (!ctx || !inPtr || !outPtr || !bufPtr) throw new LibraryError(libraryFailed('brotli', 'decoder'));
  return new BrotliDecoder(ex, ctx, inPtr, IN_CAP, outPtr, outCap, bufPtr);
};

/** Brotli compression, whole input: the `brotli` package's encoder, window 22, generic mode (§5.4). */
export type BrotliCompress = (bytes: Uint8Array, quality: number) => Promise<Uint8Array>;

export const STREAM_INPUT = IN_CAP;
