/**
 * The output compiles, and reads the samples it was made from (docs/tools/specs/json-to-code.md §10, «compile»). Runs
 * only with JSON_TO_CODE_COMPILE=1 and only with the compilers this machine already has — nothing is installed:
 *
 *   TypeScript  tsc --strict over every example, each sample assigned to the root type (excess keys, missing keys,
 *               wrong types are errors); the property names of the hostile example read back through the TypeScript API
 *   Go          gofmt -l (prints nothing) and go vet; then a program decodes every sample into the root type with
 *               DisallowUnknownFields, and lists the json tags of the hostile example through reflect
 *   Rust        cargo (offline, serde and serde_json from the local registry cache) with -D warnings; a program
 *               deserializes every sample into the root type and serializes it back to the same JSON
 *   Python      every interpreter found (3.11, 3.12 for eager annotations, 3.14 with the annotations resolved after
 *               each class) imports every module; the hostile example's keys read back; mypy --strict if installed
 *
 *   JSON_TO_CODE_COMPILE=1 pnpm --filter @workspace/tool-logic-json-to-code test compile
 *
 * The work directory is JSON_TO_CODE_COMPILE_DIR or a temporary one; it is kept, so a failure can be read there.
 */
import { EXAMPLES, HOSTILE_KEYS } from './examples';
import { DEFAULT_OPTIONS, inferShape, jsonToCode } from './logic';
import { quote } from './names';
import { parseJsonValues } from '@workspace/tools-shared/json-scan';
import * as ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CodeOptions, Language } from './logic';
import type { JsonNode } from '@workspace/tools-shared/json-scan';

const enabled = process.env.JSON_TO_CODE_COMPILE === '1';

const run = (command: string, args: string[], cwd: string, env: Record<string, string> = {}) => {
  try {
    const out = execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
      maxBuffer: 64 * 1024 * 1024,
    });
    return { ok: true, out };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message: string };
    return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}` || e.message };
  }
};
const version = (command: string, args = ['--version']): string | null => {
  const r = run(command, args, tmpdir());
  return r.ok ? r.out.trim().split('\n')[0]! : null;
};

/** A value printed back as strict JSON from the scanner's tree (comments and trailing commas gone, literals kept). */
const print = (node: JsonNode, key: (k: string) => string = k => k): string => {
  switch (node.type) {
    case 'object':
      return `{${node.entries.map(e => `${JSON.stringify(key(e.key))}:${print(e.value, key)}`).join(',')}}`;
    case 'array':
      return `[${node.items.map(i => print(i, key)).join(',')}]`;
    case 'string':
      return node.raw;
    case 'number':
      return node.raw;
    case 'boolean':
      return String(node.value);
    case 'null':
      return 'null';
  }
};

interface Prepared {
  id: string;
  options: CodeOptions;
  values: JsonNode[];
  duplicates: boolean;
  root: { name: string; go: string };
  out: (language: Language) => string;
}

const prepared: Prepared[] = EXAMPLES.map((example, i) => {
  const options = { ...DEFAULT_OPTIONS, ...example.options };
  const parsed = parseJsonValues(example.input, { allowComments: true });
  if (!parsed.ok) throw new Error(`${example.name}: ${parsed.error.message}`);
  const shape = inferShape(parsed.values, options.rootName);
  return {
    id: `c${String(i).padStart(2, '0')}_${example.name}`,
    options,
    values: parsed.values,
    duplicates: parsed.notes.duplicateKeys.length > 0,
    root: { name: shape.rootName, go: shape.rootGo },
    out: language => {
      const result = jsonToCode(example.input, { ...options, language });
      if (!result.ok) throw new Error(example.name);
      return result.text;
    },
  };
});
/** Halves of surrogate pairs as U+FFFD, as Go and Rust hold such a key (String.prototype.toWellFormed is ES2024). */
const wellFormed = (text: string): string => text.replace(/\p{Cs}/gu, '\u{FFFD}');

/** Every key of the tree is a name encoding/json can match (its `isValidTag`). */
const goNamesAll = (node: JsonNode): boolean => {
  const stack = [node];
  for (let n = stack.pop(); n; n = stack.pop()) {
    if (n.type === 'array') stack.push(...n.items);
    if (n.type === 'object')
      for (const e of n.entries) {
        if (!/^[\p{L}\p{N}!#$%&()*+\-./:;<=>?@[\]^_{|}~ ]+$/u.test(e.key)) return false;
        stack.push(e.value);
      }
  }
  return true;
};
const hostile = prepared.filter(p => p.id.endsWith('_hostile'));
/** The keys of the hostile example's root, in order. */
const hostileKeys = [...HOSTILE_KEYS, 'nested'];

const work = process.env.JSON_TO_CODE_COMPILE_DIR ?? mkdtempSync(join(tmpdir(), 'json-to-code-compile-'));
const versions: Record<string, string | null> = {};

describe.skipIf(!enabled)('the output compiles and reads its samples', () => {
  beforeAll(() => {
    mkdirSync(work, { recursive: true });
    // eslint-disable-next-line no-console -- where to read a failure
    console.info(`compile check in ${work}`);
  });

  it('TypeScript: tsc --strict, every sample assigned to the root type', () => {
    const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
    versions.typescript = `tsc ${ts.version}`;
    const dir = join(work, 'ts');
    mkdirSync(dir, { recursive: true });
    const files = prepared.map(p => {
      // A repeated key is an error in an object literal (TS1117): those samples are not assigned.
      const samples = p.duplicates
        ? ''
        : p.values.map((v, k) => `const sample${k}: ${p.root.name} = ${print(v)};\n`).join('');
      const file = join(dir, `${p.id}.ts`);
      writeFileSync(file, `${p.out('typescript')}${samples}export {};\n`);
      return file;
    });
    const r = run(
      process.execPath,
      [tsc, '--strict', '--noEmit', '--target', 'es2022', '--module', 'esnext', ...files],
      dir,
    );
    expect(r.out).toBe('');
    expect(r.ok).toBe(true);

    for (const p of hostile) {
      const source = ts.createSourceFile('h.ts', p.out('typescript'), ts.ScriptTarget.ES2022);
      const root = source.statements.find(
        (s): s is ts.InterfaceDeclaration | ts.TypeAliasDeclaration =>
          (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)) && s.name.text === 'Root',
      )!;
      const members = ts.isInterfaceDeclaration(root) ? root.members : (root.type as ts.TypeLiteralNode).members;
      const names = members.map(m => (m.name as ts.Identifier | ts.StringLiteral).text);
      expect(names).toEqual(hostileKeys);
    }
  });

  it.skipIf(!version('go', ['version']))(
    'Go: gofmt -l prints nothing, go vet passes, every sample decodes; the hostile tags read back',
    () => {
      versions.go = version('go', ['version']);
      const dir = join(work, 'go');
      mkdirSync(join(dir, 'check'), { recursive: true });
      writeFileSync(join(dir, 'go.mod'), 'module example.com/types\n\ngo 1.22\n');
      for (const p of prepared) {
        mkdirSync(join(dir, p.id), { recursive: true });
        writeFileSync(join(dir, p.id, 'types.go'), `package ${p.id}\n\n${p.out('go')}`);
      }
      // encoding/json cannot name a field after "" or after a key with a character its tag names do not allow (a
      // quote, a backslash, a comma, a backtick, a control character): those are checked by their tags, not decoded.
      const decoded = prepared.filter(p => !hostile.includes(p) && !p.duplicates && p.values.every(goNamesAll));
      const imports = prepared.map(p => `\t"example.com/types/${p.id}"`).join('\n');
      const decodes = decoded
        .flatMap(p =>
          p.values.map(v => `\tdecode(${quote(print(v), 'go')}, new(${p.id}.${p.root.go}), ${quote(p.id, 'go')})`),
        )
        .join('\n');
      const tags = hostile.map(p => `\ttags(${p.id}.${p.root.go}{})`).join('\n');
      const unused = prepared
        .filter(p => !decoded.includes(p) && !hostile.includes(p))
        .map(p => `\t_ = new(${p.id}.${p.root.go})`)
        .join('\n');
      writeFileSync(
        join(dir, 'check', 'main.go'),
        `package main

import (
\t"bytes"
\t"encoding/json"
\t"fmt"
\t"os"
\t"reflect"

${imports}
)

func decode(sample string, into any, name string) {
\td := json.NewDecoder(bytes.NewReader([]byte(sample)))
\td.DisallowUnknownFields()
\tif err := d.Decode(into); err != nil {
\t\tfmt.Println(name, err)
\t\tos.Exit(1)
\t}
}

func tags(v any) {
\tt := reflect.TypeOf(v)
\tout := []string{}
\tfor i := 0; i < t.NumField(); i++ {
\t\tout = append(out, t.Field(i).Tag.Get("json"))
\t}
\tb, _ := json.Marshal(out)
\tfmt.Println(string(b))
}

func main() {
${decodes}
${unused}
${tags}
}
`,
      );
      const env = { GOFLAGS: '-mod=mod', GOPROXY: 'off', GOTOOLCHAIN: 'local', GOCACHE: join(work, 'gocache') };
      const fmt = run('gofmt', ['-l', '.'], dir, env);
      expect(fmt.out).toBe('');
      expect(fmt.ok).toBe(true);
      const vet = run('go', ['vet', './...'], dir, env);
      expect(vet.out).toBe('');
      expect(vet.ok).toBe(true);
      const checked = run('go', ['run', './check'], dir, env);
      expect(checked.ok, checked.out).toBe(true);
      const lines = checked.out.trim().split('\n');
      expect(lines).toHaveLength(hostile.length);
      // The tag holds the key exactly (a lone surrogate as U+FFFD: Go source holds no half of a pair).
      const omit = (k: string, i: number) => (i < HOSTILE_KEYS.length && HOSTILE_KEYS[i] === '-' ? '-,' : k);
      for (const line of lines) expect(JSON.parse(line)).toEqual(hostileKeys.map((k, i) => omit(wellFormed(k), i)));
    },
  );

  const registry = join(homedir(), '.cargo', 'registry', 'cache');
  const crates = existsSync(registry) ? readdirSync(registry).flatMap(d => readdirSync(join(registry, d))) : [];
  const offlineSerde = crates.some(c => /^serde-1\./.test(c)) && crates.some(c => /^serde_json-1\./.test(c));

  it.skipIf(!version('cargo') || !offlineSerde)(
    'Rust: cargo with serde, -D warnings; every sample deserializes and serializes back to the same JSON',
    () => {
      versions.rust = `${version('rustc')}; ${version('cargo')}`;
      const dir = join(work, 'rs');
      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(
        join(dir, 'Cargo.toml'),
        '[package]\nname = "types"\nversion = "0.0.0"\nedition = "2021"\n\n[dependencies]\nserde = { version = "1", features = ["derive"] }\nserde_json = "1"\n',
      );
      for (const p of prepared) writeFileSync(join(dir, 'src', `${p.id}.rs`), p.out('rust'));
      const checked = prepared.filter(p => !p.duplicates);
      // serde_json reads no half of a surrogate pair: such a key is written as U+FFFD, as the rename holds it.
      const samples = checked
        .flatMap(p =>
          p.values.map(v => `    check::<${p.id}::${p.root.name}>(${quote(print(v, wellFormed), 'rust')}, "${p.id}");`),
        )
        .join('\n');
      writeFileSync(
        join(dir, 'src', 'main.rs'),
        `${prepared.map(p => `#[allow(dead_code)]\nmod ${p.id};`).join('\n')}

/// Drops null members: an optional field that held null is skipped when written back.
fn strip(v: serde_json::Value) -> serde_json::Value {
    match v {
        serde_json::Value::Object(m) => serde_json::Value::Object(
            m.into_iter().filter(|(_, v)| !v.is_null()).map(|(k, v)| (k, strip(v))).collect(),
        ),
        serde_json::Value::Array(a) => serde_json::Value::Array(a.into_iter().map(strip).collect()),
        other => other,
    }
}

/// Equal JSON, numbers by value: an integer read into an f64 field is written back as 1.0.
fn same(a: &serde_json::Value, b: &serde_json::Value) -> bool {
    use serde_json::Value::*;
    match (a, b) {
        (Number(x), Number(y)) => x == y || (x.is_f64() || y.is_f64()) && x.as_f64() == y.as_f64(),
        (Array(x), Array(y)) => x.len() == y.len() && x.iter().zip(y).all(|(x, y)| same(x, y)),
        (Object(x), Object(y)) => x.len() == y.len() && x.iter().all(|(k, v)| y.get(k).is_some_and(|w| same(v, w))),
        _ => a == b,
    }
}

fn check<T: serde::de::DeserializeOwned + serde::Serialize>(sample: &str, name: &str) {
    let typed: T = serde_json::from_str(sample).unwrap_or_else(|e| panic!("{name}: {e}"));
    let back = strip(serde_json::to_value(&typed).unwrap());
    let want = strip(serde_json::from_str(sample).unwrap());
    assert!(same(&back, &want), "{name}: {back} != {want}");
}

fn main() {
${samples}
    println!("ok");
}
`,
      );
      // The modules are private to the binary: dead code is allowed there, every other warning is an error.
      const r = run('cargo', ['run', '--offline', '--quiet'], dir, {
        RUSTFLAGS: '-D warnings',
        CARGO_TARGET_DIR: join(work, 'rs-target'),
      });
      expect(r.out.trim()).toBe('ok');
    },
    600_000,
  );

  const uv = join(homedir(), '.local', 'share', 'uv', 'python');
  const pythons = [
    ...(existsSync(uv)
      ? readdirSync(uv)
          .filter(d => /^cpython-3\.1[1-3]\.\d+-/.test(d))
          .map(d => join(uv, d, 'bin', `python${d.split('-')[1]!.split('.').slice(0, 2).join('.')}`))
      : []),
    'python3',
  ].filter(p => version(p) !== null);

  it.skipIf(pythons.length === 0)(
    'Python: every interpreter imports every module; the hostile keys read back; mypy --strict',
    () => {
      versions.python = pythons.map(p => version(p)).join('; ');
      const dir = join(work, 'py');
      mkdirSync(dir, { recursive: true });
      for (const p of prepared) {
        const code = p.out('python');
        // 3.14 defers annotations (PEP 649): resolve each class at once, as 3.11–3.13 do, so a forward reference fails.
        const eager = code.replace(
          /^class (\w+)\(TypedDict\):\n(?: {4}.*\n)+/gm,
          (block, name: string) => `${block}__import__("typing").get_type_hints(${name})\n`,
        );
        writeFileSync(join(dir, `${p.id}.py`), code);
        writeFileSync(join(dir, `${p.id}_eager.py`), eager);
      }
      const keysOut = hostile.map(p => `import ${p.id} as m\nprint(json.dumps(list(m.Root.__annotations__)))`);
      writeFileSync(join(dir, 'keys.py'), `import json\n${keysOut.join('\n')}\n`);
      for (const python of pythons) {
        for (const p of prepared) {
          const r = run(python, ['-I', '-W', 'error', join(dir, `${p.id}_eager.py`)], dir);
          expect(r.out, `${python} ${p.id}`).toBe('');
        }
        const r = run(python, ['-W', 'error', 'keys.py'], dir);
        expect(r.ok, r.out).toBe(true);
        for (const line of r.out.trim().split('\n')) expect(JSON.parse(line)).toEqual(hostileKeys);
      }
      versions.mypy = version('mypy');
      if (versions.mypy) {
        const files = prepared.map(p => join(dir, `${p.id}.py`));
        const r = run('mypy', ['--strict', '--python-version', '3.11', '--no-incremental', ...files], dir);
        expect(r.out).toMatch(/^Success: no issues found in \d+ source files/);
      }
    },
    300_000,
  );

  it('versions', () => {
    // eslint-disable-next-line no-console -- the report of what compiled with what
    console.info(JSON.stringify({ examples: prepared.length, versions }, null, 1));
  });
});
