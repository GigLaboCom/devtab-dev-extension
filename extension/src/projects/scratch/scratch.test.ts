/**
 * Seam `ScratchStore` (D34): its contract (./contract.ts) on both implementations — the extension's storage (over an
 * area shaped as `chrome.storage.local`) and the page's memory — and what only the storage meets: a full area, a
 * record of another shape, the two kinds of records. The names (`parseName`, `newName`) and the editor's languages.
 */
import { scratchStoreContract } from './contract';
import {
  SCRATCHES_KEY,
  SCRATCH_TEXT_PREFIX,
  areaScratches,
  memoryArea,
  memoryScratches,
  normalizeList,
} from './storage';
import { SCRATCH_NAME_MAX, compareNames, fileName, newName, parseName, scratchId } from './store';
import { LANGUAGES } from '@src/compare/languages';
import { describe, expect, it } from 'vitest';
import type { ScratchArea } from './storage';

const stored = (area: ScratchArea, options: { now?: () => number } = {}) =>
  areaScratches(area, { id: 'chrome-storage-local', keeps: true, ...options });

scratchStoreContract('the extension’s storage', () => {
  const area = memoryArea();
  return { store: stored(area), reopen: () => stored(area) };
});

scratchStoreContract('the page’s memory', () => ({ store: memoryScratches(), reopen: () => memoryScratches() }));

/** An area that refuses writes past a size, as Chrome does past its quota. */
const fullArea = (bytes: number): ScratchArea & { rows: Map<string, unknown> } => {
  const area = memoryArea();
  const set = area.set;
  return {
    ...area,
    set: ((items: Record<string, unknown>) => {
      const after = new Map(area.rows);
      for (const [k, v] of Object.entries(items)) after.set(k, v);
      const size = [...after].reduce((n, [k, v]) => n + k.length + JSON.stringify(v).length, 0);
      return size > bytes ? Promise.reject(new Error('QUOTA_BYTES quota exceeded')) : set(items);
    }) as ScratchArea['set'],
  };
};

describe('the extension’s storage', () => {
  it('keeps a list and one record per text; a write changes only its own text', async () => {
    const area = memoryArea();
    const store = stored(area, { now: () => 1000 });
    const a = await store.create('rust');
    const b = await store.create('rust');
    if (!a.ok || !b.ok) throw new Error('not created');
    await store.write(a.value.id, 'fn main() {}\n');
    expect([...area.rows.keys()].sort()).toEqual(
      [SCRATCHES_KEY, `${SCRATCH_TEXT_PREFIX}${a.value.id}`, `${SCRATCH_TEXT_PREFIX}${b.value.id}`].sort(),
    );
    expect(area.rows.get(`${SCRATCH_TEXT_PREFIX}${b.value.id}`)).toBe('');
    expect(area.rows.get(SCRATCHES_KEY)).toMatchObject({ version: 1, lastLanguage: 'rust' });
  });

  it('a full storage refuses plainly and keeps what was stored', async () => {
    const area = fullArea(2000);
    const store = stored(area);
    const a = await store.create('text');
    if (!a.ok) throw new Error('not created');
    await store.write(a.value.id, 'kept');
    expect(await store.write(a.value.id, 'x'.repeat(5000))).toEqual({ ok: false, refused: { kind: 'full' } });
    expect(await store.read(a.value.id)).toBe('kept');
  });

  it('another failure of the storage is said with its message', async () => {
    const area = memoryArea();
    const store = stored({ ...area, set: (() => Promise.reject(new Error('disk said no'))) as ScratchArea['set'] });
    expect(await store.create('text')).toEqual({ ok: false, refused: { kind: 'failed', message: 'disk said no' } });
  });

  it('a list it cannot read is an empty one; nothing is deleted for it', async () => {
    const area = memoryArea();
    area.rows.set(SCRATCHES_KEY, 'not a list');
    const store = stored(area);
    expect((await store.list()).scratches).toEqual([]);
    expect(area.rows.get(SCRATCHES_KEY)).toBe('not a list');
  });

  it('a record of another shape: broken entries left out, repeated ids once, an unknown language as plain text', () => {
    const good = { id: 's_a', name: 'a', language: 'cobol', createdMs: 1, updatedMs: 2, chars: 0 };
    expect(
      normalizeList({ lastLanguage: 42, items: [good, { ...good }, { id: 's_b' }, null, 'x', { ...good, id: '' }] }),
    ).toEqual({ version: 1, lastLanguage: 'text', items: [{ ...good, language: 'text' }] });
  });

  it('a listed scratch whose text record is gone reads as empty', async () => {
    const area = memoryArea();
    const store = stored(area);
    const a = await store.create('text');
    if (!a.ok) throw new Error('not created');
    area.rows.delete(`${SCRATCH_TEXT_PREFIX}${a.value.id}`);
    expect(await store.read(a.value.id)).toBe('');
  });
});

describe('names', () => {
  it('the file name is the name and the language’s first extension', () => {
    expect(fileName({ name: 'scratch', language: 'cpp' })).toBe('scratch.cpp');
    expect(fileName({ name: 'scratch', language: 'text' })).toBe('scratch.txt');
    expect(fileName({ name: 'a', language: 'tsx' })).toBe('a.tsx');
  });

  it('a new name is the first free one in its language', () => {
    expect(newName([], 'python')).toBe('scratch');
    expect(newName([{ name: 'scratch', language: 'rust' }], 'python')).toBe('scratch');
    expect(
      newName(
        [
          { name: 'scratch', language: 'python' },
          { name: 'scratch_2', language: 'python' },
        ],
        'python',
      ),
    ).toBe('scratch_1');
  });

  it('a typed name: unsafe characters, spaces and dots at the ends, the length, an extension of a known language', () => {
    expect(parseName('  my notes ', 'text')).toEqual({ name: 'my notes', language: 'text' });
    expect(parseName('query.SQL', 'text')).toEqual({ name: 'query', language: 'sql' });
    expect(parseName('archive.tar', 'go')).toEqual({ name: 'archive.tar', language: 'go' });
    expect(parseName('..hidden..', 'go')).toEqual({ name: 'hidden', language: 'go' });
    expect(parseName('a\u0007b|c', 'go')).toEqual({ name: 'a_b_c', language: 'go' });
    expect(parseName('.py', 'go')).toEqual({ name: 'py', language: 'go' });
    expect(parseName('  ', 'go')).toBeNull();
    expect(parseName('x'.repeat(300), 'go')?.name).toHaveLength(SCRATCH_NAME_MAX);
  });

  it('sorted as a file tree: numbers by their value', () => {
    const sorted = ['scratch_10.txt', 'scratch_2.txt', 'notes.md'].sort(compareNames);
    expect(sorted).toEqual(['notes.md', 'scratch_2.txt', 'scratch_10.txt']);
  });

  it('ids: s_ and ten base32 characters', () => {
    expect(scratchId()).toMatch(/^s_[a-z2-7]{10}$/);
    expect(scratchId(b => b.fill(255))).toBe('s_7777777777');
  });

  it('every language of the editor can be chosen, kept and given its extension (no list of its own)', async () => {
    const store = memoryScratches();
    const made = await store.create(LANGUAGES[0]!.id);
    if (!made.ok) throw new Error('not created');
    for (const language of LANGUAGES) {
      const changed = await store.setLanguage(made.value.id, language.id);
      expect(changed.ok && fileName(changed.value)).toBe(`scratch.${language.extensions[0]}`);
    }
  });
});
