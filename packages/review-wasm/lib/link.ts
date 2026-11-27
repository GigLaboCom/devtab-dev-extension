/**
 * Links a tree-sitter grammar file into the running editor module (the mixed highlighter build). A grammar file is a
 * wasm side module — clang's position-independent code linked by `wasm-ld --shared`, the format `tree-sitter build
 * --wasm` produces (crates/review-wasm/grammars/build.mjs) — with no memory of its own: it is instantiated over the
 * module's memory and function table, so the language its `tree_sitter_<name>()` returns is an ordinary address in the
 * module's memory, its parse tables are read in place and its lexer is called through the shared table.
 *
 * What the module provides (crates/review-wasm/build.sh, src/grammars.rs): its memory and `calloc`, the libc subset
 * tree-sitter's runtime compiles in for grammars, `__stack_pointer` (the grammars' C code uses the module's stack), and
 * a function table that can grow, handed over by `function_table()`.
 */

/** What a side module asks for in its `dylink.0` section. */
export interface DylinkInfo {
  memorySize: number;
  memoryAlign: number;
  tableSize: number;
  tableAlign: number;
}

/** The editor module as a grammar needs it: its instance's exports and its function table. */
export interface LinkTarget {
  exports: Record<string, unknown>;
  table: WebAssembly.Table;
}

const leb = (bytes: Uint8Array, at: number): [number, number] => {
  let result = 0;
  let shift = 0;
  let byte: number;
  do {
    if (at >= bytes.length) throw new Error('not a side module: truncated');
    byte = bytes[at++];
    result |= (byte & 0x7f) << shift;
    shift += 7;
  } while (byte & 0x80);
  return [result >>> 0, at];
};

/** The sizes a side module needs, from its `dylink.0` custom section (the first section of the file). */
export const dylinkInfo = (bytes: Uint8Array): DylinkInfo => {
  if (bytes.length < 9 || bytes[0] !== 0 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d)
    throw new Error('not a wasm module');
  if (bytes[8] !== 0) throw new Error('not a side module: no leading custom section');
  const [size, afterSize] = leb(bytes, 9);
  const end = afterSize + size;
  const [nameLength, afterLength] = leb(bytes, afterSize);
  let at = afterLength;
  const name = new TextDecoder().decode(bytes.subarray(at, at + nameLength));
  if (name !== 'dylink.0') throw new Error(`not a side module: the first section is "${name}"`);
  at += nameLength;
  while (at < end) {
    const kind = bytes[at++];
    let length: number;
    [length, at] = leb(bytes, at);
    if (kind === 1) {
      let memorySize: number, memoryAlign: number, tableSize: number, tableAlign: number;
      [memorySize, at] = leb(bytes, at);
      [memoryAlign, at] = leb(bytes, at);
      [tableSize, at] = leb(bytes, at);
      [tableAlign, at] = leb(bytes, at);
      return { memorySize, memoryAlign, tableSize, tableAlign };
    }
    at += length;
  }
  throw new Error('not a side module: dylink.0 has no memory information');
};

/**
 * Instantiates the grammar over the module's memory and table and returns the address of its language. Its data goes
 * into a zeroed block of the module's allocator and its functions into new slots of the table; neither is ever freed,
 * so the language stays valid as long as the page.
 */
export const linkGrammar = async (
  target: LinkTarget,
  bytes: Uint8Array<ArrayBuffer>,
  symbol: string,
): Promise<number> => {
  const info = dylinkInfo(bytes);
  const module = await WebAssembly.compile(bytes);
  const { exports, table } = target;
  const memory = exports.memory;
  const calloc = exports.calloc;
  if (!(memory instanceof WebAssembly.Memory) || typeof calloc !== 'function')
    throw new Error('the editor module does not export its memory and calloc');

  const align = 2 ** info.memoryAlign;
  const block = (calloc as (n: number, size: number) => number)(info.memorySize + align, 1) >>> 0;
  if (!block && info.memorySize > 0) throw new Error('out of memory');
  const memoryBase = (block + align - 1) & ~(align - 1);
  const tableBase = table.grow(info.tableSize);

  const env: Record<string, unknown> = {
    memory,
    __indirect_function_table: table,
    __memory_base: new WebAssembly.Global({ value: 'i32', mutable: false }, memoryBase),
    __table_base: new WebAssembly.Global({ value: 'i32', mutable: false }, tableBase),
  };
  for (const { module: from, name, kind } of WebAssembly.Module.imports(module)) {
    if (from !== 'env') throw new Error(`the grammar imports ${from}.${name}`);
    if (name in env) continue;
    const provided = exports[name];
    const fits = kind === 'function' ? typeof provided === 'function' : provided instanceof WebAssembly.Global;
    if (!fits) throw new Error(`the editor module does not export ${name} (${kind})`);
    env[name] = provided;
  }
  const instance = await WebAssembly.instantiate(module, { env: env as WebAssembly.ModuleImports });
  const run = (name: string): void => {
    const fn = instance.exports[name];
    if (typeof fn === 'function') (fn as () => void)();
  };
  run('__wasm_apply_data_relocs');
  run('__wasm_call_ctors');
  const language = instance.exports[symbol];
  if (typeof language !== 'function') throw new Error(`the grammar does not export ${symbol}`);
  return (language as () => number)() >>> 0;
};
