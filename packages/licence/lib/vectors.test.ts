/**
 * The committed test vectors (testdata/vectors.json, made once by scripts/vectors.mjs): every token gives the stated
 * outcome of verifyToken and state of evaluate. The licence server runs the same file through its check; when it
 * publishes vectors of its own (testdata/server-vectors.json, copied from its repository), they are checked here too.
 */
import { evaluate } from './state';
import { verifyToken } from './verify';
import data from '../testdata/vectors.json';
import { describe, expect, it } from 'vitest';
import type { Stored } from './state';
import type { PublicKeyEntry } from './types';

interface Vector {
  readonly name: string;
  readonly token: string;
  readonly inst: string;
  readonly now: number;
  readonly seen: number;
  readonly verify: string;
  readonly state: Record<string, unknown>;
}
interface VectorFile {
  readonly keys: readonly PublicKeyEntry[];
  readonly vectors: readonly Vector[];
}

declare global {
  interface ImportMeta {
    /** Vite's static glob (the server's vectors are there only once copied from its repository). */
    glob<T>(pattern: string, options: { eager: true; import: 'default' }): Record<string, T>;
  }
}

const files: (readonly [string, VectorFile])[] = [['vectors.json', data as VectorFile]];
const server = import.meta.glob<VectorFile>('../testdata/server-vectors.json', { eager: true, import: 'default' });
for (const file of Object.values(server)) files.push(['server-vectors.json', file]);

describe.each(files)('%s', (_file, { keys, vectors }) => {
  it.each(vectors.map(v => [v.name, v] as const))('%s', async (_name, vector) => {
    const verified = await verifyToken(vector.token, keys);
    expect(verified.ok ? 'ok' : verified.reason).toBe(vector.verify);
    const stored: Stored = verified.ok
      ? { kind: 'token', claims: verified.claims, inst: vector.inst }
      : { kind: 'rejected', reason: verified.reason };
    expect(evaluate(stored, vector.now, vector.seen)).toMatchObject(vector.state);
  });
});

describe('vectors.json', () => {
  it('has the eight cases the specification names', () => {
    expect((data as VectorFile).vectors).toHaveLength(8);
  });

  it('holds test material only: test key ids', () => {
    expect((data as VectorFile).keys.length).toBeGreaterThan(0);
    for (const key of (data as VectorFile).keys) expect(key.kid).toMatch(/^test-/);
  });
});
