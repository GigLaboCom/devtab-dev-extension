// DEVTAB_MOCK_BACKEND — development only.
//
// The mock's own signing keys. Two, like the production list from the first release (backend.md §5.6, amendment А9):
// `p1` signs, `p2` waits until a developer switches to it. Generated on first start into the ignored state folder
// (.state/mock-backend/), never committed; the ids start with `mock-`, which a store build refuses (Check 17). A third
// key, `unknown`, lives in memory only: answers signed with it carry a key id no build knows.
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generateSigningKey, importSigningKey } from './jws.mjs';

export const KEY_FILE = 'keys.json';
export const PUBLIC_FILE = 'public.json';
export const ROLES = Object.freeze(['p1', 'p2']);

/** A key id of the mock: `mock-<8 hex>-<role>`, within `[a-z0-9-]{1,32}`. */
const kidFor = (stamp, role) => `mock-${stamp}-${role}`;

/** Fresh keys in memory: for tests, and the base of `loadOrCreateKeys`. */
export async function generateKeys() {
  const stamp = randomBytes(4).toString('hex');
  const signing = {};
  for (const role of ROLES) signing[role] = await generateSigningKey(kidFor(stamp, role));
  return { signing, unknown: await generateSigningKey(kidFor(randomBytes(4).toString('hex'), 'unknown')) };
}

/** What a development build's configuration needs: the public entries of both keys, in order (LicenceConfig.keys). */
export const publicEntries = keys => ROLES.map(role => keys.signing[role].publicEntry);

/**
 * The keys from `dir`, or new ones written there (the private file with mode 0600). `created` says which.
 */
export async function loadOrCreateKeys(dir) {
  const file = join(dir, KEY_FILE);
  let stored;
  try {
    stored = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`${file} cannot be read (${error.message}); delete it to start over`);
  }
  if (stored) {
    const signing = {};
    for (const role of ROLES) {
      const entry = stored.keys?.[role];
      if (!entry?.kid || !entry?.private) throw new Error(`${file} has no ${role} key; delete it to start over`);
      signing[role] = await importSigningKey(entry.kid, entry.private);
    }
    const { unknown } = await generateKeys();
    return { signing, unknown, created: false, file, publicFile: join(dir, PUBLIC_FILE) };
  }
  const keys = await generateKeys();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const body = {
    note: 'The development mock backend’s own keys (scripts/mock-backend). Never commit, never use in a store build.',
    keys: Object.fromEntries(
      ROLES.map(role => [role, { kid: keys.signing[role].kid, private: keys.signing[role].privateJwk }]),
    ),
  };
  await writeFile(file, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
  await chmod(file, 0o600);
  await writeFile(join(dir, PUBLIC_FILE), `${JSON.stringify(publicEntries(keys), null, 2)}\n`);
  return { ...keys, created: true, file, publicFile: join(dir, PUBLIC_FILE) };
}
