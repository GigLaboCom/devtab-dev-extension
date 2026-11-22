// The tool's keys against independent implementations already on this machine (docs/tools/specs/keys.md §10,
// «Сверка»): OpenSSL (`openssl pkey`, `rsa`, `ec`), OpenSSH's `ssh-keygen` (-y, -l, -e, -i) and Node's own crypto
// (OpenSSL underneath; it reads JWK). Two directions:
//   forward  — pairs generated in Chrome for Testing by this package's logic (bundled for the page): every form and
//              fingerprint the page shows is read by the programs, which must find the same public key and fingerprints;
//   reverse  — keys made by `openssl genpkey` / `ssh-keygen -t` (written only under .state/cross of this copy, never in
//              ~/.ssh) are pasted into the logic in the same Chrome: the public key, forms and fingerprints must be the
//              programs' own.
// Not part of `pnpm check`: it needs the programs and the test browser; installs nothing. A heavy job — run it through
// the shared lock. Usage (from the copy's root):
//   node packages/tools/logic/keys/scripts/cross-check.mjs [--pairs=3]
import { execFileSync, spawnSync } from 'node:child_process';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../../../..');
const OUT = join(ROOT, '.state/cross');
const PAIRS = Number(process.argv.find(a => a.startsWith('--pairs='))?.slice(8) ?? 3);
const OPENSSL = ['/opt/homebrew/bin/openssl', '/usr/local/bin/openssl', 'openssl'].find(
  c => spawnSync(c, ['version'], { stdio: 'ignore' }).status === 0,
);
const SSH_KEYGEN = spawnSync('ssh-keygen', ['-?'], { stdio: 'ignore' }).status !== null ? 'ssh-keygen' : null;
if (!OPENSSL || !SSH_KEYGEN) throw new Error('openssl and ssh-keygen are needed');
const opensslVersion = execFileSync(OPENSSL, ['version']).toString().trim();

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// The logic, bundled for the page with the workspace's esbuild (vite's).
const viteRequire = createRequire(createRequire(join(ROOT, 'extension/package.json')).resolve('vite'));
const { build } = viteRequire('esbuild');
const bundle = await build({
  entryPoints: [join(HERE, '../src/index.ts')],
  bundle: true,
  format: 'iife',
  globalName: 'Keys',
  write: false,
  platform: 'browser',
  target: 'es2022',
  alias: { '@workspace/tools-shared': join(ROOT, 'packages/tools/logic/shared') },
});
const code = bundle.outputFiles[0].text;

const run = (cmd, args, input) => {
  const r = spawnSync(cmd, args, { input, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
};
const file = (name, text, mode) => {
  const p = join(OUT, name);
  writeFileSync(p, text);
  if (mode) chmodSync(p, mode);
  return p;
};
const derOfPem = pem =>
  Buffer.from(
    pem
      .split('\n')
      .filter(l => l && !l.startsWith('-----'))
      .join(''),
    'base64',
  );
const spkiPemOf = path => run(OPENSSL, ['pkey', '-in', path, '-pubout']).out;
const results = { passed: 0, failed: [], counts: {} };
const skip = name => (results.counts[`skipped: ${name}`] = (results.counts[`skipped: ${name}`] ?? 0) + 1);
const check = (name, ok, detail) => {
  results.counts[name] = (results.counts[name] ?? 0) + 1;
  if (ok) results.passed++;
  else results.failed.push({ name, detail });
};

// ——— Chrome for Testing ———
process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(ROOT, '.state/extension-e2e/browsers');
const { chromium } = await import(join(ROOT, '.state/e2e/node/node_modules/playwright/index.mjs'));
const browser = await chromium.launch({ channel: 'chromium', headless: true });
const page = await browser.newPage();
await page.route('http://localhost/**', r =>
  r.fulfill({ contentType: 'text/html', body: '<!doctype html><p>keys</p>' }),
);
await page.goto('http://localhost/');
await page.addScriptTag({ content: code });
const userAgent = await page.evaluate(() => navigator.userAgent);

/** Everything the page shows of a key, computed in the page. */
const PAGE_FORMS = async (key, comment) => {
  const K = globalThis.Keys;
  const pub = {};
  for (const f of K.publicForms(key.data)) pub[f] = K.publicText(key, f, undefined);
  const priv = {};
  const isPrivate = key.data.type === 'rsa' ? !!key.data.priv : !!key.data.d;
  if (isPrivate) for (const f of K.privateForms(key.data)) priv[f] = K.privateText(key, f, { checkint: 0x2468ace0 });
  return { describe: K.describe(key), pub, priv, fp: await K.fingerprints(key.data), comment };
};

const forwardConfigs = [
  { algorithm: 'Ed25519', size: 3072, rsaAlg: 'RS256' },
  { algorithm: 'X25519', size: 3072, rsaAlg: 'RS256' },
  { algorithm: 'P-256', size: 3072, rsaAlg: 'RS256' },
  { algorithm: 'P-384', size: 3072, rsaAlg: 'RS256' },
  { algorithm: 'P-521', size: 3072, rsaAlg: 'RS256' },
  { algorithm: 'RSA', size: 2048, rsaAlg: 'RS256' },
  { algorithm: 'RSA', size: 3072, rsaAlg: 'PS256' },
  { algorithm: 'RSA', size: 4096, rsaAlg: 'RSA-OAEP-256' },
];
await page.addScriptTag({ content: `globalThis.pageForms = ${PAGE_FORMS.toString()};` });
const forward = await page.evaluate(
  async ({ configs, pairs }) => {
    const forms = globalThis.pageForms;
    const out = [];
    for (const c of configs)
      for (let i = 0; i < pairs; i++) {
        const t = performance.now();
        const key = await globalThis.Keys.generatePair(c);
        const ms = performance.now() - t;
        key.comment = `cross-${c.algorithm}-${i}`;
        out.push({ config: c, ms, ...(await forms(key, key.comment)) });
      }
    return out;
  },
  { configs: forwardConfigs, pairs: PAIRS },
);

// Keys made by the programs.
const made = [];
const make = (name, args, kind = 'openssl') => {
  const path = join(OUT, name);
  const r = kind === 'openssl' ? run(OPENSSL, [...args, '-out', path]) : run(SSH_KEYGEN, [...args, '-f', path, '-q']);
  if (!r.ok) throw new Error(`${name}: ${r.err}`);
  chmodSync(path, 0o600);
  made.push({ name, path, text: readFileSync(path, 'utf8') });
  return path;
};
for (let i = 0; i < PAIRS; i++) {
  for (const bits of [2048, 3072, 4096])
    make(`rsa${bits}-${i}.pem`, ['genpkey', '-algorithm', 'RSA', '-pkeyopt', `rsa_keygen_bits:${bits}`]);
  for (const curve of ['P-256', 'P-384', 'P-521'])
    make(`ec-${curve}-${i}.pem`, [
      'genpkey',
      '-algorithm',
      'EC',
      '-pkeyopt',
      `ec_paramgen_curve:${curve}`,
      '-pkeyopt',
      'ec_param_enc:named_curve',
    ]);
  make(`ed25519-${i}.pem`, ['genpkey', '-algorithm', 'ED25519']);
  make(`x25519-${i}.pem`, ['genpkey', '-algorithm', 'X25519']);
  // Traditional forms, written by openssl from the PKCS#8 ones.
  const trad = (src, dst, cmd) => {
    const r = run(OPENSSL, [cmd, '-in', join(OUT, src), '-traditional', '-out', join(OUT, dst)]);
    if (!r.ok) throw new Error(r.err);
    made.push({ name: dst, path: join(OUT, dst), text: readFileSync(join(OUT, dst), 'utf8') });
  };
  trad(`rsa2048-${i}.pem`, `rsa2048-trad-${i}.pem`, 'rsa');
  const sec1 = run(OPENSSL, ['ec', '-in', join(OUT, `ec-P-256-${i}.pem`), '-out', join(OUT, `ec-sec1-${i}.pem`)]);
  if (!sec1.ok) throw new Error(sec1.err);
  made.push({
    name: `ec-sec1-${i}.pem`,
    path: join(OUT, `ec-sec1-${i}.pem`),
    text: readFileSync(join(OUT, `ec-sec1-${i}.pem`), 'utf8'),
  });
  for (const [t, b] of [['ed25519'], ['ecdsa', '256'], ['ecdsa', '384'], ['ecdsa', '521'], ['rsa', '3072']]) {
    const name = `ssh-${t}${b ?? ''}-${i}`;
    make(name, ['-t', t, ...(b ? ['-b', b] : []), '-N', '', '-C', `made-${t}${b ?? ''}-${i}`], 'ssh');
    made.push({
      name: `${name}.pub`,
      path: join(OUT, `${name}.pub`),
      text: readFileSync(join(OUT, `${name}.pub`), 'utf8'),
    });
  }
}
// Encrypted: must be named, not read.
const encrypted = [];
const encrypt = (name, args, kind = 'openssl') => {
  const path = join(OUT, name);
  const r = kind === 'openssl' ? run(OPENSSL, [...args, '-out', path]) : run(SSH_KEYGEN, [...args, '-f', path, '-q']);
  if (!r.ok) throw new Error(`${name}: ${r.err}`);
  encrypted.push({ name, text: readFileSync(path, 'utf8') });
};
encrypt('enc-pkcs8.pem', [
  'pkcs8',
  '-topk8',
  '-v2',
  'aes-256-cbc',
  '-in',
  join(OUT, 'rsa2048-0.pem'),
  '-passout',
  'pass:cross',
]);
encrypt('enc-trad.pem', [
  'rsa',
  '-aes256',
  '-traditional',
  '-in',
  join(OUT, 'rsa2048-0.pem'),
  '-passout',
  'pass:cross',
]);
encrypt('enc-ssh', ['-t', 'ed25519', '-N', 'cross-pass', '-C', 'enc'], 'ssh');

const reverse = await page.evaluate(
  async ({ items }) => {
    const forms = globalThis.pageForms;
    const out = [];
    for (const item of items) {
      const read = globalThis.Keys.readKeys(item.text);
      const first = read.items[0];
      if (!first) out.push({ name: item.name, error: read.message });
      else if (!first.ok) out.push({ name: item.name, error: first.message });
      else {
        const done = await globalThis.Keys.completeKey(first.key);
        out.push(
          done.ok
            ? { name: item.name, ...(await forms(done.key, done.key.comment)) }
            : { name: item.name, error: done.message },
        );
      }
    }
    return out;
  },
  { items: [...made, ...encrypted] },
);
await browser.close();

// ——— Verification ———
const sshFingerprint = (path, md5) =>
  run(SSH_KEYGEN, ['-l', ...(md5 ? ['-E', 'md5'] : []), '-f', path]).out.split(' ')[1];
const blobOf = line => line.trim().split(/\s+/).slice(0, 2).join(' ');

/** The programs read every form of one key the page showed; all must give the page's SPKI and fingerprints. */
const verify = (tag, k) => {
  const spkiPem = k.pub.pem;
  const pubPath = file(`${tag}.pub.pem`, spkiPem);
  const spkiDer = run(OPENSSL, ['pkey', '-pubin', '-in', pubPath, '-outform', 'DER']);
  const hex = execFileSync(OPENSSL, ['dgst', '-sha256', '-r'], { input: derOfPem(spkiPem) })
    .toString()
    .split(' ')[0];
  check('openssl reads SPKI PEM; SHA-256 of SPKI equal', spkiDer.ok && hex === k.fp.spkiHex, {
    tag,
    hex,
    ours: k.fp.spkiHex,
  });
  check('SPKI Base64 fingerprint equal', Buffer.from(hex, 'hex').toString('base64') === k.fp.spkiBase64, { tag });
  if (k.pub.pkcs1) {
    const p = file(`${tag}.pkcs1.pem`, k.pub.pkcs1);
    check(
      'openssl reads RSA PUBLIC KEY → same SPKI',
      run(OPENSSL, ['rsa', '-RSAPublicKey_in', '-in', p, '-pubout']).out === spkiPem.trim(),
      { tag },
    );
  }
  if (k.pub.jwk) {
    const spkiFromJwk = createPublicKey({ key: JSON.parse(k.pub.jwk), format: 'jwk' }).export({
      type: 'spki',
      format: 'pem',
    });
    check('Node reads public JWK → same SPKI', spkiFromJwk.toString().trim() === spkiPem.trim(), { tag });
  }
  if (k.pub.openssh) {
    const p = file(`${tag}.ssh.pub`, k.pub.openssh);
    check('ssh-keygen -l SHA256 equal', sshFingerprint(p) === k.fp.sha256, {
      tag,
      theirs: sshFingerprint(p),
      ours: k.fp.sha256,
    });
    check('ssh-keygen -l -E md5 equal', sshFingerprint(p, true) === k.fp.md5, { tag });
    const e = run(SSH_KEYGEN, ['-e', '-m', 'PKCS8', '-f', p]);
    if (!e.ok || e.out === '') skip('ssh-keygen -e/-i -m PKCS8 has no Ed25519 here (LibreSSL 3.3.6 inside)');
    else {
      // ssh-keygen (LibreSSL) writes EC keys with explicit curve parameters; openssl names the curve again.
      const named = /^(EC|ECDSA) /.test(k.describe)
        ? run(OPENSSL, ['ec', '-pubin', '-pubout', '-param_enc', 'named_curve'], e.out).out
        : e.out;
      check('ssh-keygen -e -m PKCS8 → same public key as our SPKI', named === spkiPem.trim(), { tag, e: e.out });
      const i = run(SSH_KEYGEN, ['-i', '-m', 'PKCS8', '-f', pubPath]).out;
      check('ssh-keygen -i -m PKCS8 of our SPKI → our OpenSSH line', blobOf(i) === blobOf(k.pub.openssh), { tag, i });
    }
  }
  for (const [form, text] of Object.entries(k.priv)) {
    if (form === 'jwk') {
      const spkiFromJwk = createPublicKey(createPrivateKey({ key: JSON.parse(text), format: 'jwk' })).export({
        type: 'spki',
        format: 'pem',
      });
      check('Node reads private JWK → same SPKI', spkiFromJwk.toString().trim() === spkiPem.trim(), { tag });
      continue;
    }
    const p = file(`${tag}.${form}`, text, 0o600);
    if (form === 'openssh') {
      const y = run(SSH_KEYGEN, ['-y', '-f', p]);
      check(
        'ssh-keygen -y reads our OpenSSH private key → our public line',
        y.ok && blobOf(y.out) === blobOf(k.pub.openssh),
        { tag, err: y.err },
      );
      check('ssh-keygen -l of our OpenSSH private key equal', sshFingerprint(p) === k.fp.sha256, { tag });
      continue;
    }
    check(`openssl pkey reads our ${form} → same SPKI`, spkiPemOf(p) === spkiPem.trim(), { tag, form });
    if (form === 'traditional') {
      const cmd = text.includes('RSA PRIVATE KEY') ? 'rsa' : 'ec';
      check(
        `openssl ${cmd} reads our traditional form → same SPKI`,
        run(OPENSSL, [cmd, '-in', p, '-pubout']).out === spkiPem.trim(),
        { tag },
      );
      // ssh-keygen (LibreSSL inside) reads PEM RSA and EC private keys.
      const y = run(SSH_KEYGEN, ['-y', '-f', p]);
      check(
        'ssh-keygen -y reads our traditional form → our public line',
        y.ok && blobOf(y.out) === blobOf(k.pub.openssh),
        { tag, err: y.err },
      );
    }
  }
};

for (const [i, k] of forward.entries())
  verify(`fwd-${i}-${k.config.algorithm}${k.config.algorithm === 'RSA' ? k.config.size : ''}`, k);

const byName = Object.fromEntries(reverse.map(r => [r.name, r]));
for (const m of made) {
  const ours = byName[m.name];
  if (ours.error) {
    check('reverse: the tool reads the program’s key', false, { name: m.name, error: ours.error });
    continue;
  }
  check('reverse: the tool reads the program’s key', true);
  if (m.name.endsWith('.pub')) {
    // An OpenSSH public line made by ssh-keygen.
    check('reverse: our OpenSSH line = ssh-keygen’s', ours.pub.openssh.trim() === m.text.trim(), { name: m.name });
    check(
      'reverse: fingerprints = ssh-keygen -l',
      sshFingerprint(m.path) === ours.fp.sha256 && sshFingerprint(m.path, true) === ours.fp.md5,
      { name: m.name },
    );
    verify(`rev-${m.name}`, ours);
    continue;
  }
  if (m.name.startsWith('ssh-')) {
    // An OpenSSH private key file made by ssh-keygen: its public line and fingerprint.
    const line = readFileSync(`${m.path}.pub`, 'utf8');
    check('reverse: public key of ssh-keygen’s private file = its .pub', ours.pub.openssh.trim() === line.trim(), {
      name: m.name,
      ours: ours.pub.openssh,
    });
    verify(`rev-${m.name}`, ours);
    continue;
  }
  const theirs = spkiPemOf(m.path);
  check('reverse: our SPKI PEM = openssl pkey -pubout', ours.pub.pem.trim() === theirs, { name: m.name });
  if (ours.priv.pkcs8) {
    const theirPkcs8 = run(OPENSSL, ['pkey', '-in', m.path]).out;
    check('reverse: our PKCS#8 = openssl pkey (byte for byte)', ours.priv.pkcs8.trim() === theirPkcs8, {
      name: m.name,
      ours: ours.priv.pkcs8,
      theirs: theirPkcs8,
    });
  }
  if (ours.priv.traditional) {
    const cmd = m.name.startsWith('rsa') ? 'rsa' : 'ec';
    const theirTrad = run(OPENSSL, [cmd, '-in', m.path, ...(cmd === 'rsa' ? ['-traditional'] : [])]).out;
    check(`reverse: our traditional = openssl ${cmd} (byte for byte)`, ours.priv.traditional.trim() === theirTrad, {
      name: m.name,
    });
  }
  if (ours.pub.openssh) {
    const y = run(SSH_KEYGEN, ['-y', '-f', m.path]);
    if (y.ok)
      check('reverse: our OpenSSH line = ssh-keygen -y of the PEM', blobOf(y.out) === blobOf(ours.pub.openssh), {
        name: m.name,
      });
    else skip('ssh-keygen -y cannot read a PKCS#8 Ed25519 PEM');
  }
  verify(`rev-${m.name}`, ours);
}
for (const e of encrypted) {
  const ours = byName[e.name];
  check(
    'encrypted keys are named, not read',
    !!ours.error && /encrypted/.test(ours.error) && /nothing of it was read/.test(ours.error),
    {
      name: e.name,
      error: ours.error,
    },
  );
}

const timing = {};
for (const k of forward) {
  const name = `${k.config.algorithm}${k.config.algorithm === 'RSA' ? ` ${k.config.size}` : ''}`;
  (timing[name] ??= []).push(Math.round(k.ms));
}
const report = {
  openssl: opensslVersion,
  sshKeygen: run('ssh', ['-V']).err,
  browser: userAgent,
  forwardPairs: forward.length,
  reverseKeys: made.length,
  encrypted: encrypted.length,
  passed: results.passed,
  failed: results.failed.length,
  counts: results.counts,
  generationMs: timing,
  failures: results.failed.slice(0, 40),
};
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, failures: results.failed.slice(0, 10) }, null, 2));
process.exit(results.failed.length ? 1 : 0);
