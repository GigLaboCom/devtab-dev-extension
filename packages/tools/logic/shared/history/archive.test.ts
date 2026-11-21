import { collect, zipArchive } from './archive';
import { utf8 } from './bytes';
import { Sha256 } from './checksums';
import { memoryKeyHolder, noCipher, passwordCipher } from './cipher';
import { blobOf, lineOf } from './contract';
import { createHistoryFactory } from './factory';
import { memoryStore } from './memoryStore';
import { readZipDirectory, ZipWriter } from './zip';
import { describe, expect, it } from 'vitest';
import type { ArchiveInspection } from './archive';
import type { HistoryDeclaration } from './factory';
import type { HistoryStore } from './store';

const PRODUCER = { name: 'Test Product', version: '0.0.1' };
const NOW = Date.UTC(2026, 10, 21, 12);

const exportAll = async (store: HistoryStore, filter = {}) =>
  new Blob([await collect(zipArchive.write(store, filter, { producer: PRODUCER, now: NOW }))]);

const inspect = async (file: Blob): Promise<ArchiveInspection> => {
  const result = await zipArchive.inspect(file);
  if (!result.ok) throw new Error(JSON.stringify(result.problem));
  return result;
};

/** Everything a store holds, as bytes: record lines, blobs, keyrings. */
const dump = async (store: HistoryStore) => {
  const lines: string[] = [];
  const blobs: Record<string, string> = {};
  for await (const row of store.scan({})) {
    lines.push(row.line);
    for (const h of row.blobs) {
      const b = (await store.blob(h))!;
      blobs[h] = `${b.type}|${b.kid ?? ''}|${Buffer.from(await b.data.arrayBuffer()).toString('base64')}`;
    }
  }
  return { lines, blobs, keyrings: [...(await store.keyrings())] };
};

const sample = async () => {
  const store = memoryStore();
  const text = blobOf(1, '{"a": [1, 2, 3]}\n', 'application/json');
  const png = {
    ...blobOf(2, ''),
    hash: `sha256-${'b'.repeat(64)}`,
    size: 256,
    type: 'image/png',
    data: new Blob([new Uint8Array(256).map((_, i) => i)], { type: 'image/png' }),
  };
  await store.add(
    [
      lineOf({
        at: NOW - 3000,
        label: 'é ünïcode ✓',
        text: 'line\nbreak',
        blobs: [{ name: 'input', hash: text.hash, size: text.size, type: text.type }],
      }),
      lineOf({
        at: NOW - 2000,
        owner: 'qr',
        kind: 'image',
        blobs: [{ name: 'image', hash: png.hash, size: 256, type: 'image/png' }],
      }).replace(/}$/, ',"added":{"later":true}}'),
      lineOf({ at: NOW - 1000, owner: 'future-tool', kind: 'some-new-kind', schema: 7 }).replace(
        '"payload":{"a":1}',
        '"payload":{"n":1e21,"f":0.10,"big":12345678901234567890}',
      ),
    ],
    [text, png],
  );
  return store;
};

/** A ZIP of our layout with files changed by `edit` (the checksums recomputed unless `keepSums`). */
const craft = async (files: Record<string, Uint8Array<ArrayBuffer>>, keepSums = false) => {
  const chunks: Uint8Array[] = [];
  const zip = new ZipWriter(async c => {
    chunks.push(c.slice());
  });
  const sums: string[] = [];
  for (const [name, bytes] of Object.entries(files)) {
    if (name === 'SHA256SUMS') continue;
    await zip.add(name, bytes, { compress: name.endsWith('.jsonl') });
    if (name !== 'mimetype') sums.push(`${new Sha256().update(bytes).hex()}  ${name}`);
  }
  await zip.add('SHA256SUMS', keepSums ? files.SHA256SUMS : utf8(sums.map(s => s + '\n').join('')), {
    compress: false,
  });
  await zip.finish();
  return new Blob(chunks as BlobPart[]);
};

/** The files of an archive, by name. */
const unpack = async (file: Blob) => {
  const { readZipText, openZipEntry } = await import('./zip');
  const out: Record<string, Uint8Array<ArrayBuffer>> = {};
  for (const e of await readZipDirectory(file))
    out[e.name] = new Uint8Array(await new Response(await openZipEntry(file, e)).arrayBuffer());
  void readZipText;
  return out;
};

describe('the history archive (format 1)', () => {
  it('round trip: export → wipe → import gives byte-identical records and blobs', async () => {
    const store = await sample();
    const before = await dump(store);
    const file = await exportAll(store);
    await store.delete({});
    expect((await store.stats()).records).toBe(0);
    const inspection = await inspect(file);
    expect(inspection.summary).toMatchObject({
      records: 3,
      blobs: 2,
      encryptedRecords: 0,
      owners: ['future-tool', 'json', 'qr'],
    });
    expect(inspection.manifest).toMatchObject({
      format: 'tool-history',
      version: 1,
      minReaderVersion: 1,
      producer: PRODUCER,
      filter: {},
    });
    const report = await zipArchive.restore(store, inspection, {});
    expect(report).toMatchObject({ added: 3, same: 0, conflicts: 0, blobsAdded: 2, keyring: 'none' });
    expect(await dump(store)).toEqual(before);
    // Importing again changes nothing.
    expect(await zipArchive.restore(store, inspection, {})).toMatchObject({ added: 0, same: 3 });
  });

  it('lays the archive out for ordinary tools: mimetype first and stored, records as JSON lines, blobs as files, SHA256SUMS', async () => {
    const file = await exportAll(await sample());
    const head = new Uint8Array(await file.slice(0, 80).arrayBuffer());
    expect(new TextDecoder().decode(head.slice(30, 38))).toBe('mimetype');
    expect(new TextDecoder().decode(head.slice(38, 38 + 30))).toBe('application/x.tool-history+zip');
    const names = (await readZipDirectory(file)).map(e => e.name);
    expect(names.slice(0, 4)).toEqual(['mimetype', 'manifest.json', 'records.jsonl', 'blobs.jsonl']);
    expect(names.slice(-2)).toEqual(['summary.json', 'SHA256SUMS']);
    const files = await unpack(file);
    const sums = new TextDecoder().decode(files.SHA256SUMS).trim().split('\n');
    expect(sums).toHaveLength(names.length - 2);
    for (const line of sums) {
      const [hash, name] = line.split('  ');
      expect(new Sha256().update(files[name]).hex()).toBe(hash);
    }
    expect(new TextDecoder().decode(files['records.jsonl']).trim().split('\n')).toHaveLength(3);
  });

  it('exports what a filter shows, with only the blobs those records need', async () => {
    const file = await exportAll(await sample(), { owners: ['qr'] });
    const inspection = await inspect(file);
    expect(inspection.summary).toMatchObject({ records: 1, blobs: 1, owners: ['qr'] });
    expect(inspection.manifest.filter).toEqual({ owners: ['qr'] });
  });

  it('refuses a file that is not a ZIP, a ZIP that is not ours, and a damaged one — writing nothing', async () => {
    expect(await zipArchive.inspect(new Blob(['hello world, not a zip at all']))).toMatchObject({
      ok: false,
      problem: { code: 'not-zip' },
    });
    expect(await zipArchive.inspect(await craft({ 'readme.txt': utf8('hi') }))).toMatchObject({
      ok: false,
      problem: { code: 'foreign' },
    });
    const files = await unpack(await exportAll(await sample()));
    expect(await zipArchive.inspect(await craft({ ...files, mimetype: utf8('application/epub+zip') }))).toMatchObject({
      ok: false,
      problem: { code: 'foreign' },
    });

    // A changed record with the old checksum.
    const records = new TextDecoder().decode(files['records.jsonl']).replace('ünïcode', 'unicode');
    expect(await zipArchive.inspect(await craft({ ...files, 'records.jsonl': utf8(records) }, true))).toMatchObject({
      ok: false,
      problem: { code: 'damaged' },
    });
    // A record line that is not a record (checksums made to match).
    expect(
      await zipArchive.inspect(await craft({ ...files, 'records.jsonl': utf8('{"v":1,"id":"x"}\n') })),
    ).toMatchObject({ ok: false, problem: { code: 'damaged' } });
    // A blob missing.
    const noBlob = Object.fromEntries(Object.entries(files).filter(([n]) => !n.startsWith('blobs/sha256-b')));
    expect(await zipArchive.inspect(await craft(noBlob))).toMatchObject({ ok: false, problem: { code: 'damaged' } });
    // Cut off.
    const whole = await exportAll(await sample());
    expect((await zipArchive.inspect(whole.slice(0, whole.size - 100))).ok).toBe(false);
    // Bytes flipped inside the deflated records.
    const bytes = new Uint8Array(await whole.arrayBuffer());
    const at = (await readZipDirectory(whole)).find(e => e.name === 'records.jsonl')!.offset + 60;
    bytes[at] ^= 0xff;
    expect(await zipArchive.inspect(new Blob([bytes]))).toMatchObject({ ok: false, problem: { code: 'damaged' } });
  });

  it('forward: a newer file this version can still read is imported; unknown fields, kinds and files are kept or skipped', async () => {
    const files = await unpack(await exportAll(await sample()));
    const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']));
    const newer = await craft({
      ...files,
      'manifest.json': utf8(JSON.stringify({ ...manifest, version: 2, minReaderVersion: 1, somethingNew: { a: 1 } })),
      'attachments/notes.txt': utf8('a file format 2 adds'),
    });
    const inspection = await inspect(newer);
    expect(inspection.newerReadable).toBe(true);
    expect(inspection.unknownFiles).toEqual(['attachments/notes.txt']);
    const store = memoryStore();
    await zipArchive.restore(store, inspection, {});
    const lines = (await dump(store)).lines;
    expect(lines.some(l => l.includes('"added":{"later":true}'))).toBe(true);
    expect(lines.some(l => l.includes('"kind":"some-new-kind"') && l.includes('12345678901234567890'))).toBe(true);
  });

  it('forward: a file that needs a newer reader is refused with its versions', async () => {
    const files = await unpack(await exportAll(await sample()));
    const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']));
    const result = await zipArchive.inspect(
      await craft({
        ...files,
        'manifest.json': utf8(JSON.stringify({ ...manifest, version: 3, minReaderVersion: 3 })),
      }),
    );
    expect(result).toEqual({ ok: false, problem: { code: 'newer', version: 3, minReaderVersion: 3 } });
  });

  it('backward: a format-1 file as this writer makes it today stays readable (the frozen fixture)', async () => {
    const { readFileSync } = await import('node:fs');
    const fixture = new Blob([readFileSync(new URL('./fixtures/format-1.zip', import.meta.url))]);
    const inspection = await inspect(fixture);
    expect(inspection.summary).toMatchObject({ records: 3, blobs: 2 });
    const store = memoryStore();
    await zipArchive.restore(store, inspection, {});
    expect((await dump(store)).lines).toEqual((await dump(await sample())).lines.map(() => expect.any(String)));
    expect((await dump(store)).lines[0]).toContain('é ünïcode ✓');
  });

  it('keeps the local record on a conflicting id, and counts it', async () => {
    const store = await sample();
    const file = await exportAll(store);
    const first = (await store.page({}, { limit: 1 })).rows[0];
    await store.delete({ ids: [first.id] });
    await store.add([first.line.replace('"schema":7', '"schema":8')], []);
    const report = await zipArchive.restore(store, await inspect(file), {});
    expect(report).toMatchObject({ added: 0, same: 2, conflicts: 1 });
    expect((await store.get(first.id))!.line).toContain('"schema":8');
  });
});

describe('encrypted histories in the archive', () => {
  const SECRET: HistoryDeclaration = {
    kinds: [
      { id: 'secret', title: 'Secret', secret: true },
      { id: 'plain', title: 'Plain' },
    ],
    schema: 1,
    records: '',
    never: '',
  };

  const encrypted = async (password: string) => {
    const store = memoryStore();
    const cipher = passwordCipher({ keyrings: store, holder: memoryKeyHolder(), iterations: 1000 });
    await cipher.refresh();
    await cipher.setPassword(password);
    const recorder = createHistoryFactory({ store, cipher }).forOwner('jwt', SECRET).session();
    await recorder.commit({
      kind: 'secret',
      payload: { key: 'hs256-secret' },
      text: 'eyJ...',
      blobs: { token: new Blob(['eyJhbGciOi'], { type: 'text/plain' }) },
    });
    await recorder.commit({ kind: 'plain', payload: { alg: 'HS256' } });
    return { store, cipher };
  };

  it('stays encrypted in the file, carries its wrapped key, and opens elsewhere with the same password', async () => {
    const { store } = await encrypted('export test passphrase');
    const before = await dump(store);
    const file = await exportAll(store);
    const files = await unpack(file);
    expect(new TextDecoder().decode(files['records.jsonl'])).not.toContain('hs256-secret');
    expect(new TextDecoder().decode(files['keyrings.jsonl'])).toContain('"PBKDF2"');
    expect(new TextDecoder().decode(files['keyrings.jsonl'])).not.toContain('export test passphrase');

    // A history with no password takes the file's keyring: the file's password becomes its master password.
    const fresh = memoryStore();
    const vault = passwordCipher({ keyrings: fresh, holder: memoryKeyHolder(), iterations: 1000 });
    await vault.refresh();
    const inspection = await inspect(file);
    expect(zipArchive.plan(inspection, vault)).toMatchObject({ plan: 'take' });
    const report = await zipArchive.restore(fresh, inspection, { vault });
    expect(report).toMatchObject({ added: 2, skippedEncrypted: 0, keyring: 'take' });
    expect(await dump(fresh)).toEqual(before);
    expect(vault.state()).toBe('locked');
    await expect(vault.unlock('wrong passphrase!!')).rejects.toThrow();
    await vault.unlock('export test passphrase');
    const history = createHistoryFactory({ store: fresh, cipher: vault }).forOwner('jwt', SECRET);
    const secret = (await history.list()).entries.find(e => e.encrypted)!;
    const opened = await history.open(secret.id);
    expect(opened.ok && opened.payload).toEqual({ key: 'hs256-secret' });
    expect(opened.ok && (await opened.blobs.token.text())).toBe('eyJhbGciOi');
  });

  it('into a history with another password: skipped without the file’s password, adopted with it', async () => {
    const { store } = await encrypted('file passphrase one');
    const file = await exportAll(store);
    const { store: mine, cipher: myVault } = await encrypted('my own passphrase');
    const inspection = await inspect(file);
    expect(zipArchive.plan(inspection, myVault)).toMatchObject({ plan: 'adopt' });

    const without = await zipArchive.restore(mine, inspection, { vault: myVault });
    expect(without).toMatchObject({ added: 1, skippedEncrypted: 1 });
    await expect(
      zipArchive.restore(mine, inspection, { vault: myVault, password: 'not it at all' }),
    ).rejects.toMatchObject({ code: 'wrong-password' });
    const withPassword = await zipArchive.restore(mine, inspection, {
      vault: myVault,
      password: 'file passphrase one',
    });
    expect(withPassword).toMatchObject({ added: 1, same: 1, skippedEncrypted: 0 });
    await myVault.lock();
    await myVault.unlock('my own passphrase');
    const history = createHistoryFactory({ store: mine, cipher: myVault }).forOwner('jwt', SECRET);
    const opened = await Promise.all(
      (await history.list()).entries.filter(e => e.encrypted).map(e => history.open(e.id)),
    );
    expect(opened.map(o => o.ok && o.payload)).toEqual([{ key: 'hs256-secret' }, { key: 'hs256-secret' }]);
  });

  it('into a history with the same keyring: imported as is', async () => {
    const { store, cipher } = await encrypted('same passphrase here');
    const file = await exportAll(store);
    await store.delete({});
    const inspection = await inspect(file);
    expect(zipArchive.plan(inspection, cipher)).toEqual({ plan: 'same' });
    expect(await zipArchive.restore(store, inspection, { vault: cipher })).toMatchObject({
      added: 2,
      skippedEncrypted: 0,
    });
    void noCipher;
  });
});
