#!/usr/bin/env node
// The grammars of the mixed highlighter build, from the one table ../grammars.json.
//
//   node build.mjs features         prints the cargo features that compile the `builtIn` grammars into the module
//                                   (gpui-component/tree-sitter-…, comma-separated); refuses a table that cannot be
//                                   built: a crate version other than Cargo.lock's, a `builtIn` grammar gpui-kit leaves
//                                   out of wasm, a `file` grammar whose gpui-kit feature is compiled in anyway
//   node build.mjs files <out-dir> <module.wasm>
//                                   builds every `file` grammar as a separate wasm module into <out-dir> and writes
//                                   <out-dir>/index.json, what the editor page reads (format below); <module.wasm> is
//                                   the editor module the grammars are for: they may import only what it exports
//   node build.mjs licenses <out-dir>
//                                   the licence of the tree-sitter runtime and of every grammar crate the build ships
//                                   (builtIn and file), one <CRATE>-LICENSE.txt each, from the table and Cargo.lock
//
// A grammar file is the grammar crate's parser.c (and scanner.c) compiled by clang for wasm32 as position-independent
// code and linked by wasm-ld as a shared module — the format `tree-sitter build --wasm` produces. It has no memory of
// its own: the editor page instantiates it over the module's memory and function table, and it may import only what
// the module exports — the libc subset the tree-sitter runtime compiles into it for grammars (its src/wasm-stdlib) —,
// checked here against the module itself. The C headers are
// tree-sitter-language's wasm headers, as in the module's own build, plus libc-shim.h. Source paths are remapped as in
// build.sh (/src, /cargo, /rustup), and a grammar that still names a directory of this machine is refused.
//
// index.json:
//   { "format": 1,
//     "runtime": { "crate": "tree-sitter", "version", "abi": { "min", "max" } },  the runtime the grammars are for
//     "languages": { "<name>": "<id>" },          every id and alias of the table → its id
//     "builtIn": ["<id>", …], "none": ["<id>", …],
//     "grammars": { "<id>": { "file", "size", "sha256", "abi", "symbol", "injects",
//                             "highlights", "injections", "locals" } } }   the queries' text, inline
//
// Needs: clang with the wasm32 target (CC_wasm32_unknown_unknown, else clang), wasm-ld (rustup's, found from rustc),
// cargo (metadata only: where each crate's sources are). Objects are cached in crates/target/grammars by the hash of
// their inputs.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CRATES = resolve(HERE, '../..');
const ROOT = resolve(CRATES, '..');
const TABLE = join(HERE, '../grammars.json');
const SHIM = join(HERE, 'libc-shim.h');
const CACHE = join(process.env.CARGO_TARGET_DIR ?? join(CRATES, 'target'), 'grammars');
// What a grammar module may import from the editor module besides the libc subset: the shared memory and table, where
// its data and functions go, and the shadow stack.
const LINKAGE = new Set(['memory', '__indirect_function_table', '__memory_base', '__table_base', '__stack_pointer']);

const die = message => {
  console.error(`grammars: ${message}`);
  process.exit(1);
};
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...options });
  if (result.error) die(`${command}: ${result.error.message}`);
  if (result.status !== 0) die(`${command} ${args.join(' ')}\n${result.stderr || result.stdout}`);
  return result.stdout;
};
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export const readTable = (path = TABLE) => {
  const table = JSON.parse(readFileSync(path, 'utf8'));
  const ids = new Set();
  const names = new Map();
  for (const entry of table.languages) {
    if (!/^[a-z][a-z0-9_]*$/.test(entry.id)) die(`${entry.id}: an id is lower-case letters, digits and _`);
    if (ids.has(entry.id)) die(`${entry.id}: listed twice`);
    ids.add(entry.id);
    if (!['builtIn', 'file', 'none'].includes(entry.grammar)) die(`${entry.id}: grammar is builtIn, file or none`);
    for (const field of ['crate', 'version', 'feature', 'parser', 'symbol'])
      if (typeof entry[field] !== 'string') die(`${entry.id}: no ${field}`);
    if (entry.grammar !== 'none' && typeof entry.highlights !== 'string') die(`${entry.id}: no highlights query`);
    for (const name of [entry.id, ...entry.aliases]) {
      if (names.has(name)) die(`"${name}" means both ${names.get(name)} and ${entry.id}`);
      names.set(name, entry.id);
    }
  }
  return table;
};

const metadata = () => {
  const out = run('cargo', ['metadata', '--format-version', '1', '--locked', '--all-features'], { cwd: CRATES });
  const { packages, resolve: graph } = JSON.parse(out);
  const find = (name, version) =>
    packages.find(p => p.name === name && (version === undefined || p.version === version));
  /** A package's normal (not build, not dev) dependencies as resolved. */
  const dependencies = pkg =>
    (graph.nodes.find(node => node.id === pkg.id)?.deps ?? [])
      .filter(dep => dep.dep_kinds.some(kind => kind.kind === null))
      .map(dep => packages.find(p => p.id === dep.pkg));
  return { packages, find, dependencies };
};

/** The grammar crates gpui-kit builds natively only (its `cfg(not(target_family = "wasm"))` dependencies). */
const nativeOnly = kitManifest => {
  const text = readFileSync(kitManifest, 'utf8');
  const section = text.split(/^\[/m).find(s => s.startsWith(`target.'cfg(not(target_family = "wasm"))'.dependencies]`));
  return new Set([...(section ?? '').matchAll(/^(tree-sitter-[a-z0-9-]+)\s*=/gm)].map(m => m[1]));
};

/** Checks the table against Cargo.lock and gpui-kit; returns what the build needs. */
const resolveTable = () => {
  const table = readTable();
  const { find } = metadata();
  const kit = find('gpui-component');
  if (!kit) die('gpui-component is not in the build');
  const runtime = find(table.runtime.crate);
  if (!runtime || runtime.version !== table.runtime.version)
    die(`${table.runtime.crate} ${table.runtime.version}: Cargo.lock has ${runtime?.version ?? 'none'}`);
  const crates = new Map();
  for (const entry of table.languages) {
    const pkg = find(entry.crate);
    if (!pkg) die(`${entry.id}: ${entry.crate} is not in Cargo.lock`);
    if (pkg.version !== entry.version) die(`${entry.id}: ${entry.crate} ${entry.version}, Cargo.lock has ${pkg.version}`);
    if (!(entry.feature in kit.features)) die(`${entry.id}: gpui-kit has no feature ${entry.feature}`);
    crates.set(entry.id, dirname(pkg.manifest_path));
  }
  const builtInFeatures = new Set(table.languages.filter(e => e.grammar === 'builtIn').map(e => e.feature));
  const native = nativeOnly(kit.manifest_path);
  for (const entry of table.languages) {
    if (entry.grammar === 'builtIn' && native.has(entry.crate))
      die(`${entry.id}: gpui-kit builds ${entry.crate} natively only, so it cannot be built in; make it a file`);
    if (entry.grammar !== 'builtIn' && builtInFeatures.has(entry.feature))
      die(`${entry.id}: its gpui-kit feature ${entry.feature} is compiled in for another language anyway; make it builtIn`);
  }
  const header = readFileSync(join(dirname(runtime.manifest_path), 'include/tree_sitter/api.h'), 'utf8');
  const define = name => Number(new RegExp(`#define ${name} (\\d+)`).exec(header)?.[1]);
  const abi = { min: define('TREE_SITTER_MIN_COMPATIBLE_LANGUAGE_VERSION'), max: define('TREE_SITTER_LANGUAGE_VERSION') };
  const language = find('tree-sitter-language');
  if (!language) die('tree-sitter-language is not in the build');
  return {
    table,
    crates,
    kitQueries: join(dirname(kit.manifest_path), 'src/highlighter/languages'),
    runtime: { crate: runtime.name, version: runtime.version, abi },
    headers: join(dirname(language.manifest_path), 'wasm/include'),
    builtInFeatures,
  };
};

const features = () => {
  const { builtInFeatures } = resolveTable();
  return [...builtInFeatures].sort().map(f => `gpui-component/${f}`);
};

const toolchain = () => {
  const cc = process.env.CC_wasm32_unknown_unknown || 'clang';
  if (!run(cc, ['--print-targets']).includes('wasm32')) die(`${cc} has no wasm32 target`);
  const host = /host: (\S+)/.exec(run('rustc', ['-vV'], { cwd: CRATES }))[1];
  const sysroot = run('rustc', ['--print', 'sysroot'], { cwd: CRATES }).trim();
  const ld = join(sysroot, 'lib/rustlib', host, 'bin/gcc-ld/wasm-ld');
  if (!existsSync(ld)) die(`no wasm-ld at ${ld}`);
  return { cc, ccVersion: run(cc, ['--version']).split('\n')[0], ld };
};

/** Directories of this machine a grammar file must not name, and what build.sh remaps them to. */
const remaps = () => {
  const home = homedir();
  return [
    [ROOT, '/src'],
    [process.env.CARGO_HOME ?? join(home, '.cargo'), '/cargo'],
    [process.env.RUSTUP_HOME ?? join(home, '.rustup'), '/rustup'],
    [home, '~'],
  ];
};

const queryText = (spec, crateDir, kitQueries, id) => {
  if (spec === undefined) return '';
  const [, origin, path] = /^(kit|crate):(.+)$/.exec(spec) ?? [];
  if (!origin) die(`${id}: a query is kit:<path> or crate:<path>, not "${spec}"`);
  const file = join(origin === 'kit' ? kitQueries : crateDir, path);
  if (!existsSync(file)) die(`${id}: no query ${file}`);
  return readFileSync(file, 'utf8');
};

const files = (out, modulePath) => {
  const { table, crates, kitQueries, runtime, headers } = resolveTable();
  const tools = toolchain();
  const exported = WebAssembly.Module.exports(new WebAssembly.Module(readFileSync(modulePath)));
  const allowed = new Set([...exported.filter(e => e.kind === 'function').map(e => e.name), ...LINKAGE]);
  const prefixes = remaps();
  const cflags = [
    '--target=wasm32-unknown-unknown',
    '-std=c11',
    '-Os',
    '-fPIC',
    '-fvisibility=hidden',
    '-fno-exceptions',
    '-w',
    '-include',
    SHIM,
    '-isystem',
    headers,
    ...prefixes.slice(0, 3).map(([from, to]) => `-ffile-prefix-map=${from}=${to}`),
  ];
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  mkdirSync(CACHE, { recursive: true });

  const built = new Map(); // source directory → { file, abi, size, sha256 }
  const grammars = {};
  for (const entry of table.languages.filter(e => e.grammar === 'file')) {
    const crateDir = crates.get(entry.id);
    const src = join(crateDir, entry.parser);
    let module = built.get(src);
    if (!module) {
      const sources = ['parser.c', 'scanner.c'].map(f => join(src, f)).filter(f => existsSync(f));
      if (!sources[0]?.endsWith('parser.c')) die(`${entry.id}: no ${join(src, 'parser.c')}`);
      if (existsSync(join(src, 'scanner.cc'))) die(`${entry.id}: a C++ scanner cannot be built here`);
      const abi = Number(/#define LANGUAGE_VERSION (\d+)/.exec(readFileSync(sources[0], 'utf8'))?.[1]);
      const defines = new RegExp(`\\b${entry.symbol}\\(void\\)`);
      if (!defines.test(readFileSync(sources[0], 'utf8'))) die(`${entry.id}: ${sources[0]} defines no ${entry.symbol}`);
      const file = `${entry.symbol.replace(/^tree_sitter_/, '')}.wasm`;
      const key = sha256(
        JSON.stringify([cflags, tools.ccVersion, tools.ld, entry.symbol, readFileSync(SHIM, 'utf8')]) +
          sources.map(s => sha256(readFileSync(s))).join(),
      );
      const cached = join(CACHE, `${key}.wasm`);
      if (!existsSync(cached)) {
        const started = Date.now();
        const objects = sources.map((source, i) => {
          const object = join(CACHE, `${key}-${i}.o`);
          run(tools.cc, [...cflags, '-I', src, '-c', source, '-o', object]);
          return object;
        });
        const linked = join(CACHE, `${key}.tmp.wasm`);
        run(tools.ld, [
          '--shared',
          '--experimental-pic',
          '--no-entry',
          '--allow-undefined',
          '--strip-all',
          `--export=${entry.symbol}`,
          ...objects,
          '-o',
          linked,
        ]);
        for (const object of objects) rmSync(object);
        copyFileSync(linked, cached);
        rmSync(linked);
        console.log(`  built ${file} (${entry.crate} ${entry.version}) in ${((Date.now() - started) / 1000).toFixed(1)} s`);
      }
      const bytes = readFileSync(cached);
      const wasm = new WebAssembly.Module(bytes);
      const strange = WebAssembly.Module.imports(wasm).filter(i => i.module !== 'env' || !allowed.has(i.name));
      if (strange.length)
        die(`${file}: imports what the module does not export to grammars: ${strange.map(i => `${i.module}.${i.name}`)}`);
      if (!WebAssembly.Module.exports(wasm).some(e => e.name === entry.symbol)) die(`${file}: no export ${entry.symbol}`);
      const text = bytes.toString('latin1');
      for (const [from] of prefixes) if (text.includes(from)) die(`${file}: names ${from}`);
      writeFileSync(join(out, file), bytes);
      module = { file, abi, size: bytes.length, sha256: sha256(bytes) };
      built.set(src, module);
    }
    if (module.abi < runtime.abi.min || module.abi > runtime.abi.max)
      die(`${entry.id}: ABI ${module.abi}, the runtime takes ${runtime.abi.min}–${runtime.abi.max}`);
    grammars[entry.id] = {
      ...module,
      symbol: entry.symbol,
      injects: entry.injects,
      highlights: queryText(entry.highlights, crateDir, kitQueries, entry.id),
      injections: queryText(entry.injections, crateDir, kitQueries, entry.id),
      locals: queryText(entry.locals, crateDir, kitQueries, entry.id),
    };
  }
  const languages = Object.fromEntries(table.languages.flatMap(e => [e.id, ...e.aliases].map(name => [name, e.id])));
  const index = {
    format: 1,
    runtime,
    languages,
    builtIn: table.languages.filter(e => e.grammar === 'builtIn').map(e => e.id),
    none: table.languages.filter(e => e.grammar === 'none').map(e => e.id),
    grammars,
  };
  writeFileSync(join(out, 'index.json'), `${JSON.stringify(index)}\n`);
  const total = [...built.values()].reduce((sum, m) => sum + m.size, 0);
  const listed = readdirSync(out).filter(f => f.endsWith('.wasm'));
  console.log(
    `grammars: ${listed.length} files for ${Object.keys(grammars).length} languages, ${total} bytes; index.json ${statSync(join(out, 'index.json')).size} bytes`,
  );
};

const MIT = holders => `MIT License

Copyright (c) ${holders}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

/** The licence file a crate ships under: `TREE-SITTER-GO-LICENSE.txt`. */
export const licenceFile = crate => `${crate.toUpperCase()}-LICENSE.txt`;

/**
 * The licences of what the mixed build ships of tree-sitter: the runtime and its own dependencies, and every grammar
 * crate the table builds in or ships as a file — one file each in <out-dir>, the crate's own licence texts; for a crate
 * published without one, the MIT licence its Cargo.toml declares with its authors as the holders (said in the file).
 */
const licences = out => {
  const { table } = resolveTable();
  const { find, dependencies } = metadata();
  const runtime = find(table.runtime.crate, table.runtime.version);
  const crates = new Map();
  for (const pkg of [runtime, ...dependencies(runtime)]) crates.set(pkg.name, pkg);
  for (const entry of table.languages.filter(e => e.grammar !== 'none'))
    crates.set(entry.crate, find(entry.crate, entry.version));
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const reconstructed = [];
  for (const pkg of [...crates.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    const dir = dirname(pkg.manifest_path);
    const texts = readdirSync(dir)
      .filter(name => /^(licen[cs]e|copying)/i.test(name))
      .sort()
      .map(name => readFileSync(join(dir, name), 'utf8').trim());
    let body = texts.join('\n\n---\n\n');
    let origin = 'the licence text as the crate ships it';
    if (!body) {
      if (!/\bMIT\b/.test(pkg.license ?? '')) die(`${pkg.name} ${pkg.version}: no licence file and not MIT (${pkg.license})`);
      const holders = (pkg.authors ?? []).map(author => author.replace(/\s*<[^>]*>/, '')).join(', ');
      if (!holders) die(`${pkg.name} ${pkg.version}: no licence file and no authors to name`);
      body = MIT(holders).trim();
      origin = 'the crate is published without a licence file: the MIT licence its Cargo.toml declares, its authors as the holders';
      reconstructed.push(pkg.name);
    }
    writeFileSync(
      join(out, licenceFile(pkg.name)),
      `${pkg.name} ${pkg.version} (crates.io), licence: ${pkg.license} — ${origin}.\n\n${body}\n`,
    );
  }
  console.log(`licences: ${crates.size} crates, ${reconstructed.length} without a licence file of their own`);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, out, module] = process.argv.slice(2);
  if (command === 'features') process.stdout.write(`${features().join(',')}\n`);
  else if (command === 'files' && out && module) files(resolve(out), resolve(module));
  else if (command === 'licenses' && out) licences(resolve(out));
  else die('usage: node build.mjs features | files <out-dir> <module.wasm> | licenses <out-dir>');
}
