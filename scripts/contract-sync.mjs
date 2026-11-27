#!/usr/bin/env node
// The companion's API contract in the extension (the companion's specification §11.3): its `contract/companion-api-v1/`
// copied byte for byte into extension/src/projects/api/companion-api-v1/, the checksum of every copy in
// extension/src/projects/api/SOURCES.sha256, and the TypeScript types made from its schemas in
// extension/src/projects/api/types.gen.ts. The companion's repository is the source; nothing here edits a copy.
//
//   node scripts/contract-sync.mjs <path to a clone of the companion>   copy, record the checksums, make the types
//   DEVTAB_COMPANION_DIR=<path> node scripts/contract-sync.mjs          the same
//   node scripts/contract-sync.mjs --check                              compare the copies with SOURCES.sha256 and the
//                                                                       types with the schemas; with the companion's
//                                                                       clone present (the argument,
//                                                                       DEVTAB_COMPANION_DIR or ../devtab-dev-server),
//                                                                       also the copies with their sources
//
// The types come from a small generator below, not a dependency: the schemas are schemars' output and use a handful of
// JSON Schema's words (type, properties, required, items, enum, const, oneOf, anyOf, $ref into $defs, nullable type
// lists). A word it does not know stops it, so a richer schema is noticed rather than typed loosely.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NAME = 'companion-api-v1';
const API = join(ROOT, 'extension/src/projects/api');
const COPY = join(API, NAME);
const RECORD = join(API, 'SOURCES.sha256');
const TYPES = join(API, 'types.gen.ts');

const args = process.argv.slice(2).filter(a => a !== '--');
const checkOnly = args.includes('--check');
const given = args.find(a => !a.startsWith('--')) ?? process.env.DEVTAB_COMPANION_DIR;
const sibling = resolve(ROOT, '../devtab-dev-server');
const companion = given ? resolve(given) : existsSync(join(sibling, 'contract', NAME)) ? sibling : null;

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const filesUnder = dir =>
  readdirSync(dir)
    .flatMap(name => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? filesUnder(path) : [path];
    })
    .sort();
const recordOf = dir =>
  filesUnder(dir)
    .map(file => `${sha256(readFileSync(file))}  ${relative(API, file).split('\\').join('/')}\n`)
    .join('');

// ---- the types ----------------------------------------------------------------------------------------------------

const KNOWN = new Set([
  '$schema',
  '$defs',
  '$ref',
  'title',
  'description',
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'minItems',
  'maxItems',
  'enum',
  'const',
  'oneOf',
  'anyOf',
  'format',
  'minimum',
  'default',
]);

const doc = text => (text ? `/** ${text.replace(/\*\//g, '*\\/').replace(/\n/g, ' ')} */\n` : '');
const key = name => (/^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name));

/** Named types, in the order they are first met; one name is one shape everywhere. */
const named = new Map();
const define = (name, schema, render) => {
  const shape = JSON.stringify(schema);
  const known = named.get(name);
  if (known) {
    if (known.shape !== shape) throw new Error(`two different schemas are named ${name}`);
    return name;
  }
  named.set(name, { shape, text: '' });
  named.get(name).text = render();
  return name;
};

/** The TypeScript type of a schema; `defs` are the `$defs` of the document it is in. */
const typeOf = (schema, defs) => {
  if (schema === true) return 'unknown';
  if (schema === false) return 'never';
  for (const word of Object.keys(schema))
    if (!KNOWN.has(word)) throw new Error(`the generator does not know "${word}" (${JSON.stringify(schema)})`);
  if (schema.$ref) {
    const name = schema.$ref.replace(/^#\/\$defs\//, '');
    if (!defs?.[name]) throw new Error(`no definition for ${schema.$ref}`);
    return defineNamed(name, defs[name], defs);
  }
  if ('const' in schema) return JSON.stringify(schema.const);
  if (schema.enum) return schema.enum.map(v => JSON.stringify(v)).join(' | ');
  const alternatives = schema.oneOf ?? schema.anyOf;
  if (alternatives) return alternatives.map(s => typeOf(s, defs)).join(' | ');
  if (Array.isArray(schema.type)) return schema.type.map(t => typeOf({ ...schema, type: t }, defs)).join(' | ');
  switch (schema.type) {
    case undefined:
      return 'unknown';
    case 'null':
      return 'null';
    case 'string':
      return 'string';
    case 'integer':
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'array': {
      const item = typeOf(schema.items ?? true, defs);
      if (schema.minItems !== undefined && schema.minItems === schema.maxItems && schema.minItems <= 4)
        return `[${Array.from({ length: schema.minItems }, () => item).join(', ')}]`;
      return `${wrap(item)}[]`;
    }
    case 'object': {
      const props = Object.entries(schema.properties ?? {});
      if (!props.length) return 'Record<string, never>';
      const required = new Set(schema.required ?? []);
      return `{\n${props
        .map(
          ([name, prop]) =>
            `${doc(prop.description)}${key(name)}${required.has(name) ? '' : '?'}: ${typeOf(prop, defs)};`,
        )
        .join('\n')}\n}`;
    }
    default:
      throw new Error(`unknown type ${schema.type}`);
  }
};
const wrap = type => (/[|&]/.test(type) && !type.startsWith('{') ? `(${type})` : type);

const defineNamed = (name, schema, defs) =>
  define(name, schema, () => {
    const type = typeOf(schema, defs);
    return type.startsWith('{') && schema.type === 'object'
      ? `${doc(schema.description)}export interface ${name} ${type}`
      : `${doc(schema.description)}export type ${name} = ${type};`;
  });

/** A document's top schema: named after its title (an array titled `Array_of_X` is `X[]`), else inline. */
const topType = (schema, fallback) => {
  const defs = schema.$defs;
  const title = schema.title;
  if (!title || title.startsWith('Array_of_') || schema.type !== 'object') return typeOf(schema, defs);
  return defineNamed(title ?? fallback, schema, defs);
};

const readJson = file => JSON.parse(readFileSync(file, 'utf8'));

const makeTypes = async dir => {
  named.clear();
  const methods = readdirSync(join(dir, 'methods'))
    .filter(f => f.endsWith('.schema.json'))
    .sort()
    .map(f => readJson(join(dir, 'methods', f)));
  const methodLines = methods.map(m => {
    const params = topType(m.params, 'Params');
    const result = topType(m.result, 'Result');
    const stream = m.stream ? topType(m.stream, 'Stream') : 'never';
    return `${doc(`${m.summary} Scope: ${m.scope}.`)}${JSON.stringify(m.method)}: { params: ${params}; result: ${result}; stream: ${stream} };`;
  });
  const events = Object.entries(readJson(join(dir, 'events.schema.json'))).sort(([a], [b]) => a.localeCompare(b));
  const eventLines = events.map(([name, e]) => `${doc(e.summary)}${JSON.stringify(name)}: ${topType(e.data, 'Data')};`);
  const envelope = readJson(join(dir, 'envelope.schema.json'));
  const client = typeOf(envelope.client, envelope.client.$defs);
  const server = typeOf(envelope.server, envelope.server.$defs);
  const errors = readJson(join(dir, 'errors.json')).errors;
  const source = `// Generated by scripts/contract-sync.mjs from ./${NAME}/, the companion's contract copied byte for byte.
// Do not edit: run the script again after a new copy. The methods the companion does not offer yet are typed by hand
// in ../types.ts.

${[...named.values()].map(n => n.text).join('\n\n')}

/** Every method of the contract: its parameters, its result and, for a streaming one, each part. */
export interface ContractMethods {
${methodLines.join('\n')}
}

/** Every event of the contract and its data. */
export interface ContractEvents {
${eventLines.join('\n')}
}

/** A frame from the extension. */
export type ClientFrame = ${client};

/** A frame from the supervisor (or, for \`error\` with code \`not-running\` / \`peer-not-allowed\`, from the relay). */
export type ServerFrame = ${server};

/** The methods of the contract, in its order. */
export const CONTRACT_METHODS = ${JSON.stringify(methods.map(m => m.method))} as const;

/** The events of the contract. */
export const CONTRACT_EVENTS = ${JSON.stringify(events.map(([name]) => name))} as const;

/** Every error code (errors.json), with the version of the companion that first sends it. */
export const CONTRACT_ERRORS = ${JSON.stringify(Object.fromEntries(errors.map(e => [e.code, e.since])))} as const;
`;
  const config = (await prettier.resolveConfig(TYPES)) ?? {};
  return prettier.format(source, { ...config, filepath: TYPES });
};

// ---- the work -----------------------------------------------------------------------------------------------------

const problems = [];
if (!checkOnly) {
  if (!companion) {
    console.error('contract-sync: name the companion’s clone (an argument or DEVTAB_COMPANION_DIR)');
    process.exit(2);
  }
  const source = join(companion, 'contract', NAME);
  if (!existsSync(source)) {
    console.error(`contract-sync: ${source} does not exist`);
    process.exit(2);
  }
  rmSync(COPY, { recursive: true, force: true });
  cpSync(source, COPY, { recursive: true });
  writeFileSync(RECORD, recordOf(COPY));
  writeFileSync(TYPES, await makeTypes(COPY));
  console.log(`contract-sync: ${filesUnder(COPY).length} files copied from ${source}; types written`);
} else {
  if (!existsSync(RECORD)) problems.push('SOURCES.sha256 is missing');
  else if (readFileSync(RECORD, 'utf8') !== recordOf(COPY))
    problems.push('the copies differ from SOURCES.sha256 (a copy changed, or a file is missing or new)');
  if (!existsSync(TYPES) || readFileSync(TYPES, 'utf8') !== (await makeTypes(COPY)))
    problems.push('types.gen.ts is not what the schemas make (run the script with the companion’s clone)');
  if (companion) {
    const source = join(companion, 'contract', NAME);
    const fromSource = existsSync(source)
      ? filesUnder(source)
          .map(f => `${sha256(readFileSync(f))}  ${NAME}/${relative(source, f).split('\\').join('/')}\n`)
          .join('')
      : '';
    if (fromSource !== recordOf(COPY)) problems.push(`the copies differ from the companion’s ${source}`);
    else console.log(`contract-sync: the copies are the companion’s (${source})`);
  } else console.log('contract-sync: the companion’s clone is not here; compared with the checksums only');
  if (problems.length) {
    for (const p of problems) console.error(`contract-sync: ${p}`);
    process.exit(1);
  }
  console.log(`contract-sync: ${filesUnder(COPY).length} copies match SOURCES.sha256; the types match the schemas`);
}
