import { fromHex, toHex, utf8 } from './bytes';
import {
  createKeyring,
  dataKeys,
  hkdfBits,
  KDF_ITERATIONS,
  memoryKeyHolder,
  openBlobWith,
  openWith,
  passwordCipher,
  pbkdf2Bits,
  rewrapKeyring,
  sealBlobWith,
  sealWith,
  unlockKeyring,
  WrongPasswordError,
} from './cipher';
import { memoryStore } from './memoryStore';
import { describe, expect, it } from 'vitest';
import type { RecordIdentity } from './cipher';

const identity = (over: Partial<RecordIdentity> = {}): RecordIdentity => ({
  v: 1,
  id: '01JD0000000000000000000000',
  owner: 'password',
  kind: 'generated',
  session: 'S',
  time: '2026-11-21T10:00:00.000Z',
  schema: 1,
  blobs: [],
  ...over,
});

describe('known answers: the primitives as the history calls them', () => {
  it('PBKDF2-HMAC-SHA-256 — RFC 7914 §11', async () => {
    expect(toHex(await pbkdf2Bits('passwd', utf8('salt'), 1, 512))).toBe(
      '55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc49ca9cccf179b645991664b39d77ef317c71b845b1e30bd509112041d3a19783',
    );
    expect(toHex(await pbkdf2Bits('Password', utf8('NaCl'), 80000, 512))).toBe(
      '4ddcd8f60b98be21830cee5ef22701f9641a4418d04c0414aeff08876b34ab56a1d425a1225833549adb841b51c9b3176a272bdebba1d078478f62b397f33c8d',
    );
  });

  it('HKDF-SHA-256 — RFC 5869 A.1', async () => {
    const okm = await hkdfBits(
      fromHex('0b'.repeat(22)),
      fromHex('000102030405060708090a0b0c'),
      fromHex('f0f1f2f3f4f5f6f7f8f9'),
      42 * 8,
    );
    expect(toHex(okm)).toBe('3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865');
  });

  it('AES-KW — RFC 3394 §4.6 (256-bit key data under a 256-bit KEK)', async () => {
    const kek = await crypto.subtle.importKey(
      'raw',
      fromHex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'),
      'AES-KW',
      false,
      ['wrapKey', 'unwrapKey'],
    );
    const data = await crypto.subtle.importKey(
      'raw',
      fromHex('00112233445566778899aabbccddeeff000102030405060708090a0b0c0d0e0f'),
      'AES-GCM',
      true,
      ['encrypt'],
    );
    expect(toHex(new Uint8Array(await crypto.subtle.wrapKey('raw', data, kek, 'AES-KW')))).toBe(
      '28c9f404c4b810f4cbccb35cfb87f8263f5786e2d80ed326cbc7f0e71a99f43bfb988b9b7a02dd21',
    );
  });

  it('AES-256-GCM — test case 16 of the GCM specification (McGrew, Viega)', async () => {
    const key = await crypto.subtle.importKey(
      'raw',
      fromHex('feffe9928665731c6d6a8f9467308308feffe9928665731c6d6a8f9467308308'),
      'AES-GCM',
      false,
      ['encrypt'],
    );
    const ct = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: fromHex('cafebabefacedbaddecaf888'),
        additionalData: fromHex('feedfacedeadbeeffeedfacedeadbeefabaddad2'),
      },
      key,
      fromHex(
        'd9313225f88406e5a55909c5aff5269a86a7a9531534f7da2e4c303d8a318a721c3c0c95956809532fcf0e2449a6b525b16aedf5aa0de657ba637b39',
      ),
    );
    expect(toHex(new Uint8Array(ct))).toBe(
      '522dc1f099567d07f47f37a32a84427d643a8cdcbfe5c0c97598a2bd2555d1aa8cb08e48590dbb3da7b08b1056828838c5f61e6393ba7a0abcc9f662' +
        '76fc6ece0f4e1768cddf8853bb2d551b',
    );
  });
});

describe('keyrings', () => {
  it('a new keyring uses PBKDF2-SHA-256 at the OWASP work factor and a fresh salt', async () => {
    const { keyring } = await createKeyring('a long test passphrase', Date.UTC(2026, 10, 21), 1000);
    expect(keyring).toMatchObject({
      v: 1,
      wrap: { alg: 'AES-KW', by: 'password' },
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 1000 },
    });
    expect(KDF_ITERATIONS).toBe(600_000);
    expect(atob(keyring.kdf!.salt)).toHaveLength(16);
    expect(atob(keyring.key)).toHaveLength(40); // 32 bytes + the AES-KW integrity block
  });

  it('opens with its password only; a new password re-wraps the same key', async () => {
    const { keyring, raw } = await createKeyring('first passphrase here', Date.now(), 1000);
    expect(toHex(await unlockKeyring(keyring, 'first passphrase here'))).toBe(toHex(raw));
    await expect(unlockKeyring(keyring, 'first passphrase herE')).rejects.toBeInstanceOf(WrongPasswordError);
    const next = await rewrapKeyring(keyring, raw, 'second passphrase', 1000);
    expect(next.kid).toBe(keyring.kid);
    expect(next.kdf!.salt).not.toBe(keyring.kdf!.salt);
    expect(toHex(await unlockKeyring(next, 'second passphrase'))).toBe(toHex(raw));
    await expect(unlockKeyring(next, 'first passphrase here')).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it('normalises the password (NFC): the same characters typed differently open the same keyring', async () => {
    const { keyring } = await createKeyring('café au lait passphrase', Date.now(), 1000);
    await expect(unlockKeyring(keyring, 'café au lait passphrase')).resolves.toBeInstanceOf(Uint8Array);
  });
});

describe('sealing', () => {
  const keys = () => dataKeys('K1', crypto.getRandomValues(new Uint8Array(32)));

  it('a record opens with its identity and key, and with nothing else', async () => {
    const k = await keys();
    const sealed = await sealWith(k, identity(), { label: 'secret', payload: { password: 'hunter2hunter2' } });
    expect(sealed.alg).toBe('A256GCM');
    expect(atob(sealed.iv)).toHaveLength(12);
    expect(sealed.ct).not.toContain('hunter2');
    expect(await openWith(k, identity(), sealed)).toEqual({ label: 'secret', payload: { password: 'hunter2hunter2' } });

    // Moved to another record (id, time, owner, blobs): does not open.
    for (const other of [
      identity({ id: '01JD0000000000000000000001' }),
      identity({ time: '2026-11-21T10:00:00.001Z' }),
      identity({ owner: 'jwt' }),
      identity({ blobs: [{ hash: 'sha256-' + '0'.repeat(64), size: 1 }] }),
    ])
      await expect(openWith(k, other, sealed)).rejects.toThrow(/does not open/);
    // Tampered.
    const bytes = Uint8Array.from(atob(sealed.ct), c => c.charCodeAt(0));
    bytes[3] ^= 1;
    await expect(openWith(k, identity(), { ...sealed, ct: btoa(String.fromCharCode(...bytes)) })).rejects.toThrow();
    // Another key.
    await expect(openWith(await keys(), identity(), sealed)).rejects.toThrow();
    // A fresh nonce every time.
    expect((await sealWith(k, identity(), {})).iv).not.toBe((await sealWith(k, identity(), {})).iv);
  });

  it('a blob is named by a keyed hash (equal bytes, equal id; no plain SHA-256), and opens only under its id', async () => {
    const k = await keys();
    const bytes = utf8('private key material');
    const { blobIdWith } = await import('./cipher');
    const id = await blobIdWith(k, bytes);
    expect(id).toMatch(/^hmac256-[0-9a-f]{64}$/);
    expect(await blobIdWith(k, bytes)).toBe(id);
    expect(await blobIdWith(await keys(), bytes)).not.toBe(id);
    const stored = await sealBlobWith(k, id, bytes);
    expect(new TextDecoder().decode(await openBlobWith(k, id, stored))).toBe('private key material');
    const otherId = await blobIdWith(k, utf8('other'));
    await expect(openBlobWith(k, otherId, stored)).rejects.toThrow();
    stored[20] ^= 1;
    await expect(openBlobWith(k, id, stored)).rejects.toThrow();
  });
});

describe('passwordCipher: set, lock, unlock, change, across two pages', () => {
  it('two pages over one key holder share one unlock and one lock', async () => {
    const store = memoryStore();
    const holder = memoryKeyHolder();
    const pageA = passwordCipher({ keyrings: store, holder, iterations: 1000 });
    const pageB = passwordCipher({ keyrings: store, holder, iterations: 1000 });
    await pageA.refresh();
    await pageB.refresh();
    expect(pageA.state()).toBe('none');
    await pageA.setPassword('correct horse battery');
    expect(pageA.state()).toBe('unlocked');
    await pageB.refresh();
    expect(pageB.state()).toBe('unlocked');

    const sealed = await pageA.sealRecord(identity(), { payload: 'x' });
    expect(await pageB.openRecord(identity(), sealed)).toEqual({ payload: 'x' });

    await pageB.lock();
    await new Promise(r => setTimeout(r, 0));
    expect(pageA.state()).toBe('locked');
    await expect(pageA.openRecord(identity(), sealed)).rejects.toThrow(/locked/);
    await expect(pageA.unlock('wrong horse battery')).rejects.toBeInstanceOf(WrongPasswordError);
    expect(pageA.state()).toBe('locked');
    await pageA.unlock('correct horse battery');
    await new Promise(r => setTimeout(r, 0));
    expect(pageB.state()).toBe('unlocked');

    await pageA.changePassword('correct horse battery', 'a different passphrase');
    await pageA.lock();
    await expect(pageA.unlock('correct horse battery')).rejects.toBeInstanceOf(WrongPasswordError);
    await pageA.unlock('a different passphrase');
    expect(await pageA.openRecord(identity(), sealed)).toEqual({ payload: 'x' }); // same data key: nothing re-encrypted

    await pageA.removePassword();
    expect(pageA.state()).toBe('none');
    expect((await store.keyrings()).size).toBe(0);
  });

  it('adopts another history’s keyring with its password, so one password opens both', async () => {
    const here = passwordCipher({ keyrings: memoryStore(), holder: memoryKeyHolder(), iterations: 1000 });
    await here.refresh();
    await here.setPassword('our passphrase here');
    const elsewhereStore = memoryStore();
    const elsewhere = passwordCipher({ keyrings: elsewhereStore, holder: memoryKeyHolder(), iterations: 1000 });
    await elsewhere.refresh();
    await elsewhere.setPassword('their passphrase');
    const sealed = await elsewhere.sealRecord(identity(), { payload: 'theirs' });
    const theirRing = elsewhere.activeKeyring()!;

    await expect(here.adopt(theirRing, 'not theirs at all', [])).rejects.toBeInstanceOf(WrongPasswordError);
    await here.adopt(theirRing, 'their passphrase', []);
    expect(await here.openRecord(identity(), sealed)).toEqual({ payload: 'theirs' });
    await here.lock();
    await here.unlock('our passphrase here');
    expect(await here.openRecord(identity(), sealed)).toEqual({ payload: 'theirs' });
    expect(here.activeKeyring()!.kid).not.toBe(theirRing.kid);
  });
});
