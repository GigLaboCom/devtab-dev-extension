// The shapes themselves: requests, the issuing rules, the plans catalog and every scenario's catalog.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  DAY,
  canonicalKey,
  catalogCheck,
  claimsCheck,
  issueClaims,
  issueProblems,
  requestProblems,
} from '../contract.mjs';
import { LICENCE_SCENARIOS, PAY_HOSTS, PLANS_SCENARIOS, plansScenario } from '../scenarios.mjs';

const inst = 'q3V2mZ0bTEST0000000000';
const lid = 'lic_01JD5QX7Y2Z9TEST';
const secret = 'A'.repeat(43);
const iat = 1_795_392_000;

describe('requests', () => {
  test('exactly the named fields, each by its rule', () => {
    assert.deepEqual(requestProblems('activate', { key: 'DTD-TEST-AAAA-BBBB-CCCC-DDDD', inst }), []);
    assert.deepEqual(requestProblems('refresh', { lid, inst, secret }), []);
    assert.deepEqual(requestProblems('deactivate', { lid, inst, secret }), []);
    for (const body of [
      { key: 'DTD-TEST-AAAA-BBBB-CCCC-DDDD' },
      { key: 'DTD-TEST-AAAA-BBBB-CCCC-DDDD', inst, extra: 1 },
      { key: 'short', inst },
      { key: 'DTD TEST AAAA BBBB CCCC DDDD', inst },
      { key: 'DTD-TEST-AAAA-BBBB-CCCC-DDDD', inst: `${inst}=` },
      [],
      null,
    ])
      assert.notDeepEqual(requestProblems('activate', body), [], JSON.stringify(body));
    assert.notDeepEqual(requestProblems('refresh', { lid, inst, secret: 'short' }), []);
    assert.notDeepEqual(requestProblems('refresh', { lid: 'lic', inst, secret }), []);
  });

  test('the server’s canonical key (backend.md §5.2)', () => {
    assert.equal(canonicalKey('dtd-test-aaaa-bbbb-cccc-dddd'), 'DTDTESTAAAABBBBCCCCDDDD');
    assert.equal(canonicalKey('DTD-MOCK-ACTV-MNTH-0000-0000'), 'DTDM0CKACTVMNTH00000000');
    assert.equal(canonicalKey('DTD-I1L1-0000-0000-0000-0000'), 'DTD11110000000000000000');
    assert.equal(canonicalKey('DTD-UUUU-0000-0000-0000-0000'), undefined);
    assert.equal(canonicalKey('MOCK-NOT-A-LICENCE-KEY'), undefined);
  });

  test('every scenario key is a canonical key, and no two scenarios share one', () => {
    const seen = new Set();
    for (const s of LICENCE_SCENARIOS)
      for (const key of [s.key, ...(s.aliases ?? [])]) {
        const c = canonicalKey(key);
        assert.ok(c, `${s.name}: ${key}`);
        assert.ok(!seen.has(c), `${key} twice`);
        seen.add(c);
      }
  });
});

describe('issuing rules (backend.md §6.2.5)', () => {
  const licences = {
    'active monthly': { status: 'active', term: 'month', renews: true, paid: iat + 30 * DAY },
    'active annual': { status: 'active', term: 'year', renews: true, paid: iat + 365 * DAY },
    'cancelled, 2 days left': { status: 'active', term: 'month', renews: false, paid: iat + 2 * DAY },
    'payment retries, paid 10 days ago': { status: 'active', term: 'month', renews: true, paid: iat - 10 * DAY },
    complimentary: { status: 'active', paid: null },
    'complimentary until a date': { status: 'active', paid: iat + 3 * DAY },
    ended: { status: 'ended', term: 'month', paid: iat - DAY },
    ...Object.fromEntries(
      ['refund', 'deactivated', 'key-blocked', 'seat-limit', 'unknown-installation'].map(reason => [
        `revoked ${reason}`,
        { status: 'revoked', reason, paid: null },
      ]),
    ),
  };
  for (const [name, licence] of Object.entries(licences))
    test(`${name}: valid fields, the server’s spans`, () => {
      const claims = issueClaims({ lid, inst, iat, licence });
      assert.deepEqual(claimsCheck(claims, { strict: true }).problems, []);
      assert.deepEqual(issueProblems(claims), []);
    });

  test('the spans of an ordinary month: 7 / 23 / 30 days', () => {
    const c = issueClaims({ lid, inst, iat, licence: licences['active monthly'] });
    assert.deepEqual([c.chk - iat, c.warn - iat, c.exp - iat], [7 * DAY, 23 * DAY, 30 * DAY]);
    assert.equal(c.term, 'month');
    assert.equal(c.renews, true);
  });

  test('ended carries term and renews: false; revoked carries neither (Б6)', () => {
    const ended = issueClaims({ lid, inst, iat, licence: licences.ended });
    assert.equal(ended.term, 'month');
    assert.equal(ended.renews, false);
    const revoked = issueClaims({ lid, inst, iat, licence: licences['revoked refund'] });
    assert.ok(!('term' in revoked) && !('renews' in revoked));
  });
});

describe('the plans catalog', () => {
  const now = 1_795_392_000;
  const check = name => catalogCheck(plansScenario(name).body(now), { payHosts: PAY_HOSTS, now });

  test('three: every plan valid, nothing for the server to fix', () => {
    const result = check('three');
    assert.equal(result.ok, true);
    assert.deepEqual(result.kept, ['free', 'pro-monthly', 'pro-annual']);
    assert.deepEqual(result.problems, []);
  });

  const expected = {
    withdrawn: { ok: true, kept: ['free', 'pro-monthly'], dropped: [] },
    'extra-unknown': { ok: true, kept: ['free', 'pro-monthly', 'pro-annual'], dropped: ['kind'] },
    empty: { ok: false, why: 'empty' },
    'bad-pay-host': { ok: true, kept: ['free', 'pro-monthly'], dropped: ['url'] },
    'stale-max-age': { ok: true, kept: ['free', 'pro-monthly', 'pro-annual'], dropped: [], maxAge: 3600 },
    unsupported: { ok: false, why: 'unsupported' },
    'offer-ended': { ok: true, kept: ['free', 'pro-monthly', 'pro-annual'], dropped: [] },
  };
  for (const [name, want] of Object.entries(expected))
    test(`${name}: what the extension keeps and drops`, () => {
      const result = check(name);
      assert.equal(result.ok, want.ok);
      if (want.why) assert.equal(result.why, want.why);
      if (want.kept) assert.deepEqual(result.kept, want.kept);
      if (want.dropped)
        assert.deepEqual(
          result.dropped.map(d => d.why),
          want.dropped,
        );
      if (want.maxAge) assert.equal(result.maxAge, want.maxAge);
    });

  test('every plans scenario but rate-limited has a body; rate-limited has none', () => {
    for (const s of PLANS_SCENARIOS) assert.equal(typeof s.body === 'function', s.name !== 'rate-limited', s.name);
  });

  test('plan rules: text, price, currency, address, duplicates, count', () => {
    const base = plansScenario('three').body(now);
    const monthly = base.plans[1];
    const one = plan =>
      catalogCheck({ ...base, plans: [base.plans[0], plan] }, { payHosts: PAY_HOSTS }).dropped[0]?.why;
    assert.equal(one({ ...monthly, name: 'x'.repeat(33) }), 'text');
    assert.equal(one({ ...monthly, name: 'x'.repeat(32) }), undefined);
    assert.equal(one({ ...monthly, name: 'Month\u{202e}ly' }), 'text');
    assert.equal(one({ ...monthly, includes: ['a\u{7}'] }), 'text');
    assert.equal(one({ ...monthly, price: { amount: 11.5, currency: 'XTS' } }), 'price');
    assert.equal(one({ ...monthly, price: { amount: -1, currency: 'XTS' } }), 'price');
    assert.equal(one({ ...monthly, price: { amount: 1, currency: 'ABC' } }), 'currency');
    assert.equal(one({ ...monthly, price: { amount: 1, currency: 'usd' } }), 'currency');
    assert.equal(one({ ...monthly, price: { amount: 1, currency: 'USD' } }), undefined);
    for (const url of [
      'http://web.example.invalid/x',
      'https://web.example.invalid:8443/x',
      'https://u:p@web.example.invalid/x',
      'https://sub.web.example.invalid/x',
      `https://web.example.invalid/${'x'.repeat(300)}`,
    ])
      assert.equal(one({ ...monthly, checkoutUrl: url }), 'url', url);
    assert.equal(one({ ...monthly, term: 'week' }), 'term');
    assert.equal(one({ ...base.plans[0] }), 'duplicate');
    assert.equal(catalogCheck({ ...base, plans: Array(7).fill(monthly) }, { payHosts: PAY_HOSTS }).why, 'shape');
    const noManage = catalogCheck({ ...base, manageUrl: 'https://elsewhere.invalid/' }, { payHosts: PAY_HOSTS });
    assert.equal(noManage.manageUrl, null);
  });
});
