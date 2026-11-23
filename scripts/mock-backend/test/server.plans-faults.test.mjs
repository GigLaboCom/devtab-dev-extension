// The plans endpoint in every plans scenario, the faults, the clock, the keys, the control address and the guards.
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { LIMITS, catalogCheck, errorProblems } from '../contract.mjs';
import { decodeToken, verifyToken } from '../jws.mjs';
import { publicEntries } from '../keys.mjs';
import { FAULTS, PAY_HOSTS, PLANS_SCENARIOS } from '../scenarios.mjs';
import { activate, mock, newInst, post, request } from './helpers.mjs';

let m;
before(async () => {
  m = await mock();
});
after(() => m.close());
beforeEach(() => post(m.url, '/__mock/reset'));

const settings = partial => post(m.url, '/__mock/settings', partial);
const plans = (headers = {}) => request(m.url, { path: '/v1/plans', headers });
const KEY = 'DTD-MOCK-ACTV-MNTH-0000-0000';

describe('GET /v1/plans', () => {
  for (const scenario of PLANS_SCENARIOS)
    test(`${scenario.name}: the answer matches its catalog, switched without a restart`, async () => {
      await settings({ plans: scenario.name });
      const answer = await plans({ origin: `chrome-extension://${'a'.repeat(32)}` });
      assert.equal(answer.headers['access-control-allow-origin'], '*');
      assert.equal(answer.headers['access-control-allow-credentials'], undefined);
      assert.equal(answer.headers['content-type'], 'application/json');
      if (scenario.error) {
        assert.equal(answer.status, 429);
        assert.deepEqual(errorProblems('plans', 429, answer.json), []);
        assert.equal(answer.headers['retry-after'], '120');
        return;
      }
      assert.equal(answer.status, 200);
      assert.deepEqual(answer.json, scenario.body(Math.floor(m.clock.ms / 1000)));
      assert.ok(Buffer.byteLength(answer.text) <= LIMITS.plansAnswerBytes);
      assert.match(answer.headers['cache-control'], /^public, max-age=\d+$/);
      assert.ok(answer.headers.etag);
    });

  test('three, read as the extension would: three plans, prices in XTS', async () => {
    const answer = await plans();
    const read = catalogCheck(answer.json, { payHosts: PAY_HOSTS });
    assert.deepEqual(read.kept, ['free', 'pro-monthly', 'pro-annual']);
    assert.deepEqual(
      answer.json.plans.slice(1).map(p => p.price),
      [
        { amount: 1111, currency: 'XTS' },
        { amount: 11110, currency: 'XTS' },
      ],
    );
  });

  test('If-None-Match with the ETag: 304 without a body; maxAge can be replaced', async () => {
    const first = await plans();
    const again = await plans({ 'if-none-match': first.headers.etag });
    assert.equal(again.status, 304);
    assert.equal(again.text, '');
    await settings({ maxAge: 7200 });
    const changed = await plans();
    assert.equal(changed.json.maxAge, 7200);
    assert.equal(changed.headers['cache-control'], 'public, max-age=7200');
    assert.notEqual(changed.headers.etag, first.headers.etag);
  });

  test('a preflight (not needed for a simple GET) answers *', async () => {
    const answer = await request(m.url, {
      method: 'OPTIONS',
      path: '/v1/plans',
      headers: { origin: 'https://x.invalid' },
    });
    assert.equal(answer.status, 204);
    assert.equal(answer.headers['access-control-allow-origin'], '*');
  });

  test('a POST is 405', async () => {
    assert.equal((await post(m.url, '/v1/plans', {})).status, 405);
  });
});

describe('faults, switched without a restart', () => {
  const statuses = { 'http-500': 500, 'http-503': 503, portal: 200, redirect: 302, 'too-large': 200 };
  for (const [name, status] of Object.entries(statuses))
    test(`${name}: on plans and on activation`, async () => {
      await settings({ fault: name });
      for (const answer of [await plans(), await activate(m.url, KEY)]) {
        assert.equal(answer.status, status);
        if (name === 'portal') assert.match(answer.headers['content-type'], /^text\/html/);
        if (name === 'redirect') assert.equal(answer.headers.location, 'https://portal.example.invalid/login');
        if (name === 'http-503') assert.equal(answer.json.error, 'unavailable');
        if (name === 'too-large') assert.ok(answer.json.pad);
      }
      const big = await plans();
      if (name === 'too-large') assert.equal(Buffer.byteLength(big.text), LIMITS.plansAnswerBytes + 1);
      await settings({ fault: 'none' });
      assert.equal((await plans()).status, 200, 'back to normal');
    });

  test('too-large on a licence endpoint: one byte over 16 KB', async () => {
    await settings({ fault: 'too-large' });
    const answer = await activate(m.url, KEY);
    assert.equal(Buffer.byteLength(answer.text), LIMITS.licenceAnswerBytes + 1);
  });

  test('drop: the connection closes without an answer', async () => {
    await settings({ fault: 'drop' });
    await assert.rejects(plans(), /socket hang up|ECONNRESET/);
  });

  test('timeout: no answer at all', async () => {
    await settings({ fault: 'timeout' });
    await assert.rejects(request(m.url, { path: '/v1/plans', timeoutMs: 300 }), /timeout/);
  });

  test('slow: the answer after the delay', async () => {
    await settings({ fault: 'slow', delayMs: 400 });
    const began = Date.now();
    assert.equal((await plans()).status, 200);
    assert.ok(Date.now() - began >= 380, `${Date.now() - began} ms`);
  });

  test('faultOn limits a fault to some endpoints', async () => {
    await settings({ fault: 'http-500', faultOn: ['refresh'] });
    assert.equal((await plans()).status, 200);
    assert.equal((await activate(m.url, KEY)).status, 200);
  });

  test('bad-signature: the token fails its signature', async () => {
    await settings({ fault: 'bad-signature' });
    const answer = await activate(m.url, KEY);
    assert.equal((await verifyToken(answer.json.token, publicEntries(m.keys))).reason, 'signature');
  });

  test('unknown-kid: signed by a key no build knows', async () => {
    await settings({ fault: 'unknown-kid' });
    const answer = await activate(m.url, KEY);
    const result = await verifyToken(answer.json.token, publicEntries(m.keys));
    assert.equal(result.reason, 'unknown-key');
    assert.equal(decodeToken(answer.json.token).header.kid, m.keys.unknown.kid);
  });

  test('replay: after a later token, the oldest one comes back', async () => {
    const a = await activate(m.url, KEY);
    const { lid } = decodeToken(a.json.token).claims;
    const body = { lid, inst: a.inst, secret: a.json.secret };
    m.clock.ms += 3_600_000;
    const newer = await post(m.url, '/v1/refresh', body);
    await settings({ fault: 'replay' });
    const replayed = await post(m.url, '/v1/refresh', body);
    assert.equal(replayed.json.token, a.json.token);
    assert.ok(decodeToken(replayed.json.token).claims.iat < decodeToken(newer.json.token).claims.iat);
    m.clock.ms -= 3_600_000;
  });

  test('every fault has a name, a summary and an expectation', () => {
    for (const f of FAULTS) assert.ok(f.name && f.summary && f.expect, f.name);
  });
});

describe('the clock and the keys', () => {
  test('clockOffset: tokens from the future and from the past', async () => {
    const real = Math.floor(m.clock.ms / 1000);
    await settings({ clockOffset: 3 * 86_400 });
    const ahead = decodeToken((await activate(m.url, KEY)).json.token).claims;
    assert.equal(ahead.iat, real + 3 * 86_400);
    await settings({ clockOffset: -40 * 86_400 });
    const behind = decodeToken((await activate(m.url, KEY)).json.token).claims;
    assert.equal(behind.iat, real - 40 * 86_400);
    assert.ok(behind.exp < real, 'a token from 40 days ago is already past its window');
  });

  test('signingKey p2: the standby key signs; both public keys verify', async () => {
    await settings({ signingKey: 'p2' });
    const answer = await activate(m.url, KEY);
    const result = await verifyToken(answer.json.token, publicEntries(m.keys));
    assert.equal(result.ok, true);
    assert.equal(result.kid, m.keys.signing.p2.kid);
    assert.equal((await verifyToken(answer.json.token, [m.keys.signing.p1.publicEntry])).reason, 'unknown-key');
  });

  test('GET /__mock/public-keys: both entries, in the shape of LicenceConfig.keys', async () => {
    const answer = await request(m.url, { path: '/__mock/public-keys' });
    assert.deepEqual(answer.json, publicEntries(m.keys));
    for (const e of answer.json) {
      assert.match(e.kid, /^mock-[0-9a-f]{8}-p[12]$/);
      assert.deepEqual(Object.keys(e.jwk).sort(), ['crv', 'kty', 'x', 'y']);
      assert.equal(e.jwk.x.length, 43);
    }
  });
});

describe('the control address and the guards', () => {
  test('settings change behaviour at once; reset brings back the start and forgets licences', async () => {
    await settings({ licence: 'revoked-refund' });
    assert.equal((await activate(m.url, KEY)).json.error, 'licence-inactive');
    await post(m.url, '/__mock/reset');
    const ok = await activate(m.url, KEY);
    assert.equal(ok.status, 200);
    assert.equal((await request(m.url, { path: '/__mock/' })).json.licences.length, 1);
    await post(m.url, '/__mock/reset');
    assert.equal((await request(m.url, { path: '/__mock/' })).json.licences.length, 0);
  });

  test('a licence override after activation: the next refresh signs that scenario', async () => {
    const a = await activate(m.url, KEY);
    const { lid } = decodeToken(a.json.token).claims;
    await settings({ licence: 'ended' });
    const ended = await post(m.url, '/v1/refresh', { lid, inst: a.inst, secret: a.json.secret });
    const claims = decodeToken(ended.json.token).claims;
    assert.deepEqual([claims.status, claims.term, claims.renews], ['ended', 'month', false]);
  });

  test('bad settings are refused with the reason', async () => {
    for (const body of [{ fault: 'meteor' }, { seats: 0 }, { colour: 'red' }, { licence: 'nope' }]) {
      const answer = await settings(body);
      assert.equal(answer.status, 400, JSON.stringify(body));
      assert.equal(answer.json.error, 'mock-settings');
    }
    assert.equal((await post(m.url, '/__mock/settings', 'fault=drop', { 'content-type': 'text/plain' })).status, 400);
  });

  test('the control address refuses browser requests (an Origin header)', async () => {
    const answer = await post(m.url, '/__mock/settings', { fault: 'drop' }, { origin: 'https://site.example.invalid' });
    assert.equal(answer.status, 403);
    assert.equal(m.settings().fault, 'none');
  });

  test('a Host other than the loopback address is refused (DNS rebinding)', async () => {
    const answer = await request(m.url, { path: '/v1/plans', headers: { host: 'licence.example.invalid' } });
    assert.equal(answer.status, 403);
    assert.equal(answer.json.error, 'mock-host');
  });

  test('the scenario list names every scenario with its key and expectation', async () => {
    const list = (await request(m.url, { path: '/__mock/scenarios' })).json;
    assert.ok(list.licence.length >= 18);
    for (const s of list.licence) assert.ok(s.name && s.key && s.summary && s.expect, s.name);
    assert.equal(list.plans.length, PLANS_SCENARIOS.length);
  });

  test('one log line per request: method, path, scenario, status — never a key or a secret', async () => {
    const a = await activate(m.url, KEY, newInst());
    const line = m.lines.at(-1);
    assert.match(line, /POST \/v1\/activate licence=active-monthly 200 \d+ms$/);
    assert.ok(!m.lines.some(l => l.includes('MOCK-ACTV') || l.includes(a.json.secret)));
  });
});
