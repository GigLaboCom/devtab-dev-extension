// The licence endpoints in every licence scenario: status, body shape, the signed token's fields, CORS.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { ANSWER_HEADERS, DAY, answerProblems, claimsCheck, errorProblems, issueProblems } from '../contract.mjs';
import { verifyToken } from '../jws.mjs';
import { publicEntries } from '../keys.mjs';
import { LICENCE_SCENARIOS, licenceScenario } from '../scenarios.mjs';
import { activate, mock, newInst, post, request } from './helpers.mjs';

let m;
let keys;
before(async () => {
  m = await mock();
  keys = publicEntries(m.keys);
});
after(() => m.close());

const now = () => Math.floor(m.clock.ms / 1000);
const EXTENSION = `chrome-extension://${'a'.repeat(32)}`;

/** The token of a 200 answer, verified with the mock's public keys and held to the server's rules. */
async function tokenOf(answer) {
  const result = await verifyToken(answer.json.token, keys);
  assert.equal(result.ok, true, `token: ${result.reason} ${result.problems}`);
  assert.deepEqual(claimsCheck(result.claims, { strict: true }).problems, []);
  assert.deepEqual(issueProblems(result.claims), []);
  return result;
}

function assertHeaders(answer) {
  for (const [name, value] of Object.entries(ANSWER_HEADERS)) assert.equal(answer.headers[name], value, name);
}

/** What each scenario's activation answers. */
const activationError = s => s.error ?? s.activation ?? (s.seatsTaken || s.churnUsed ? 'seat-limit' : undefined);

describe('activation and refresh, scenario by scenario', () => {
  for (const scenario of LICENCE_SCENARIOS) {
    test(scenario.name, async () => {
      const answer = await activate(m.url, scenario.key);
      assertHeaders(answer);
      const error = activationError(scenario);
      if (error) {
        assert.deepEqual(errorProblems('activate', answer.status, answer.json), []);
        assert.equal(answer.json.error, error);
        if (error === 'rate-limited') assert.equal(answer.headers['retry-after'], '120');
        return;
      }
      assert.deepEqual(answerProblems('activate', answer.status, answer.json), []);
      const granted = await tokenOf(answer);
      const { claims } = granted;
      const grant = scenario.grant;
      assert.equal(claims.inst, answer.inst);
      assert.equal(claims.status, grant.status);
      assert.equal(claims.term, grant.term);
      if (grant.term) assert.equal(claims.renews, grant.renews);
      assert.equal(claims.iat, now() - (scenario.backdate ?? 0));
      assert.equal(claims.paid, grant.paidIn === null ? null : now() + grant.paidIn);
      assert.equal(granted.kid, m.keys.signing[scenario.signWith ?? 'p1'].kid);

      const refreshed = await post(m.url, '/v1/refresh', {
        lid: claims.lid,
        inst: answer.inst,
        secret: answer.json.secret,
      });
      assertHeaders(refreshed);
      assert.deepEqual(answerProblems('refresh', refreshed.status, refreshed.json), []);
      const later = (await tokenOf(refreshed)).claims;
      const check = scenario.check ?? grant;
      assert.equal(later.status, check.status);
      assert.equal(later.reason, check.reason);
      assert.equal(later.lid, claims.lid);
    });
  }

  test('the expected states: grace, expired, cancelled — as the extension will compute them', async () => {
    const at = now();
    const last = (await tokenOf(await activate(m.url, licenceScenario('last-days').key))).claims;
    assert.ok(last.warn <= at && at < last.exp, 'last-days: t within warn … exp');
    const expired = (await tokenOf(await activate(m.url, licenceScenario('expired').key))).claims;
    assert.ok(expired.exp <= at, 'expired: exp passed');
    const cancelled = (await tokenOf(await activate(m.url, licenceScenario('cancelled').key))).claims;
    assert.equal(cancelled.renews, false);
    assert.equal(cancelled.exp, cancelled.paid + 14 * DAY);
    const comp = (await tokenOf(await activate(m.url, licenceScenario('complimentary').key))).claims;
    assert.ok(comp.paid === null && !('term' in comp) && !('renews' in comp));
  });
});

describe('the rules around activation', () => {
  test('any well-formed key not listed, and a key of another format, are key-unknown', async () => {
    for (const key of ['DTD-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ', 'MOCK-NOT-A-LICENCE-KEY']) {
      const answer = await activate(m.url, key);
      assert.equal(answer.status, 404);
      assert.equal(answer.json.error, 'key-unknown');
    }
  });

  test('the key is matched in its canonical form: lower case and O for 0 open the same licence', async () => {
    const a = await activate(m.url, 'dtd-mock-actv-mnth-oooo-oooo');
    assert.equal(a.status, 200);
  });

  test('repeating an activation keeps the seat, gives a new secret, and the old one stops working', async () => {
    const key = 'DTD-MOCK-ACTV-YEAR-0000-0000';
    const inst = newInst();
    const first = await activate(m.url, key, inst);
    const second = await activate(m.url, key, inst);
    assert.equal(second.status, 200);
    assert.notEqual(first.json.secret, second.json.secret);
    const { lid } = (await tokenOf(second)).claims;
    assert.equal((await tokenOf(first)).claims.lid, lid);
    const old = await post(m.url, '/v1/refresh', { lid, inst, secret: first.json.secret });
    const r = (await tokenOf(old)).claims;
    assert.equal(r.status, 'revoked');
    assert.equal(r.reason, 'unknown-installation');
    assert.equal(r.inst, inst);
  });

  test('the seat limit: a fourth installation is seat-limit; deactivating one frees a seat', async () => {
    const fresh = await mock();
    try {
      const key = 'DTD-MOCK-CNCL-0000-0000-0000';
      const done = [];
      for (let i = 0; i < 3; i++) done.push(await activate(fresh.url, key));
      assert.ok(done.every(d => d.status === 200));
      const fourth = await activate(fresh.url, key);
      assert.equal(fourth.status, 409);
      assert.equal(fourth.json.error, 'seat-limit');
      const { lid } = (await verifyToken(done[0].json.token, publicEntries(fresh.keys))).claims;
      const off = await post(fresh.url, '/v1/deactivate', { lid, inst: done[0].inst, secret: done[0].json.secret });
      assert.equal(off.status, 204);
      assert.equal(off.text, '');
      assert.equal((await activate(fresh.url, key, fourth.inst)).status, 200);
      // After a deactivation, that installation's refresh is a signed revoked: deactivated.
      const back = await post(fresh.url, '/v1/refresh', { lid, inst: done[0].inst, secret: done[0].json.secret });
      const claims = (await verifyToken(back.json.token, publicEntries(fresh.keys))).claims;
      assert.equal(claims.reason, 'deactivated');
    } finally {
      await fresh.close();
    }
  });

  test('the 30-day activation limit (А6): deactivate and re-activate until 3 × seats new activations', async () => {
    const fresh = await mock({ seats: 1 });
    try {
      const key = 'DTD-MOCK-ACTV-MNTH-0000-0000';
      const k = publicEntries(fresh.keys);
      for (let i = 0; i < 3; i++) {
        const a = await activate(fresh.url, key);
        assert.equal(a.status, 200, `activation ${i + 1}`);
        const { lid } = (await verifyToken(a.json.token, k)).claims;
        await post(fresh.url, '/v1/deactivate', { lid, inst: a.inst, secret: a.json.secret });
      }
      assert.equal((await activate(fresh.url, key)).json.error, 'seat-limit');
      fresh.clock.ms += 31 * DAY * 1000;
      assert.equal((await activate(fresh.url, key)).status, 200, 'a month later');
    } finally {
      await fresh.close();
    }
  });

  test('refresh of an unknown licence is a signed revoked: unknown-installation with the request’s lid and inst', async () => {
    const inst = newInst();
    const answer = await post(m.url, '/v1/refresh', { lid: 'lic_nobody_000000', inst, secret: 'S'.repeat(43) });
    const { claims } = await tokenOf(answer);
    assert.deepEqual(
      [claims.status, claims.reason, claims.lid, claims.inst],
      ['revoked', 'unknown-installation', 'lic_nobody_000000', inst],
    );
  });

  test('deactivate answers 204 for anything well-formed; with deactivate: token, 200 with a signed revoked', async () => {
    const body = { lid: 'lic_nobody_000000', inst: newInst(), secret: 'S'.repeat(43) };
    const empty = await post(m.url, '/v1/deactivate', body);
    assert.deepEqual(answerProblems('deactivate', empty.status, empty.text), []);
    await post(m.url, '/__mock/settings', { deactivate: 'token' });
    try {
      const withToken = await post(m.url, '/v1/deactivate', body);
      assert.deepEqual(answerProblems('deactivate', withToken.status, withToken.json), []);
      assert.equal((await tokenOf(withToken)).claims.reason, 'deactivated');
    } finally {
      await post(m.url, '/__mock/settings', { deactivate: 'empty' });
    }
  });
});

describe('malformed requests', () => {
  const inst = newInst();
  const key = 'DTD-MOCK-ACTV-MNTH-0000-0000';
  const cases = [
    ['not JSON', '{"key":', { 'content-type': 'application/json' }],
    ['no content type', JSON.stringify({ key, inst }), { 'content-type': 'text/plain' }],
    ['an extra field', { key, inst, email: 'person@example.invalid' }],
    ['a missing field', { key }],
    ['a short installation number', { key, inst: 'abc' }],
    ['a key with spaces', { key: 'DTD MOCK ACTV MNTH 0000 0000', inst }],
    ['an array', [key, inst]],
  ];
  for (const [name, body, headers = {}] of cases)
    test(`activate with ${name}: 400 bad-request`, async () => {
      const answer = await post(m.url, '/v1/activate', body, headers);
      assert.equal(answer.status, 400);
      assert.deepEqual(errorProblems('activate', 400, answer.json), []);
    });

  test('refresh and deactivate with a broken body: 400 bad-request', async () => {
    for (const path of ['/v1/refresh', '/v1/deactivate']) {
      const answer = await post(m.url, path, { lid: 'lic_x', inst });
      assert.equal(answer.status, 400);
      assert.equal(answer.json.error, 'bad-request');
    }
  });

  test('a body over 4 KB: 413 payload-too-large', async () => {
    const answer = await post(m.url, '/v1/activate', { key: 'K'.repeat(5000), inst });
    assert.equal(answer.status, 413);
    assert.deepEqual(errorProblems('activate', 413, answer.json), []);
  });

  test('a wrong method: 405 with Allow; an unknown path: 404', async () => {
    const get = await request(m.url, { path: '/v1/activate' });
    assert.equal(get.status, 405);
    assert.equal(get.headers.allow, 'POST, OPTIONS');
    assert.equal((await request(m.url, { path: '/v1/nothing' })).status, 404);
  });
});

describe('CORS of the licence endpoints', () => {
  test('preflight from an extension: the exact origin, GET, POST, Content-Type, a day, Vary, no credentials', async () => {
    const answer = await request(m.url, {
      method: 'OPTIONS',
      path: '/v1/activate',
      headers: {
        origin: EXTENSION,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    assert.equal(answer.status, 204);
    assert.equal(answer.headers['access-control-allow-origin'], EXTENSION);
    assert.equal(answer.headers['access-control-allow-methods'], 'GET, POST');
    assert.equal(answer.headers['access-control-allow-headers'], 'Content-Type');
    assert.equal(answer.headers['access-control-max-age'], '86400');
    assert.equal(answer.headers.vary, 'Origin');
    assert.equal(answer.headers['access-control-allow-credentials'], undefined);
  });

  test('the POST itself carries the same origin; an error answer too', async () => {
    const ok = await post(
      m.url,
      '/v1/activate',
      { key: 'DTD-MOCK-ACTV-MNTH-0000-0000', inst: newInst() },
      { origin: EXTENSION },
    );
    assert.equal(ok.headers['access-control-allow-origin'], EXTENSION);
    const no = await post(
      m.url,
      '/v1/activate',
      { key: 'DTD-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ', inst: newInst() },
      { origin: EXTENSION },
    );
    assert.equal(no.status, 404);
    assert.equal(no.headers['access-control-allow-origin'], EXTENSION);
  });

  test('a web page’s origin gets no CORS headers, but the request is still answered', async () => {
    const key = 'DTD-TEST-AAAA-BBBB-CCCC-DDDD';
    const answer = await post(
      m.url,
      '/v1/activate',
      { key, inst: newInst() },
      { origin: 'https://site.example.invalid' },
    );
    assert.equal(answer.status, 200);
    assert.equal(answer.headers['access-control-allow-origin'], undefined);
    assert.equal(answer.headers.vary, 'Origin');
  });

  test('with extension origins set, only those are allowed', async () => {
    const mine = `chrome-extension://${'b'.repeat(32)}`;
    await post(m.url, '/__mock/settings', { extensionOrigins: [mine] });
    try {
      const other = await request(m.url, { method: 'OPTIONS', path: '/v1/refresh', headers: { origin: EXTENSION } });
      assert.equal(other.headers['access-control-allow-origin'], undefined);
      const allowed = await request(m.url, { method: 'OPTIONS', path: '/v1/refresh', headers: { origin: mine } });
      assert.equal(allowed.headers['access-control-allow-origin'], mine);
    } finally {
      await post(m.url, '/__mock/settings', { extensionOrigins: [] });
    }
  });
});
