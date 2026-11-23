// The shapes themselves: requests, the issuing rules, the plans catalog and every scenario's catalog.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  DAY,
  TEST_CURRENCY,
  canonicalKey,
  catalogCheck,
  claimsCheck,
  errorProblems,
  issueClaims,
  issueProblems,
  realCurrencies,
  requestProblems,
  testCurrencies,
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

describe('issuing rules: the table of cases (pro-entitlement-implementation.md §5.1)', () => {
  const D = DAY;
  const month = (paidDays, renews = true) => ({ status: 'active', term: 'month', renews, paid: iat + paidDays * D });
  /** [case, licence, the expected status and chk, warn, exp in days from iat] — the rows of the table. */
  const cases = [
    ['1. monthly, paid 30 days ahead', month(30), ['active', 7, 23, 30]],
    ['2. annual, paid 365 days ahead', { ...month(365), term: 'year' }, ['active', 7, 23, 30]],
    ['3. cancelled, paid 20 days ahead', month(20, false), ['active', 7, 23, 30]],
    ['4. paid 10 days ahead', month(10), ['active', 7, 17, 24]],
    ['5. paid until today', month(0), ['active', 7, 7, 14]],
    ['6. payment 3 days overdue', month(-3), ['active', 7, 7, 11]],
    ['7. payment 8 days overdue', month(-8), ['active', 6, 6, 6]],
    ['8. payment 13.5 days overdue', month(-13.5), ['active', 0.5, 0.5, 0.5]],
    ['9. payment exactly 14 days overdue', month(-14), ['ended', 7, 0, 0]],
    ['10. payment 20 days overdue', month(-20), ['ended', 7, 0, 0]],
    ['11. complimentary without an end', { status: 'active', paid: null }, ['active', 7, 23, 30]],
    ['12. complimentary until in 3 days', { status: 'active', paid: iat + 3 * D }, ['active', 3, 3, 3]],
    ['13. complimentary until in 40 days', { status: 'active', paid: iat + 40 * D }, ['active', 7, 23, 30]],
    ['14. complimentary, ended yesterday', { status: 'active', paid: iat - D }, ['ended', 7, 0, 0]],
    ['15. ended', { status: 'ended', term: 'month', paid: iat - D }, ['ended', 7, 0, 0]],
    ...['refund', 'deactivated', 'key-blocked', 'seat-limit', 'unknown-installation'].map(reason => [
      `16. revoked ${reason}`,
      { status: 'revoked', reason, paid: null },
      ['revoked', 0, 0, 0],
    ]),
  ];
  for (const [name, licence, [status, chk, warn, exp]] of cases)
    test(`${name}: ${status}, ${chk} / ${warn} / ${exp}; the client's order holds`, () => {
      const c = issueClaims({ lid, inst, iat, licence });
      assert.equal(c.status, status);
      assert.deepEqual([c.chk - iat, c.warn - iat, c.exp - iat], [chk * D, warn * D, exp * D]);
      assert.deepEqual(claimsCheck(c, { strict: true }).problems, []);
      assert.deepEqual(issueProblems(c), []);
      if (c.status === 'active') assert.ok(c.iat < c.chk && c.chk <= c.warn && c.warn <= c.exp);
      else assert.ok(c.warn === c.iat && c.exp === c.iat && c.iat <= c.chk);
    });

  test('ended carries term and renews: false; revoked carries neither; the grace-over case too (Б6)', () => {
    const ended = issueClaims({ lid, inst, iat, licence: { status: 'ended', term: 'month', paid: iat - DAY } });
    assert.deepEqual([ended.term, ended.renews], ['month', false]);
    const over = issueClaims({ lid, inst, iat, licence: month(-20) });
    assert.deepEqual([over.status, over.term, over.renews, over.paid], ['ended', 'month', false, iat - 20 * DAY]);
    const revoked = issueClaims({ lid, inst, iat, licence: { status: 'revoked', reason: 'refund', paid: null } });
    assert.ok(!('term' in revoked) && !('renews' in revoked));
  });

  test('an active token past the payment’s grace is a server error the rules catch', () => {
    const wrong = { ...issueClaims({ lid, inst, iat, licence: month(5) }), paid: iat - 14 * DAY };
    assert.ok(issueProblems(wrong).some(p => p.includes('must be ended')));
  });
});

describe('error bodies (§5.1)', () => {
  test('429 is rate-limited, 503 is unavailable, and never the other way round', () => {
    assert.deepEqual(errorProblems('refresh', 429, { error: 'rate-limited', message: 'x' }), []);
    assert.deepEqual(errorProblems('refresh', 503, { error: 'unavailable' }), []);
    assert.notDeepEqual(errorProblems('refresh', 503, { error: 'rate-limited' }), []);
    assert.notDeepEqual(errorProblems('refresh', 429, { error: 'unavailable' }), []);
    assert.deepEqual(errorProblems('activate', 403, { error: 'licence-inactive' }), []);
    assert.notDeepEqual(errorProblems('refresh', 403, { error: 'licence-inactive' }), []);
  });
});

describe('the plans catalog', () => {
  const now = 1_795_392_000;
  /** Read as a `test` or `mock` build reads it: the placeholder currency XTS is allowed there only. */
  const check = name =>
    catalogCheck(plansScenario(name).body(now), { payHosts: PAY_HOSTS, now, currencies: testCurrencies() });

  test('the currency rule: XTS is not a real currency; only a test configuration allows it (plans §3.5)', () => {
    assert.equal(realCurrencies().has(TEST_CURRENCY), false, 'Intl does not list XTS');
    const strict = catalogCheck(plansScenario('three').body(now), { payHosts: PAY_HOSTS, now });
    assert.deepEqual(strict.kept, ['free']);
    assert.deepEqual(
      strict.dropped.map(d => d.why),
      ['currency', 'currency'],
    );
    assert.deepEqual(check('three').kept, ['free', 'pro-monthly', 'pro-annual']);
  });

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
    const rules = { payHosts: PAY_HOSTS, currencies: testCurrencies() };
    const one = plan => catalogCheck({ ...base, plans: [base.plans[0], plan] }, rules).dropped[0]?.why;
    assert.equal(one({ ...monthly, name: 'x'.repeat(33) }), 'text');
    assert.equal(one({ ...monthly, name: 'x'.repeat(32) }), undefined);
    assert.equal(one({ ...monthly, name: '\u{1f600}'.repeat(32) }), undefined, 'code points, not UTF-16 units');
    assert.equal(one({ ...monthly, name: '\u{1f600}'.repeat(33) }), 'text');
    assert.equal(one({ ...monthly, name: `  ${'x'.repeat(32)}  ` }), undefined, 'counted after trimming');
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
    assert.equal(one({ ...base.plans[0], id: 'free-2', price: { amount: 0, currency: 'USD' } }), 'price');
    assert.equal(one({ ...base.plans[0], id: 'free-2', checkoutUrl: monthly.checkoutUrl }), 'shape');
    const astral = `https://web.example.invalid/${'\u{1f600}'.repeat(150)}`; // 178 code points, 328 UTF-16 units
    assert.equal(one({ ...monthly, checkoutUrl: astral }), undefined, 'an address counts code points too');
    assert.equal(catalogCheck({ ...base, plans: Array(7).fill(monthly) }, rules).why, 'shape', 'more than 6 plans');
    assert.equal(catalogCheck({ ...base, plans: Array(6).fill(monthly) }, rules).ok, true, 'six plans');
    const noManage = catalogCheck({ ...base, manageUrl: 'https://elsewhere.invalid/' }, rules);
    assert.equal(noManage.manageUrl, null);
  });
});
