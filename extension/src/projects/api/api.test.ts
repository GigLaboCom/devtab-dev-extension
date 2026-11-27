// @vitest-environment node
/**
 * The copy of the companion's contract (./companion-api-v1/) is the companion's, byte for byte: every file has the
 * checksum SOURCES.sha256 records and no file is unrecorded (scripts/contract-sync.mjs makes both; `--check` also
 * compares the copy with the companion's clone when it is there and the types with the schemas).
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const filesUnder = (dir: string): string[] =>
  readdirSync(dir)
    .flatMap(name => (statSync(join(dir, name)).isDirectory() ? filesUnder(join(dir, name)) : [join(dir, name)]))
    .sort();

describe('the companion’s contract, copied', () => {
  const recorded = readFileSync(join(HERE, 'SOURCES.sha256'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => line.split('  ') as [string, string]);

  it('every copy matches its recorded checksum', () => {
    expect(recorded.length).toBeGreaterThan(30);
    for (const [sum, path] of recorded)
      expect(
        createHash('sha256')
          .update(readFileSync(join(HERE, path)))
          .digest('hex'),
        path,
      ).toBe(sum);
  });

  it('every file of the copy is recorded', () => {
    const copies = filesUnder(join(HERE, 'companion-api-v1')).map(f => relative(HERE, f).split('\\').join('/'));
    expect(copies).toEqual(recorded.map(([, path]) => path));
  });
});
