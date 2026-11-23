/**
 * The plans catalog (pro-plans §3.2, §3.6, §4.7, §8.1) over the specification's placeholder catalog (XTS prices,
 * `.invalid` hosts): what a test configuration shows, what a store configuration skips, and each rule of a plan by
 * itself — a plan that breaks one is skipped, the rest are shown; a format that cannot be read is refused whole.
 */
import { intlCurrencies, parseCatalog, plansAt } from './model';
import { describe, expect, it } from 'vitest';
import type { CatalogRules } from './model';

const PAY_HOSTS = ['web.example.invalid'];
/** The `test` configuration: Intl's currencies plus XTS. */
const TEST_RULES: CatalogRules = { payHosts: PAY_HOSTS, currencies: new Set([...intlCurrencies(), 'XTS']) };
/** The `production` configuration: Intl's currencies alone. */
const STORE_RULES: CatalogRules = { payHosts: PAY_HOSTS };

const FREE = {
  id: 'free',
  kind: 'free',
  term: null,
  name: 'Free',
  summary: 'Every tool, in full, offline.',
  includes: ['All 44 tools', 'Nothing you paste leaves this browser'],
  price: null,
  priceNote: null,
  badge: null,
  checkoutUrl: null,
  until: null,
};
const MONTHLY = {
  id: 'pro-monthly',
  kind: 'paid',
  term: 'month',
  name: 'Monthly',
  summary: 'Pro, billed every month.',
  includes: ['Tool history and its archive', 'Tools remember your options', 'Copy automatically after generating'],
  price: { amount: 1111, currency: 'XTS' },
  priceNote: 'Tax calculated at checkout.',
  badge: null,
  checkoutUrl: 'https://web.example.invalid/pro/checkout/?plan=pro-monthly',
  until: null,
};
const ANNUAL = {
  id: 'pro-annual',
  kind: 'paid',
  term: 'year',
  name: 'Annually',
  summary: 'Pro, billed once a year.',
  includes: ['Everything in Monthly'],
  price: { amount: 11110, currency: 'XTS' },
  priceNote: 'Tax calculated at checkout.',
  badge: 'Save with a year',
  checkoutUrl: 'https://web.example.invalid/pro/checkout/?plan=pro-annual',
  until: null,
};
const CATALOG = {
  v: 1,
  catalog: '2026-11-23.1',
  maxAge: 86400,
  manageUrl: 'https://web.example.invalid/pro/manage/',
  plans: [FREE, MONTHLY, ANNUAL],
};

const withPlan = (plan: Record<string, unknown>) => ({ ...CATALOG, plans: [FREE, plan] });
/** What happened to the second plan of a catalog of Free and `plan`. */
const fate = (plan: Record<string, unknown>, rules = TEST_RULES) => {
  const parsed = parseCatalog(withPlan(plan), rules);
  if (!parsed.ok) return parsed.why;
  return parsed.catalog.plans.length === 2 ? 'kept' : parsed.dropped[0]!.why;
};
const kept = (plan: Record<string, unknown>) => {
  const parsed = parseCatalog(withPlan(plan), TEST_RULES);
  return parsed.ok ? parsed.catalog.plans[1] : undefined;
};

describe('parseCatalog: the catalog', () => {
  it('the placeholder catalog with the test configuration’s currencies: three plans in order', () => {
    const parsed = parseCatalog(CATALOG, TEST_RULES);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.catalog).toMatchObject({
      v: 1,
      catalog: '2026-11-23.1',
      maxAgeMs: 86_400_000,
      manageUrl: 'https://web.example.invalid/pro/manage/',
    });
    expect(parsed.catalog.plans.map(p => p.id)).toEqual(['free', 'pro-monthly', 'pro-annual']);
    expect(parsed.catalog.plans[2]).toEqual({ ...ANNUAL, term: 'year', until: null });
    expect(parsed.dropped).toEqual([]);
  });

  it('with the store configuration’s rules: only Free — both paid plans are skipped for their currency', () => {
    const parsed = parseCatalog(CATALOG, STORE_RULES);
    expect(parsed.ok && parsed.catalog.plans.map(p => p.id)).toEqual(['free']);
    expect(parsed.ok && parsed.dropped).toEqual([
      { index: 1, why: 'currency' },
      { index: 2, why: 'currency' },
    ]);
  });

  it('XTS is not one of Intl’s currencies (so only a test configuration admits it)', () => {
    expect(intlCurrencies().has('XTS')).toBe(false);
    expect(intlCurrencies().has('USD')).toBe(true);
  });

  it('v: 2 → unsupported; v missing → shape', () => {
    expect(parseCatalog({ ...CATALOG, v: 2 }, TEST_RULES)).toEqual({ ok: false, why: 'unsupported' });
    expect(parseCatalog({ ...CATALOG, v: undefined }, TEST_RULES)).toEqual({ ok: false, why: 'shape' });
  });

  it.each([
    ['not an object', 'plans'],
    ['an array', [CATALOG]],
    ['null', null],
    ['undefined', undefined],
  ])('%s → shape', (_name, raw) => {
    expect(parseCatalog(raw, TEST_RULES)).toEqual({ ok: false, why: 'shape' });
  });

  it('0 plans → empty, 7 → shape, 6 → read', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ ...MONTHLY, id: `pro-${i}` }));
    expect(parseCatalog({ ...CATALOG, plans: [] }, TEST_RULES)).toEqual({ ok: false, why: 'empty' });
    expect(parseCatalog({ ...CATALOG, plans: many(7) }, TEST_RULES)).toEqual({ ok: false, why: 'shape' });
    const six = parseCatalog({ ...CATALOG, plans: many(6) }, TEST_RULES);
    expect(six.ok && six.catalog.plans).toHaveLength(6);
  });

  it('every plan bad → empty', () => {
    expect(parseCatalog({ ...CATALOG, plans: [{ ...MONTHLY, kind: 'team' }, 5] }, TEST_RULES)).toEqual({
      ok: false,
      why: 'empty',
    });
  });

  it.each([
    ['catalog missing', { catalog: undefined }],
    ['catalog against its rule', { catalog: 'a b' }],
    ['catalog longer than 40', { catalog: 'a'.repeat(41) }],
    ['maxAge as a string', { maxAge: '86400' }],
    ['manageUrl as a number', { manageUrl: 5 }],
    ['plans not an array', { plans: { 0: FREE } }],
  ])('%s → shape', (_name, change) => {
    expect(parseCatalog({ ...CATALOG, ...change }, TEST_RULES)).toEqual({ ok: false, why: 'shape' });
  });

  it('maxAge 10 and 10⁹ are kept within 1 h … 7 days', () => {
    const age = (maxAge: number) => {
      const parsed = parseCatalog({ ...CATALOG, maxAge }, TEST_RULES);
      return parsed.ok ? parsed.catalog.maxAgeMs : undefined;
    };
    expect(age(10)).toBe(3_600_000);
    expect(age(1e9)).toBe(604_800_000);
  });

  it('a manageUrl that breaks the rule becomes null; null stays null', () => {
    const manage = (manageUrl: string | null) => {
      const parsed = parseCatalog({ ...CATALOG, manageUrl }, TEST_RULES);
      return parsed.ok ? parsed.catalog.manageUrl : 'refused';
    };
    expect(manage('https://elsewhere.invalid/manage/')).toBeNull();
    expect(manage('http://web.example.invalid/pro/manage/')).toBeNull();
    expect(manage(null)).toBeNull();
  });

  it('extra fields of the catalog and of a plan are accepted and not read', () => {
    const parsed = parseCatalog({ ...CATALOG, region: 'eu', plans: [{ ...FREE, colour: 'gold' }] }, TEST_RULES);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(Object.keys(parsed.catalog)).not.toContain('region');
    expect(Object.keys(parsed.catalog.plans[0]!)).not.toContain('colour');
  });

  it('two plans with one id: the second is skipped', () => {
    const parsed = parseCatalog({ ...CATALOG, plans: [FREE, MONTHLY, { ...ANNUAL, id: 'pro-monthly' }] }, TEST_RULES);
    expect(parsed.ok && parsed.catalog.plans.map(p => p.name)).toEqual(['Free', 'Monthly']);
    expect(parsed.ok && parsed.dropped).toEqual([{ index: 2, why: 'duplicate' }]);
  });
});

describe('parseCatalog: one plan skipped, the rest shown', () => {
  const REQUIRED = [
    'id',
    'kind',
    'term',
    'name',
    'summary',
    'includes',
    'price',
    'priceNote',
    'badge',
    'checkoutUrl',
    'until',
  ] as const;

  it.each(REQUIRED)('without %s → skipped', field => {
    const plan: Record<string, unknown> = { ...MONTHLY };
    delete plan[field];
    expect(fate(plan)).not.toBe('kept');
  });

  it.each([
    ['id as a number', { id: 1 }, 'shape'],
    ['id against its rule', { id: 'Pro_Monthly' }, 'shape'],
    ['kind: team', { kind: 'team' }, 'kind'],
    ['term: week', { term: 'week' }, 'term'],
    ['term null on a paid plan', { term: null }, 'term'],
    ['name as a number', { name: 5 }, 'shape'],
    ['summary as an array', { summary: ['x'] }, 'shape'],
    ['includes as a string', { includes: 'all' }, 'shape'],
    ['an include as a number', { includes: [1] }, 'shape'],
    ['nine includes', { includes: Array.from({ length: 9 }, (_, i) => `Line ${i}`) }, 'text'],
    ['price as a number', { price: 1111 }, 'price'],
    ['price null on a paid plan', { price: null }, 'price'],
    ['amount with a fraction', { price: { amount: 11.5, currency: 'XTS' } }, 'price'],
    ['amount negative', { price: { amount: -1, currency: 'XTS' } }, 'price'],
    ['amount above the limit', { price: { amount: 100_000_001, currency: 'XTS' } }, 'price'],
    ['currency ABC (Intl formats it, but does not list it)', { price: { amount: 1, currency: 'ABC' } }, 'currency'],
    ['currency usd in lower case', { price: { amount: 1, currency: 'usd' } }, 'currency'],
    ['priceNote as a number', { priceNote: 0 }, 'shape'],
    ['badge as true', { badge: true }, 'shape'],
    ['checkoutUrl null on a paid plan', { checkoutUrl: null }, 'shape'],
    ['until as a string', { until: 'soon' }, 'shape'],
    ['until with a fraction', { until: 1.5 }, 'shape'],
  ])('%s → %s', (_name, change, why) => {
    expect(fate({ ...MONTHLY, ...change })).toBe(why);
  });

  it('Free with a price → price; Free with a checkout address → shape; Free with a term → term', () => {
    expect(fate({ ...FREE, id: 'free-2', price: { amount: 0, currency: 'XTS' } })).toBe('price');
    expect(fate({ ...FREE, id: 'free-2', checkoutUrl: MONTHLY.checkoutUrl })).toBe('shape');
    expect(fate({ ...FREE, id: 'free-2', term: 'month' })).toBe('term');
  });

  it('a real currency is kept with either configuration', () => {
    expect(fate({ ...MONTHLY, price: { amount: 1111, currency: 'USD' } }, STORE_RULES)).toBe('kept');
  });
});

describe('parseCatalog: texts — trimmed, in code points, text only', () => {
  const LIMITS = [
    ['name', 32],
    ['summary', 140],
    ['priceNote', 60],
    ['badge', 24],
  ] as const;

  it.each(LIMITS)('%s: exactly at its limit of %i is kept, one more is skipped (text)', (field, limit) => {
    expect(fate({ ...MONTHLY, [field]: 'a'.repeat(limit) })).toBe('kept');
    expect(fate({ ...MONTHLY, [field]: 'a'.repeat(limit + 1) })).toBe('text');
  });

  it.each(LIMITS)('%s: lengths in code points — a character outside the basic plane is one', (field, limit) => {
    const astral = '\u{1F600}';
    expect(fate({ ...MONTHLY, [field]: astral.repeat(limit) })).toBe('kept');
    expect(fate({ ...MONTHLY, [field]: astral.repeat(limit + 1) })).toBe('text');
  });

  it.each(LIMITS)('%s: spaces at the ends do not count and are trimmed', (field, limit) => {
    expect(kept({ ...MONTHLY, [field]: `  ${'a'.repeat(limit)}  ` })?.[field]).toBe('a'.repeat(limit));
  });

  it('an include: 100 code points kept, 101 skipped; an empty one after trimming is left out', () => {
    expect(fate({ ...MONTHLY, includes: ['a'.repeat(100)] })).toBe('kept');
    expect(fate({ ...MONTHLY, includes: ['a'.repeat(101)] })).toBe('text');
    expect(kept({ ...MONTHLY, includes: [' One ', '   ', 'Two'] })?.includes).toEqual(['One', 'Two']);
  });

  it('a name empty after trimming → text; an optional text empty after trimming → null', () => {
    expect(fate({ ...MONTHLY, name: '   ' })).toBe('text');
    expect(kept({ ...MONTHLY, summary: '  ', badge: '' })).toMatchObject({ summary: null, badge: null });
  });

  it.each([
    ['a control character', 'Month\u0007ly'],
    ['a line break', 'Month\nly'],
    ['a C1 control', 'Month\u0085ly'],
    ['U+202E (right-to-left override)', 'Monthly ‮11.11'],
    ['U+2066 (left-to-right isolate)', '⁦Monthly'],
  ])('%s in the name → text', (_name, name) => {
    expect(fate({ ...MONTHLY, name })).toBe('text');
  });
});

describe('parseCatalog: addresses', () => {
  it.each([
    ['http:', 'http://web.example.invalid/pro/checkout/'],
    ['a port', 'https://web.example.invalid:8443/pro/checkout/'],
    ['the default port written out', 'https://web.example.invalid:443/pro/checkout/'],
    ['user:pass@', 'https://user:pass@web.example.invalid/pro/checkout/'],
    ['another host', 'https://pay.elsewhere.invalid/checkout/'],
    ['a subdomain of the pay host', 'https://shop.web.example.invalid/checkout/'],
    ['not an address', 'checkout'],
    ['javascript:', 'javascript:alert(1)'],
  ])('%s → url', (_name, checkoutUrl) => {
    expect(fate({ ...MONTHLY, checkoutUrl })).toBe('url');
  });

  it('300 code points kept, 301 skipped', () => {
    const base = 'https://web.example.invalid/pro/checkout/?plan=';
    expect(fate({ ...MONTHLY, checkoutUrl: base + 'a'.repeat(300 - base.length) })).toBe('kept');
    expect(fate({ ...MONTHLY, checkoutUrl: base + 'a'.repeat(301 - base.length) })).toBe('url');
  });

  it('the address is kept exactly as it came', () => {
    expect(kept(MONTHLY)?.checkoutUrl).toBe(MONTHLY.checkoutUrl);
  });
});

describe('plansAt', () => {
  it('shows plans whose until is null or ahead of now; until arrives in seconds and is kept in milliseconds', () => {
    const until = 1_800_000_000;
    const parsed = parseCatalog({ ...CATALOG, plans: [FREE, { ...MONTHLY, until }] }, TEST_RULES);
    if (!parsed.ok) throw new Error('not read');
    expect(parsed.catalog.plans[1]!.until).toBe(until * 1000);
    expect(plansAt(parsed.catalog, until * 1000 - 1).map(p => p.id)).toEqual(['free', 'pro-monthly']);
    expect(plansAt(parsed.catalog, until * 1000).map(p => p.id)).toEqual(['free']);
  });
});
