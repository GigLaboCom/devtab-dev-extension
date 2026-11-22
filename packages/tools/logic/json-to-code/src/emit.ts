/**
 * The four languages (docs/tools/specs/json-to-code.md §5 «Языки»): one writer per language over the same named shape.
 * A new language is one more writer in `WRITERS` — nothing else branches on the language. Types are computed with a
 * memo and an explicit stack (arrays nest as deep as the input), never by recursion.
 */
import { isObjectOnly } from './infer';
import { goFieldName, isPythonField, isTsIdentifier, namer, quote, rustFieldName, rustIdentifier } from './names';
import type { ObjectShape, Shape, TypeShape } from './infer';

export type Language = 'typescript' | 'go' | 'rust' | 'python';

export interface WriteOptions {
  declaration: 'interface' | 'type';
  exportTypes: boolean;
}

/** Variants other than `null`. */
const variants = (s: Shape): number =>
  Number(s.string) +
  Number(s.number !== null) +
  Number(s.boolean) +
  Number(s.object !== null) +
  Number(s.array !== null);

const hasKeys = (s: Shape): boolean => s.object !== null && s.object.fields.size > 0;

/** The type of every position, each computed once, an array's element before the array. */
const typer = (render: (s: Shape, item: string) => string): ((s: Shape) => string) => {
  const memo = new Map<Shape, string>();
  return top => {
    const stack = [top];
    while (stack.length) {
      const s = stack[stack.length - 1]!;
      const item = s.array?.item;
      if (memo.has(s)) stack.pop();
      else if (item && !memo.has(item)) stack.push(item);
      else {
        memo.set(s, render(s, item ? memo.get(item)! : ''));
        stack.pop();
      }
    }
    return memo.get(top)!;
  };
};

/**
 * The declared objects a position's type names, in the order it writes them, down through its arrays. `opaque`: a
 * mixed position is "any value" (Go, Rust) and names nothing.
 */
const named = (shape: Shape, opaque: boolean): string[] => {
  const out: string[] = [];
  for (let s: Shape | undefined = shape; s; s = s.array?.item) {
    if (opaque && variants(s) > 1) break;
    if (hasKeys(s)) out.push(s.object!.name);
  }
  return out;
};

/**
 * The objects to declare, in the order the language wants (§5 «Порядок объявлений»): the order of naming, only those
 * the output names (Go and Rust leave out an object seen only in a mixed position); or, `fieldsFirst` (Python), every
 * object after all it refers to.
 */
const declared = (shape: TypeShape, opaque: boolean, fieldsFirst = false): ObjectShape[] => {
  const byName = new Map(shape.objects.map(o => [o.name, o]));
  const seen = new Set<string>();
  const out: ObjectShape[] = [];
  const frames: Array<{ object?: ObjectShape; refs: string[]; next: number }> = [
    { refs: named(shape.root, opaque), next: 0 },
  ];
  while (frames.length) {
    const top = frames[frames.length - 1]!;
    if (top.next < top.refs.length) {
      const object = byName.get(top.refs[top.next++]!)!;
      if (seen.has(object.name)) continue;
      seen.add(object.name);
      const refs = [...object.fields.values()].flatMap(f => named(f.shape, opaque));
      frames.push({ object, refs, next: 0 });
    } else {
      frames.pop();
      if (top.object) out.push(top.object);
    }
  }
  return fieldsFirst ? out : shape.objects.filter(o => seen.has(o.name));
};

const optional = (object: ObjectShape, count: number): boolean => count < object.count;

const typescript = (shape: TypeShape, options: WriteOptions): string => {
  const typeOf = typer((s, item) => {
    const parts: string[] = [];
    if (s.string) parts.push('string');
    if (s.number) parts.push('number');
    if (s.boolean) parts.push('boolean');
    if (s.object) parts.push(hasKeys(s) ? s.object.name : 'Record<string, unknown>');
    if (s.array) parts.push(variants(s.array.item) + Number(s.array.item.null) > 1 ? `(${item})[]` : `${item}[]`);
    if (!parts.length) return s.null ? 'null' : 'unknown';
    if (s.null) parts.push('null');
    return parts.join(' | ');
  });
  const exp = options.exportTypes ? 'export ' : '';
  const out: string[] = [];
  if (!isObjectOnly(shape.root)) out.push(`${exp}type ${shape.rootName} = ${typeOf(shape.root)};`);
  for (const object of declared(shape, false)) {
    const body = [...object.fields]
      .map(([key, f]) => {
        const name = isTsIdentifier(key) ? key : quote(key, 'typescript');
        return `  ${name}${optional(object, f.count) ? '?' : ''}: ${typeOf(f.shape)};`;
      })
      .join('\n');
    out.push(
      options.declaration === 'type'
        ? `${exp}type ${object.name} = {\n${body}\n};`
        : `${exp}interface ${object.name} {\n${body}\n}`,
    );
  }
  return out.join('\n\n');
};

const GO_NUMBER = { i64: 'int64', u64: 'uint64', f64: 'float64' };

/** A struct tag: a raw string literal, or a quoted one when the key holds a backtick; `-` alone is `-,` (not "skip"). */
const goTag = (key: string, omitEmpty: boolean): string => {
  const name = quote(key, 'go').slice(1, -1);
  const value = `json:"${name}${omitEmpty ? ',omitempty' : key === '-' ? ',' : ''}"`;
  return value.includes('`') ? quote(value, 'go') : `\`${value}\``;
};

const go = (shape: TypeShape): string => {
  const typeOf = typer((s, item) => {
    if (variants(s) !== 1) return 'any';
    let type: string;
    let pointer = true;
    if (s.string) type = 'string';
    else if (s.number) type = GO_NUMBER[s.number];
    else if (s.boolean) type = 'bool';
    else if (s.object) [type, pointer] = hasKeys(s) ? [s.object.go, true] : ['map[string]any', false];
    else [type, pointer] = [`[]${item}`, false];
    return s.null && pointer ? `*${type}` : type;
  });
  const out: string[] = [];
  if (!isObjectOnly(shape.root)) out.push(`type ${shape.rootGo} ${typeOf(shape.root)}`);
  for (const object of declared(shape, true)) {
    const fieldName = namer();
    const rows = [...object.fields].map(([key, f]) => ({
      name: fieldName(goFieldName(key)),
      type: typeOf(f.shape),
      tag: goTag(key, optional(object, f.count)),
    }));
    // gofmt: names and types padded to the longest of the struct plus one space; the tag is not padded.
    const nameWidth = Math.max(...rows.map(r => r.name.length));
    const typeWidth = Math.max(...rows.map(r => r.type.length));
    const body = rows.map(r => `\t${r.name.padEnd(nameWidth)} ${r.type.padEnd(typeWidth)} ${r.tag}`).join('\n');
    out.push(`type ${object.go} struct {\n${body}\n}`);
  }
  return out.join('\n\n');
};

const VALUE = 'serde_json::Value';
const RUST_NUMBER = { i64: 'i64', u64: 'u64', f64: 'f64' };

const rust = (shape: TypeShape): string => {
  const typeOf = typer((s, item) => {
    if (variants(s) !== 1) return VALUE;
    const type = s.string
      ? 'String'
      : s.number
        ? RUST_NUMBER[s.number]
        : s.boolean
          ? 'bool'
          : s.object
            ? hasKeys(s)
              ? s.object.name
              : `serde_json::Map<String, ${VALUE}>`
            : `Vec<${item}>`;
    return s.null ? `Option<${type}>` : type;
  });
  const out: string[] = [];
  if (!isObjectOnly(shape.root)) out.push(`pub type ${shape.rootName} = ${typeOf(shape.root)};`);
  const objects = declared(shape, true);
  for (const object of objects) {
    // `self_` numbered is `self_2`: `self__2` is not snake case (rustc warns).
    const fieldName = namer(base => (base.endsWith('_') ? '' : '_'));
    const body = [...object.fields].flatMap(([key, f]) => {
      const name = fieldName(rustFieldName(key));
      const absent = optional(object, f.count);
      const type = typeOf(f.shape);
      const attributes = [
        ...(name === key ? [] : [`rename = ${quote(key, 'rust')}`]),
        ...(absent ? ['skip_serializing_if = "Option::is_none"'] : []),
      ];
      const nullable = variants(f.shape) === 1 && f.shape.null;
      return [
        ...(attributes.length ? [`    #[serde(${attributes.join(', ')})]`] : []),
        `    pub ${rustIdentifier(name)}: ${absent && !nullable ? `Option<${type}>` : type},`,
      ];
    });
    out.push(`#[derive(Debug, Clone, Serialize, Deserialize)]\npub struct ${object.name} {\n${body.join('\n')}\n}`);
  }
  return `${objects.length ? 'use serde::{Deserialize, Serialize};\n\n' : ''}${out.join('\n\n')}`;
};

const python = (shape: TypeShape): string => {
  const imports = new Set<string>();
  const typeOf = typer((s, item) => {
    const parts: string[] = [];
    if (s.string) parts.push('str');
    if (s.number) parts.push(s.number === 'f64' ? 'float' : 'int');
    if (s.boolean) parts.push('bool');
    if (s.object) parts.push(hasKeys(s) ? s.object.name : 'dict[str, Any]');
    if (s.array) parts.push(`list[${item}]`);
    if (s.object && !hasKeys(s)) imports.add('Any');
    if (!parts.length) {
      if (!s.null) imports.add('Any');
      return s.null ? 'None' : 'Any';
    }
    if (s.null) parts.push('None');
    return parts.join(' | ');
  });
  const out: string[] = [];
  for (const object of declared(shape, false, true)) {
    imports.add('TypedDict');
    const fields = [...object.fields].map(([key, f]): [string, string] => {
      let type = typeOf(f.shape);
      if (optional(object, f.count)) {
        imports.add('NotRequired');
        type = `NotRequired[${type}]`;
      }
      return [key, type];
    });
    out.push(
      fields.every(([key]) => isPythonField(key))
        ? `class ${object.name}(TypedDict):\n${fields.map(([key, type]) => `    ${key}: ${type}`).join('\n')}`
        : `${object.name} = TypedDict(\n    "${object.name}",\n    {\n${fields
            .map(([key, type]) => `        ${quote(key, 'python')}: ${type},`)
            .join('\n')}\n    },\n)`,
    );
  }
  if (!isObjectOnly(shape.root)) out.push(`${shape.rootName} = ${typeOf(shape.root)}`);
  const header = imports.size ? `from typing import ${[...imports].sort().join(', ')}\n\n\n` : '';
  return `${header}${out.join('\n\n\n')}`;
};

/** One writer per language: the declarations, without the final line break. */
export const WRITERS: Record<Language, (shape: TypeShape, options: WriteOptions) => string> = {
  typescript,
  go,
  rust,
  python,
};
