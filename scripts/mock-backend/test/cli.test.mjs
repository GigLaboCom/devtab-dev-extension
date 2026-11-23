// The command line, the key on disk, the refusal to run as production, and the proof that nothing of the mock
// reaches the extension or a build.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { after, describe, test } from 'node:test';
import { parseDuration, productionVariable, settingsFromArgs } from '../cli.mjs';
import { LICENCE_SCENARIOS } from '../scenarios.mjs';
import { FORBIDDEN, scanBuild } from '../scan-build.mjs';

const CLI = join(import.meta.dirname, '..', 'cli.mjs');
const ROOT = join(import.meta.dirname, '..', '..', '..');
const temp = await mkdtemp(join(tmpdir(), 'mock-backend-test-'));
after(() => rm(temp, { recursive: true, force: true }));

/** Starts the CLI and resolves its output once it says it listens; `stop()` ends it with SIGTERM. */
function startCli(args, env = {}) {
  const child = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, NODE_ENV: '', ...env } });
  let out = '';
  return new Promise((resolve, reject) => {
    child.stdout.on('data', d => {
      out += d;
      if (out.includes('Stop with Ctrl+C.'))
        resolve({ out, stop: () => new Promise(done => (child.once('exit', done), child.kill('SIGTERM'))) });
    });
    child.stderr.on('data', d => (out += d));
    child.once('exit', code => reject(new Error(`exited ${code}: ${out}`)));
  });
}

describe('the command line', () => {
  test('refuses to start when the environment says production', () => {
    for (const [name, value] of [
      ['NODE_ENV', 'production'],
      ['DEVTAB_ENV', 'prod'],
      ['APP_ENV', 'Production'],
    ]) {
      const run = spawnSync(process.execPath, [CLI, '--port', '0', '--state-dir', join(temp, 'never')], {
        env: { ...process.env, NODE_ENV: '', [name]: value },
        encoding: 'utf8',
      });
      assert.equal(run.status, 2, `${name}=${value}`);
      assert.match(run.stderr, /refusing to start/);
    }
    assert.equal(productionVariable({ NODE_ENV: 'development' }), undefined);
  });

  test('generates its keys on first start (private file 0600), prints the public keys, reuses them after', async () => {
    const dir = join(temp, 'state');
    const first = await startCli(['--port', '0', '--state-dir', dir, '--quiet']);
    await first.stop();
    assert.match(first.out, /generated now in/);
    assert.match(first.out, /listening {4}http:\/\/127\.0\.0\.1:\d+ {2}\(loopback only\)/);
    const keyFile = join(dir, 'keys.json');
    assert.equal((await stat(keyFile)).mode & 0o777, 0o600);
    const stored = JSON.parse(await readFile(keyFile, 'utf8'));
    const pub = JSON.parse(await readFile(join(dir, 'public.json'), 'utf8'));
    assert.deepEqual(
      pub.map(e => e.kid),
      [stored.keys.p1.kid, stored.keys.p2.kid],
    );
    assert.ok(first.out.includes(pub[0].jwk.x) && first.out.includes(pub[1].jwk.x), 'prints both public keys');
    assert.ok(!first.out.includes(stored.keys.p1.private.d), 'never prints the private key');
    const second = await startCli([
      '--port',
      '0',
      '--state-dir',
      dir,
      '--quiet',
      '--signing-key',
      'p2',
      '--plans',
      'empty',
    ]);
    await second.stop();
    assert.match(second.out, /loaded from/);
    assert.match(second.out, new RegExp(`signing {6}${stored.keys.p2.kid} \\(p2\\)`));
    assert.match(second.out, /plans {8}empty/);
  });

  test('--list names every licence scenario with its fake key', () => {
    const run = spawnSync(process.execPath, [CLI, '--list'], { encoding: 'utf8' });
    assert.equal(run.status, 0);
    for (const s of LICENCE_SCENARIOS) assert.ok(run.stdout.includes(s.key), s.name);
  });

  test('options become settings; wrong ones are refused', () => {
    assert.deepEqual(settingsFromArgs({ scenario: 'expired', 'clock-offset': '-40d', 'fault-on': 'refresh,plans' }), {
      licence: 'expired',
      clockOffset: -40 * 86_400,
      faultOn: ['refresh', 'plans'],
    });
    assert.throws(() => settingsFromArgs({ fault: 'meteor' }), /fault must be one of/);
    assert.deepEqual(
      [parseDuration('3d'), parseDuration('5h'), parseDuration('90m'), parseDuration('15')],
      [259_200, 18_000, 5_400, 15],
    );
    assert.ok(Number.isNaN(parseDuration('soon')));
    const run = spawnSync(process.execPath, [CLI, '--nonsense'], {
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: '' },
    });
    assert.equal(run.status, 1);
  });
});

describe('nothing of the mock reaches the extension or a build', () => {
  test('the build scan finds each trace and passes a clean build', async () => {
    const dir = join(temp, 'build');
    await mkdir(join(dir, 'assets'), { recursive: true });
    await writeFile(join(dir, 'manifest.json'), '{"content_security_policy":"connect-src \'self\'"}');
    await writeFile(join(dir, 'assets', 'app.js'), 'const a="https://www.w3.org/2000/svg";const ip="127.0.0.1";');
    assert.deepEqual(await scanBuild(dir), []);
    const traces = [
      '/* DEVTAB_MOCK_BACKEND */',
      'fetch("/__mock/settings")',
      'const origin="http://127.0.0.1:8790"',
      'origin:"http://localhost:8790"',
      'keys:[{kid:"mock-1a2b3c4d-p1"}]',
    ];
    assert.equal(traces.length, FORBIDDEN.length + 1);
    for (const trace of traces) {
      await writeFile(join(dir, 'assets', 'leak.js'), trace);
      assert.equal((await scanBuild(dir)).length, 1, trace);
    }
    const coordinate = 'x'.repeat(43);
    await writeFile(join(dir, 'assets', 'leak.js'), `const k={x:"${coordinate}"}`);
    assert.equal((await scanBuild(dir, { coordinates: [coordinate] })).length, 1);
    await rm(join(dir, 'assets', 'leak.js'));
    const cli = spawnSync(process.execPath, [join(import.meta.dirname, '..', 'scan-build.mjs'), dir], {
      encoding: 'utf8',
    });
    assert.equal(cli.status, 0, cli.stdout);
  });

  test('no source file of the extension or a package mentions the mock backend', async () => {
    const hits = [];
    async function walk(dir) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (['node_modules', 'dist', '.turbo', 'pkg'].includes(entry.name)) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) await walk(path);
        else if (/\.(m?[jt]sx?|json|html|css)$/.test(entry.name)) {
          const text = await readFile(path, 'utf8');
          if (/mock-backend|DEVTAB_MOCK_BACKEND|\/__mock\//.test(text)) hits.push(relative(ROOT, path));
        }
      }
    }
    await walk(join(ROOT, 'extension'));
    await walk(join(ROOT, 'packages'));
    assert.deepEqual(hits, []);
  });
});
