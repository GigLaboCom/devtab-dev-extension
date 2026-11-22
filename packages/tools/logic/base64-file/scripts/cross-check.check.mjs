// The tool's Base64 against independent implementations already on this machine (docs/tools/specs/base64-file.md §10,
// §15): the system's `base64` command and Python's `base64` module. For files of sizes 0 to 5 MiB and every option,
// the tool's output (encodeBlob, in pieces) equals theirs, they decode the tool's output to the file, and the tool
// decodes theirs to the file. Not part of `pnpm check`: it needs those programs, installs nothing and skips what is
// missing. Run: pnpm --filter @workspace/tool-logic-base64-file exec vitest run --config scripts/cross-check.config.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_ENCODE_OPTIONS, decodeInput, encodeBlob } from '../src/index.ts';

const BASE64 = spawnSync('base64', ['-h'], { encoding: 'utf8' });
const HAS_BASE64 = BASE64.status === 0 || /base64/i.test(`${BASE64.stdout}${BASE64.stderr}`);
const PYTHON = spawnSync('python3', ['-c', 'import base64'], { stdio: 'ignore' }).status === 0;
const dir = mkdtempSync(join(tmpdir(), 'b64file-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const seeded = seed => () => ((seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0), seed);
const sizes = [...Array.from({ length: 65 }, (_, i) => i), 100, 912, 1000, 1216, 4095, 4096, 4097, 65535, 65536, 65537];
for (const s of [1048799, 1048800, 1048801, 2097600, 3 * 1048576, 5 * 1048576 + 7]) sizes.push(s);
const fileOf = (size, next) => Uint8Array.from({ length: size }, () => next() & 255);

const OPTIONS = [];
for (const alphabet of ['standard', 'url'])
  for (const padding of [true, false])
    for (const lineLength of [0, 64, 76]) OPTIONS.push({ ...DEFAULT_ENCODE_OPTIONS, alphabet, padding, lineLength });
const DATA_URI = { ...DEFAULT_ENCODE_OPTIONS, form: 'dataUri', type: 'application/octet-stream' };

const toolEncode = async (file, o) => {
  const parts = [];
  await encodeBlob(new Blob([file]), o, t => parts.push(t));
  return parts.join('');
};
const sha = data => createHash('sha256').update(data).digest('hex');
const counts = {};
const count = name => (counts[name] = (counts[name] ?? 0) + 1);

const PY = `
import base64, sys, json
data = open(sys.argv[1], 'rb').read()
out = {}
for alphabet in ('standard', 'url'):
    enc = base64.b64encode(data) if alphabet == 'standard' else base64.urlsafe_b64encode(data)
    for padding in (True, False):
        e = enc if padding else enc.rstrip(b'=')
        for n in (0, 64, 76):
            w = e if n == 0 else b'\\n'.join(e[i:i + n] for i in range(0, len(e), n))
            key = f'{alphabet}-{padding}-{n}'
            open(sys.argv[2] + '/py-' + key, 'wb').write(w)
# encodebytes: MIME, 76 per line, a newline after each line (the last one stripped for the comparison)
open(sys.argv[2] + '/py-encodebytes', 'wb').write(base64.encodebytes(data).rstrip(b'\\n'))
# Decoding the tool's outputs, each written by the test beside the file
res = {}
for alphabet in ('standard', 'url'):
    for padding in (True, False):
        for n in (0, 64, 76):
            key = f'{alphabet}-{padding}-{n}'
            t = open(sys.argv[2] + '/tool-' + key, 'rb').read().replace(b'\\n', b'')
            t += b'=' * (-len(t) % 4)
            d = base64.b64decode(t, validate=True) if alphabet == 'standard' else base64.urlsafe_b64decode(t)
            res[key] = d == data
print(json.dumps(res))
`;

describe.runIf(PYTHON && HAS_BASE64)('the system base64 and python3 base64', () => {
  it('versions', () => {
    const py = execFileSync('python3', ['--version'], { encoding: 'utf8' }).trim();
    const os = spawnSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).stdout?.trim() ?? '?';
    const version = spawnSync('base64', ['--version'], { encoding: 'utf8' });
    console.log(`${py}; base64: ${`${version.stdout}${version.stderr}`.trim().split('\n')[0]} (macOS ${os})`);
  });

  it('encodes as they do, they decode it, and it decodes theirs, for every size and option', async () => {
    const next = seeded(20261122);
    for (const size of sizes) {
      const file = fileOf(size, next);
      const path = join(dir, 'file.bin');
      writeFileSync(path, file);
      const tool = {};
      for (const o of OPTIONS) {
        const key = `${o.alphabet}-${o.padding ? 'True' : 'False'}-${o.lineLength}`;
        tool[key] = await toolEncode(file, o);
        writeFileSync(join(dir, `tool-${key}`), tool[key]);
      }
      const decodedByPython = JSON.parse(
        execFileSync('python3', ['-c', PY, path, dir], { encoding: 'utf8', maxBuffer: 1 << 30 }),
      );
      for (const [key, text] of Object.entries(tool)) {
        // Python's encoding of the same file, same options.
        const py = readFileSync(join(dir, `py-${key}`), 'latin1');
        expect(text, `${size} ${key} vs python`).toBe(py);
        count('encode = python');
        expect(decodedByPython[key], `${size} ${key} decoded by python`).toBe(true);
        count('python decodes the tool');
        const back = decodeInput(py);
        expect(back.ok && sha(back.bytes) === sha(file), `${size} ${key} tool decodes python`).toBe(true);
        count('the tool decodes python');
      }
      expect(tool['standard-True-76']).toBe(readFileSync(join(dir, 'py-encodebytes'), 'latin1'));
      count('encode = python encodebytes');
      // The system's base64: standard, padded; unwrapped, -b 64, -b 76 (each with a newline at the end, stripped).
      for (const n of [0, 64, 76]) {
        const args = n ? ['-b', String(n), '-i', path] : ['-i', path];
        const sys = execFileSync('base64', args, { encoding: 'latin1', maxBuffer: 1 << 30 }).replace(/\n$/, '');
        expect(tool[`standard-True-${n}`], `${size} -b ${n} vs base64`).toBe(sys);
        count('encode = base64');
        const back = decodeInput(sys);
        expect(back.ok && sha(back.bytes) === sha(file)).toBe(true);
        count('the tool decodes base64');
        writeFileSync(join(dir, 'tool.txt'), tool[`standard-True-${n}`]);
        const sysBack = execFileSync('base64', ['-D', '-i', join(dir, 'tool.txt')], { maxBuffer: 1 << 30 });
        expect(sha(sysBack) === sha(file), `${size} base64 -D decodes the tool`).toBe(true);
        count('base64 decodes the tool');
      }
      // A data URI: its body is the standard padded Base64, unwrapped.
      const uri = await toolEncode(file, DATA_URI);
      expect(uri).toBe(
        `data:application/octet-stream;base64,${readFileSync(join(dir, 'py-standard-True-0'), 'latin1')}`,
      );
      const back = decodeInput(uri);
      expect(back.ok && sha(back.bytes) === sha(file)).toBe(true);
      count('data URI round trip');
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    console.log(
      `${sizes.length} sizes (0 … ${Math.max(...sizes)} bytes); comparisons: ${JSON.stringify(counts)}; total ${total}`,
    );
  });
});
