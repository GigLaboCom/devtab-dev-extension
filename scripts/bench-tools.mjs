#!/usr/bin/env node
// Throughput of the tools' plain CPU work in Node: the shared pure modules (Base64, hex, the JSON scanner) and the
// logic packages that need no DOM (the formatters' own passes, the converters, the generators). What a page does on
// top — a <textarea> holding the result, the HTML parser, layout — is not here; it is measured in Chrome by the tools'
// e2e modules. Each line: the case, the input size, the median of the runs (at least 5, or 1 s of runs), MiB/s of
// input where it means something, and the machine's load average (1 minute) when the line was measured: on a busy
// machine the times are upper bounds.
//
// The logic packages are TypeScript; Node 22.18+ strips the types itself. Their imports leave out the `.ts`
// extension, so a resolve hook below retries a missing module with it. No dependency is added; nothing is written.
//
// Usage: node scripts/bench-tools.mjs [--only=<id>[,<id>…]] [--sizes=small|large] [--list]
//   --only   run the cases of these ids (base64, hex, json-scan, json, json-csv, yaml-json, html-entities,
//            backslash-escape, hex-ascii, case, lines, url, string-inspector, json-to-code, curl-to-code, json-query,
//            code-format, sql-format, markdown-preview, random-string, lorem-ipsum, uuid, password)
//   --sizes  small: the first size of each case only (a quick look); large (default): every size
//   --list   print the ids and stop
import { spawnSync } from 'node:child_process';
import { createRequire, register } from 'node:module';
import { cpus, loadavg, totalmem } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HOOK = `
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (error) {
    if (!/^\\.\\.?\\//.test(specifier) || !['ERR_MODULE_NOT_FOUND', 'ERR_UNSUPPORTED_DIR_IMPORT'].includes(error?.code))
      throw error;
    for (const suffix of ['.ts', '/index.ts']) {
      try {
        return await next(specifier + suffix, context);
      } catch {}
    }
    throw error;
  }
}`;
// Some modules use TypeScript that is more than types (a parameter property): run again with the transform when the
// flag is missing.
if (!process.execArgv.includes('--experimental-transform-types')) {
  const again = spawnSync(
    process.execPath,
    ['--experimental-transform-types', '--no-warnings', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit' },
  );
  process.exit(again.status ?? 1);
}
register(`data:text/javascript,${encodeURIComponent(HOOK)}`, import.meta.url);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const logic = path => import(pathToFileURL(join(ROOT, 'packages/tools/logic', path)).href);

const args = process.argv.slice(2);
const option = name => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const only = option('only')?.split(',');
const quick = option('sizes') === 'small';

const KiB = 1024;
const MiB = 1024 * KiB;

/** Deterministic bytes (xorshift32): the same input on every run and machine. */
const bytesOf = (n, seed = 0x9e3779b9) => {
  const out = new Uint8Array(n);
  let x = seed >>> 0;
  for (let i = 0; i < n; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x & 0xff;
  }
  return out;
};
/** A seeded source for the generators (the RandomSource shape: fill the array). */
const seeded = () => {
  let x = 0x2545f491;
  return bytes => {
    for (let i = 0; i < bytes.length; i++) {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      bytes[i] = x & 0xff;
    }
  };
};
/** JSON of records about `n` characters long — the shape every JSON tool's specification measured. */
const jsonRecords = n => {
  const record = i =>
    `{"id":${i},"name":"user ${i}","email":"user${i}@example.com","active":${i % 2 === 0},"score":${(i * 7.3).toFixed(
      2,
    )},"tags":["a","b"],"address":{"city":"City ${i % 97}","zip":"${String(10000 + (i % 89999))}"}}`;
  const parts = [];
  let length = 2;
  for (let i = 0; length < n; i++) {
    const r = record(i);
    parts.push(r);
    length += r.length + 1;
  }
  return `[${parts.join(',')}]`;
};
const words = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor'.split(' ');
const prose = n => {
  const out = [];
  let length = 0;
  for (let i = 0; length < n; i++) {
    const w = words[(i * 7) % words.length];
    out.push(w);
    length += w.length + 1;
  }
  return out.join(' ').slice(0, n);
};
const linesOf = n => {
  const out = [];
  let length = 0;
  for (let i = 0; length < n; i++) {
    const l = `${words[(i * 5) % words.length]} item ${(i * 7919) % 100000}`;
    out.push(l);
    length += l.length + 1;
  }
  return out.join('\n');
};

/**
 * The cases: an id (what --only takes), what is measured, the sizes, how the input is made (outside the timing) and
 * what runs. `bytes` says how much input one run reads, for MiB/s; a case without it prints milliseconds only.
 */
const cases = [];
const add = (id, name, sizes, setup, run, bytes = (input, size) => size) =>
  cases.push({ id, name, sizes, setup, run, bytes });

// ---- shared modules
{
  const b64 = () => logic('shared/base64.ts');
  add(
    'base64',
    'bytesToBase64',
    [MiB, 16 * MiB, 64 * MiB],
    async n => ({ m: await b64(), bytes: bytesOf(n) }),
    ({ m, bytes }) => m.bytesToBase64(bytes),
  );
  add(
    'base64',
    'bytesToBase64, MIME lines of 76',
    [MiB, 16 * MiB],
    async n => ({ m: await b64(), bytes: bytesOf(n) }),
    ({ m, bytes }) => m.bytesToBase64(bytes, { lineLength: 76 }),
  );
  add(
    'base64',
    'parseBase64',
    [MiB, 16 * MiB, 64 * MiB],
    async n => {
      const m = await b64();
      return { m, text: m.bytesToBase64(bytesOf((n * 3) / 4)) };
    },
    ({ m, text }) => m.parseBase64(text),
  );
  add(
    'base64',
    'parseBase64, MIME lines of 76',
    [MiB, 16 * MiB],
    async n => {
      const m = await b64();
      return { m, text: m.bytesToBase64(bytesOf((n * 3) / 4), { lineLength: 76 }) };
    },
    ({ m, text }) => m.parseBase64(text),
  );
  add(
    'base64',
    'parseBase64, URL-safe',
    [MiB, 16 * MiB],
    async n => {
      const m = await b64();
      return { m, text: m.bytesToBase64(bytesOf((n * 3) / 4), { alphabet: 'url' }) };
    },
    ({ m, text }) => m.parseBase64(text),
  );
  add(
    'hex',
    'bytesToHex',
    [MiB, 16 * MiB],
    async n => ({ m: await logic('shared/hex.ts'), bytes: bytesOf(n) }),
    ({ m, bytes }) => m.bytesToHex(bytes),
  );
  add(
    'hex',
    'bytesToHex, spaced, 16 a line',
    [MiB, 4 * MiB],
    async n => ({ m: await logic('shared/hex.ts'), bytes: bytesOf(n) }),
    ({ m, bytes }) => m.bytesToHex(bytes, { format: 'spaced', bytesPerLine: 16 }),
  );
  const scan = () => logic('shared/json-scan.ts');
  add(
    'json-scan',
    'scanJson (check only)',
    [MiB, 16 * MiB],
    async n => ({ m: await scan(), text: jsonRecords(n) }),
    ({ m, text }) => m.scanJson(text),
  );
  add(
    'json-scan',
    'parseJsonTree',
    [MiB, 16 * MiB],
    async n => ({ m: await scan(), text: jsonRecords(n) }),
    ({ m, text }) => m.parseJsonTree(text),
  );
  add(
    'json-scan',
    'JSON.parse (the platform, for scale)',
    [MiB, 16 * MiB],
    async n => ({ text: jsonRecords(n) }),
    ({ text }) => JSON.parse(text),
  );
}

// ---- logic packages
add(
  'json',
  'printJson, indent 2',
  [MiB, 16 * MiB],
  async n => ({ m: await logic('json/src/index.ts'), text: jsonRecords(n) }),
  ({ m, text }) => m.printJson(text, { layout: 2, sortKeys: false, allowComments: false }),
);
add(
  'json',
  'printJson, sort keys',
  [MiB, 16 * MiB],
  async n => ({ m: await logic('json/src/index.ts'), text: jsonRecords(n) }),
  ({ m, text }) => m.printJson(text, { layout: 2, sortKeys: true, allowComments: false }),
);
add(
  'json',
  'printJson, minify',
  [MiB, 16 * MiB],
  async n => ({ m: await logic('json/src/index.ts'), text: jsonRecords(n) }),
  ({ m, text }) => m.printJson(text, { layout: 'minify', sortKeys: false, allowComments: false }),
);
{
  const toCsv = { delimiter: ',', header: true, flatten: true, newline: '\n', quoteAll: false, protectFormulas: true };
  const toJson = { delimiter: 'auto', header: true, detectTypes: true, empty: 'null', nest: false, layout: 2 };
  add(
    'json-csv',
    'jsonToCsv',
    [MiB, 16 * MiB],
    async n => ({ m: await logic('json-csv/src/index.ts'), text: jsonRecords(n) }),
    ({ m, text }) => m.jsonToCsv(text, toCsv),
  );
  add(
    'json-csv',
    'csvToJson',
    [MiB, 16 * MiB],
    async n => {
      const m = await logic('json-csv/src/index.ts');
      const made = m.jsonToCsv(jsonRecords(n), toCsv);
      return { m, text: made.ok ? made.text : '' };
    },
    ({ m, text }) => m.csvToJson(text, toJson),
    ({ text }) => text.length,
  );
}
add(
  'yaml-json',
  'jsonToYaml',
  [256 * KiB, 4 * MiB],
  async n => ({ m: await logic('yaml-json/src/index.ts'), text: jsonRecords(n) }),
  ({ m, text }) => m.jsonToYaml(text, { indent: 2 }),
);
add(
  'yaml-json',
  'yamlToJson',
  [256 * KiB, 4 * MiB],
  async n => {
    const m = await logic('yaml-json/src/index.ts');
    const made = m.jsonToYaml(jsonRecords(n), { indent: 2 });
    return { m, text: made.ok ? made.text : '' };
  },
  ({ m, text }) => m.yamlToJson(text, { version: '1.2', layout: 2 }),
  ({ text }) => text.length,
);
add(
  'html-entities',
  'encodeHtml, non-ASCII, decimal',
  [MiB, 5 * MiB],
  async n => ({ m: await logic('html-entities/src/index.ts'), text: prose(n).replace(/o/g, 'ö') }),
  ({ m, text }) => m.encodeHtml(text, { scope: 'nonAscii', format: 'decimal' }),
);
add(
  'html-entities',
  'decodeHtml',
  [MiB, 5 * MiB],
  async n => {
    const m = await logic('html-entities/src/index.ts');
    return { m, table: await m.loadReferenceTable(), text: prose(n).replace(/ /g, ' &amp; ').slice(0, n) };
  },
  ({ m, table, text }) => m.decodeHtml(text, table),
);
add(
  'backslash-escape',
  'escapeString, JSON, non-ASCII',
  [MiB, 5 * MiB],
  async n => ({ m: await logic('backslash-escape/src/index.ts'), text: linesOf(n).replace(/o/g, 'ö') }),
  ({ m, text }) => m.escapeString(text, { dialect: 'json', quote: '"', nonAscii: true, withQuotes: false }),
);
add(
  'backslash-escape',
  'unescapeString, JSON',
  [MiB, 5 * MiB],
  async n => {
    const m = await logic('backslash-escape/src/index.ts');
    return { m, text: m.escapeString(linesOf(n), { dialect: 'json', quote: '"', nonAscii: true, withQuotes: false }) };
  },
  ({ m, text }) => m.unescapeString(text, { dialect: 'json', withQuotes: false }),
  ({ text }) => text.length,
);
add(
  'hex-ascii',
  'hexDump',
  [MiB, 4 * MiB],
  async n => ({ m: await logic('hex-ascii/src/index.ts'), bytes: bytesOf(n) }),
  ({ m, bytes }) => m.hexDump(bytes),
);
add(
  'hex-ascii',
  'parseHex',
  [MiB, 5 * MiB],
  async n => ({ m: await logic('hex-ascii/src/index.ts'), text: Buffer.from(bytesOf(n / 2)).toString('hex') }),
  ({ m, text }) => m.parseHex(text),
);
add(
  'case',
  'convertAll (13 forms)',
  [64 * KiB, 512 * KiB],
  async n => ({ m: await logic('case/src/index.ts'), text: prose(n) }),
  ({ m, text }) => m.convertAll(text),
);
add(
  'lines',
  'runPipeline, natural sort',
  [MiB, 3 * MiB],
  async n => {
    const m = await logic('lines/src/index.ts');
    const p = m.DEFAULT_PIPELINE;
    const pipeline = {
      ...p,
      order: { enabled: true, kind: 'sort', sort: { kind: 'natural', descending: false, uppercaseFirst: false } },
    };
    return { m, pipeline, text: linesOf(n) };
  },
  ({ m, pipeline, text }) => m.runPipeline(text, pipeline),
);
add(
  'lines',
  'runPipeline, remove duplicates and trim',
  [MiB, 3 * MiB],
  async n => {
    const m = await logic('lines/src/index.ts');
    const p = m.DEFAULT_PIPELINE;
    const pipeline = { ...p, trim: { ...p.trim, enabled: true }, duplicates: { ...p.duplicates, enabled: true } };
    return { m, pipeline, text: linesOf(n) };
  },
  ({ m, pipeline, text }) => m.runPipeline(text, pipeline),
);
add(
  'url',
  'encodeUrl, component',
  [MiB, 5 * MiB],
  async n => ({ m: await logic('url/src/index.ts'), text: prose(n).replace(/ /g, ' ö&') }),
  ({ m, text }) => m.encodeUrl(text, 'component'),
);
add(
  'url',
  'decodeUrl',
  [MiB, 5 * MiB],
  async n => {
    const m = await logic('url/src/index.ts');
    return { m, text: m.encodeUrl(prose(n).replace(/ /g, ' ö&'), 'component') };
  },
  ({ m, text }) => m.decodeUrl(text, { plusAsSpace: false }),
  ({ text }) => text.length,
);
add(
  'string-inspector',
  'inspect, mixed text',
  [64 * KiB, MiB],
  async n => ({
    m: await logic('string-inspector/src/index.ts'),
    text: prose(n).replace(/o/g, 'ö').replace(/e/g, 'é😀').slice(0, n),
  }),
  ({ m, text }) => m.inspect(text),
);
add(
  'json-to-code',
  'jsonToCode, TypeScript',
  [MiB, 16 * MiB],
  async n => ({ m: await logic('json-to-code/src/index.ts'), text: jsonRecords(n) }),
  ({ m, text }) =>
    m.jsonToCode(text, { language: 'typescript', rootName: 'Root', declaration: 'interface', exportTypes: true }),
);
add(
  'curl-to-code',
  'curlToCode, JavaScript, body of the size',
  [MiB, 16 * MiB],
  async n => {
    const m = await logic('curl-to-code/src/index.ts');
    return {
      m,
      generator: await m.loadGenerator('javascript'),
      text: `curl -X POST https://example.com/api -H 'Content-Type: application/json' -d '${jsonRecords(n)}'`,
    };
  },
  ({ m, generator, text }) => m.curlToCode(text, generator),
);
add(
  'json-query',
  'runQuery $..name (document read once)',
  [MiB, 16 * MiB],
  async n => {
    const m = await logic('json-query/src/index.ts');
    const scan = await logic('shared/json-scan.ts');
    const tree = scan.parseJsonTree(jsonRecords(n));
    return { m, root: tree.ok ? tree.tree : null };
  },
  ({ m, root }) => m.runQuery('$..name', root),
);
add(
  'code-format',
  'printXml (own printer)',
  [MiB, 8 * MiB],
  async n => {
    const item = i => `<item id="${i}"><name>user ${i}</name><tags><tag>a</tag><tag>b</tag></tags></item>`;
    const parts = [];
    let length = 0;
    for (let i = 0; length < n; i++) {
      parts.push(item(i));
      length += parts.at(-1).length;
    }
    return { m: await logic('code-format/src/index.ts'), text: `<root>${parts.join('')}</root>` };
  },
  ({ m, text }) => m.printXml(text, 2),
  ({ text }) => text.length,
);
add(
  'sql-format',
  'formatSql, Standard SQL (library)',
  [64 * KiB, MiB],
  async n => {
    const m = await logic('sql-format/src/index.ts');
    const row = i => `INSERT INTO users (id, name, email) VALUES (${i}, 'user ${i}', 'u${i}@example.com');`;
    const parts = [];
    let length = 0;
    for (let i = 0; length < n; i++) {
      parts.push(row(i));
      length += parts.at(-1).length + 1;
    }
    // The library comes from the tool's own dependencies, as its worker takes it.
    const library = await import(
      createRequire(join(ROOT, 'packages/tools/logic/sql-format/package.json')).resolve('sql-formatter')
    );
    return { m, dialect: library.sql ?? library.default.sql, text: parts.join('\n') };
  },
  ({ m, dialect, text }) => m.formatSql(text, m.DEFAULT_OPTIONS, dialect),
  ({ text }) => text.length,
);
add(
  'markdown-preview',
  'renderMarkdown (markdown-it, worker side)',
  [64 * KiB, MiB],
  async n => {
    const block = '# Title\n\nSome *emphasis* and a [link](https://example.com) and `code`.\n\n- one\n- two\n\n';
    return {
      m: await logic('markdown-preview/src/index.ts'),
      text: block.repeat(Math.ceil(n / block.length)).slice(0, n),
    };
  },
  ({ m, text }) => m.renderMarkdown(text),
);
add(
  'random-string',
  'generate, 1,000,000 characters',
  [1_000_000],
  async () => ({ m: await logic('random-string/src/index.ts'), source: seeded() }),
  ({ m, source }) => m.generate({ mode: 'chars', preset: 'alnum', custom: '', length: 100, count: 10_000 }, source),
  () => 0,
);
add(
  'random-string',
  'generate, 1,000,000 bytes as Base64',
  [1_000_000],
  async () => ({ m: await logic('random-string/src/index.ts'), source: seeded() }),
  ({ m, source }) => m.generate({ mode: 'bytes', bytes: 1000, encoding: 'base64', count: 1000 }, source),
  () => 0,
);
add(
  'lorem-ipsum',
  'generate, 10,000 words',
  [10_000],
  async () => ({ m: await logic('lorem-ipsum/src/index.ts'), source: seeded() }),
  ({ m, source }) => m.generate({ unit: 'words', count: 10_000, startWithLorem: true, format: 'plain' }, source),
  () => 0,
);
add(
  'uuid',
  'generateBatch, 1,000 v7 and formatUuid',
  [1000],
  async () => {
    const m = await logic('uuid/src/index.ts');
    return { m, generator: m.createTimeOrderedGenerator(seeded()), source: seeded() };
  },
  ({ m, generator, source }) =>
    m.generateBatch('v7', 1000, generator, Date.now(), source).map(b => m.formatUuid(b, 'standard', false)),
  () => 0,
);

// ---- running
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const fmt = (n, digits = 1) =>
  n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
const sizeName = n =>
  n >= MiB && n % MiB === 0
    ? `${n / MiB} MiB`
    : n >= KiB && n % KiB === 0
      ? `${n / KiB} KiB`
      : n.toLocaleString('en-US');

if (args.includes('--list')) {
  console.log([...new Set(cases.map(c => c.id))].join('\n'));
  process.exit(0);
}
const chosen = cases.filter(c => !only || only.includes(c.id));
if (chosen.length === 0) {
  console.error(`No case for --only=${only}. Ids: ${[...new Set(cases.map(c => c.id))].join(', ')}`);
  process.exit(1);
}
console.log(
  `# ${cpus()[0]?.model ?? 'unknown CPU'}, ${cpus().length} cores, ${Math.round(totalmem() / 2 ** 30)} GiB, Node ${process.version}; ` +
    `load average at start ${loadavg()
      .map(l => l.toFixed(1))
      .join(' ')}`,
);
console.log('# id | case | input | median ms (runs) | MiB/s | load 1 min');
for (const c of chosen) {
  for (const size of quick ? c.sizes.slice(0, 1) : c.sizes) {
    try {
      const input = await c.setup(size);
      const first = await c.run(input); // warm-up: compile, load lazy tables
      // An answer that is an error would measure the error path: say so instead.
      if (first && typeof first === 'object' && first.ok === false)
        throw new Error(JSON.stringify(first.error ?? first.message ?? first).slice(0, 160));
      const times = [];
      const began = performance.now();
      while (times.length < 5 || (performance.now() - began < 1000 && times.length < 30)) {
        const t = performance.now();
        await c.run(input);
        times.push(performance.now() - t);
      }
      const ms = median(times);
      const read = c.bytes(input, size);
      const rate = read > 0 ? fmt(read / MiB / (ms / 1000)) : '—';
      console.log(
        `${c.id} | ${c.name} | ${sizeName(size)} | ${fmt(ms)} (${times.length}) | ${rate} | ${loadavg()[0].toFixed(1)}`,
      );
    } catch (error) {
      console.log(`${c.id} | ${c.name} | ${sizeName(size)} | failed: ${error?.message ?? error}`);
    }
  }
}
