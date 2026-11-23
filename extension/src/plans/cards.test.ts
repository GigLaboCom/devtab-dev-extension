/**
 * The plan cards as data (pro-plans §5.4, §8.2): each cell of the table "licence state × card" — Free, the paid card of
 * the licence's own term, another paid card — word for word, named by its row; prices only from a fresh list; the
 * lines under the cards for a licence without a card of its own.
 */
import { plansPartView } from './cards';
import { intlCurrencies, parseCatalog } from './model';
import { describe, expect, it } from 'vitest';
import type { CardView } from './cards';
import type { Catalog } from './model';
import type { LicenceFacts, RevokeReason } from '@extension/licence';
import type { SourceState } from '@src/edition/source';

const NBSP = ' ';
const NOW = Date.UTC(2026, 10, 1, 12);
const PAID = Date.UTC(2026, 10, 23, 12);
const MANAGE = 'https://web.example.invalid/pro/manage/';

const RAW = {
  v: 1,
  catalog: '2026-11-23.1',
  maxAge: 86400,
  manageUrl: MANAGE,
  plans: [
    {
      id: 'free',
      kind: 'free',
      term: null,
      name: 'Free',
      summary: 'Every tool, in full, offline.',
      includes: ['All 44 tools'],
      price: null,
      priceNote: null,
      badge: null,
      checkoutUrl: null,
      until: null,
    },
    {
      id: 'pro-monthly',
      kind: 'paid',
      term: 'month',
      name: 'Monthly',
      summary: 'Pro, billed every month.',
      includes: ['Tool history and its archive'],
      price: { amount: 1111, currency: 'XTS' },
      priceNote: 'Tax calculated at checkout.',
      badge: null,
      checkoutUrl: 'https://web.example.invalid/pro/checkout/?plan=pro-monthly',
      until: null,
    },
    {
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
    },
  ],
};
const catalogOf = (raw: unknown): Catalog => {
  const parsed = parseCatalog(raw, {
    payHosts: ['web.example.invalid'],
    currencies: new Set([...intlCurrencies(), 'XTS']),
  });
  if (!parsed.ok) throw new Error(`the test catalog does not read: ${parsed.why}`);
  return parsed.catalog;
};
const CATALOG = catalogOf(RAW);

const facts = (overrides?: Partial<LicenceFacts>): LicenceFacts => ({
  lid: 'lic_TEST0000000001',
  checkedAt: NOW,
  checkAfter: NOW + 7 * 86_400_000,
  warnFrom: NOW + 23 * 86_400_000,
  validUntil: NOW + 30 * 86_400_000,
  paidUntil: PAID,
  term: 'month',
  renews: true,
  ...overrides,
});

/** The facts without some of their optional fields (a token that did not carry them). */
const without = (from: LicenceFacts, ...names: ('term' | 'renews')[]): LicenceFacts => {
  const copy: Record<string, unknown> = { ...from };
  for (const name of names) delete copy[name];
  return copy as unknown as LicenceFacts;
};

const view = (licence: SourceState, catalog = CATALOG, fresh: 'fresh' | 'stale' = 'fresh') =>
  plansPartView(catalog, fresh, licence, NOW);
/** Free, the card of the licence's own term (Monthly), the other paid card (Annually). */
const cardsOf = (licence: SourceState) => {
  const { cards } = view(licence);
  return { free: cards[0]!, own: cards[1]!, other: cards[2]! };
};
/** What a cell of the table is about: mark, current, state line, action. */
const cell = (card: CardView) => ({ mark: card.mark, current: card.current, state: card.state, action: card.action });
const PLAIN = { mark: null, current: false, state: null, action: { kind: 'none' } };
const CURRENT = { ...PLAIN, mark: 'Current plan', current: true };
const choose = (name: string, id: string) => ({
  ...PLAIN,
  action: {
    kind: 'checkout',
    href: `https://web.example.invalid/pro/checkout/?plan=${id}`,
    text: `Choose ${name}`,
    primary: true,
  },
});

describe('plansPartView — the cards by the licence’s state (§5.4)', () => {
  it('unknown: Free without a mark; the own term’s card without a mark and a button; the other without a button', () => {
    const { free, own, other } = cardsOf({ kind: 'unknown' });
    expect([cell(free), cell(own), cell(other)]).toEqual([PLAIN, PLAIN, PLAIN]);
  });

  it('free: Free — Current plan; the paid cards — Choose {name} → checkoutUrl', () => {
    const { free, own, other } = cardsOf({ kind: 'free' });
    expect(cell(free)).toEqual(CURRENT);
    expect(cell(own)).toEqual(choose('Monthly', 'pro-monthly'));
    expect(cell(other)).toEqual(choose('Annually', 'pro-annual'));
  });

  it('active, renews: Free —; own — Current plan, Renews on {paidUntil}., Manage subscription; other — Switch to {name}', () => {
    const { free, own, other } = cardsOf({ kind: 'active', licence: facts(), due: false });
    expect(cell(free)).toEqual(PLAIN);
    expect(cell(own)).toEqual({
      ...CURRENT,
      state: 'Renews on Nov 23, 2026.',
      action: { kind: 'manage', href: MANAGE, text: 'Manage subscription', primary: false },
    });
    expect(cell(other)).toEqual({
      ...PLAIN,
      action: { kind: 'manage', href: `${MANAGE}?plan=pro-annual`, text: 'Switch to Annually', primary: false },
    });
  });

  it('active without renews in the token: as renews', () => {
    expect(cardsOf({ kind: 'active', licence: without(facts(), 'renews'), due: true }).own.state).toBe(
      'Renews on Nov 23, 2026.',
    );
  });

  it('active, renews: false (cancelled, still paid): own — Cancelled. Pro stays until {paidUntil}., Manage subscription; other — Switch to', () => {
    const { free, own, other } = cardsOf({ kind: 'active', licence: facts({ renews: false }), due: false });
    expect(cell(free)).toEqual(PLAIN);
    expect(cell(own)).toMatchObject({
      ...CURRENT,
      state: 'Cancelled. Pro stays until Nov 23, 2026.',
      action: { kind: 'manage', text: 'Manage subscription' },
    });
    expect(other.action).toMatchObject({ kind: 'manage', text: 'Switch to Annually' });
  });

  it('grace: as active', () => {
    const grace = cardsOf({ kind: 'grace', licence: facts() });
    const active = cardsOf({ kind: 'active', licence: facts(), due: true });
    expect([cell(grace.free), cell(grace.own), cell(grace.other)]).toEqual([
      cell(active.free),
      cell(active.own),
      cell(active.other),
    ]);
  });

  it('expired: Free —; own — Your plan, Paused until the licence is checked., no button; other — no button', () => {
    const { free, own, other } = cardsOf({ kind: 'expired', licence: facts() });
    expect(cell(free)).toEqual(PLAIN);
    expect(cell(own)).toEqual({
      ...PLAIN,
      mark: 'Your plan',
      current: true,
      state: 'Paused until the licence is checked.',
    });
    expect(cell(other)).toEqual(PLAIN);
  });

  it('ended: Free — Current plan; own — Ended on {paidUntil}., Renew {name} → checkoutUrl; other — Choose {name}', () => {
    const { free, own, other } = cardsOf({ kind: 'ended', licence: facts({ renews: false }) });
    expect(cell(free)).toEqual(CURRENT);
    expect(cell(own)).toEqual({
      ...PLAIN,
      state: 'Ended on Nov 23, 2026.',
      action: {
        kind: 'checkout',
        href: 'https://web.example.invalid/pro/checkout/?plan=pro-monthly',
        text: 'Renew Monthly',
        primary: true,
      },
    });
    expect(cell(other)).toEqual(choose('Annually', 'pro-annual'));
  });

  it.each(['refund', 'deactivated', 'key-blocked', 'seat-limit', 'unknown-installation'] as RevokeReason[])(
    'revoked (%s): Free — Current plan; the paid cards — Choose {name}',
    reason => {
      const { free, own, other } = cardsOf({ kind: 'revoked', licence: facts(), reason });
      expect([cell(free), cell(own), cell(other)]).toEqual([
        CURRENT,
        choose('Monthly', 'pro-monthly'),
        choose('Annually', 'pro-annual'),
      ]);
    },
  );

  it('invalid: Free — Current plan; the paid cards — Choose {name}', () => {
    const { free, own, other } = cardsOf({ kind: 'invalid', reason: 'signature' });
    expect([cell(free), cell(own), cell(other)]).toEqual([
      CURRENT,
      choose('Monthly', 'pro-monthly'),
      choose('Annually', 'pro-annual'),
    ]);
  });

  it('fixed (a build without a licence never shows the cards): no mark, no link', () => {
    for (const edition of ['pro', 'free'] as const)
      expect(view({ kind: 'fixed', edition }).cards.map(cell)).toEqual([PLAIN, PLAIN, PLAIN]);
  });
});

describe('plansPartView — a licence without a card of its own', () => {
  it('active without term in the token: no card current, no button; under the cards — Manage subscription', () => {
    const result = view({ kind: 'active', licence: without(facts(), 'term'), due: false });
    expect(result.cards.map(cell)).toEqual([PLAIN, PLAIN, PLAIN]);
    expect(result.footer).toEqual({ text: 'Manage subscription', manageHref: MANAGE });
  });

  it('active with a term no plan of the catalog has: the same', () => {
    const monthlyOnly = catalogOf({ ...RAW, plans: [RAW.plans[0], RAW.plans[2]] });
    const result = view({ kind: 'active', licence: facts({ term: 'month' }), due: false }, monthlyOnly);
    expect(result.cards.map(cell)).toEqual([PLAIN, PLAIN]);
    expect(result.footer).toEqual({ text: 'Manage subscription', manageHref: MANAGE });
  });

  it('active with paid: null (no subscription needed): no button; under the cards — Your licence doesn’t need a subscription.', () => {
    const result = view({ kind: 'active', licence: without(facts({ paidUntil: null }), 'term', 'renews'), due: false });
    expect(result.cards.map(cell)).toEqual([PLAIN, PLAIN, PLAIN]);
    expect(result.footer).toEqual({ text: 'Your licence doesn’t need a subscription.' });
  });

  it('every other state has no line under the cards', () => {
    for (const licence of [
      { kind: 'free' },
      { kind: 'unknown' },
      { kind: 'active', licence: facts(), due: false },
      { kind: 'ended', licence: facts() },
    ] as SourceState[])
      expect(view(licence).footer).toBeNull();
  });
});

describe('plansPartView — prices, the catalog’s manage address, the card’s data', () => {
  it('fresh: each paid card has its price and period; Free has none and shows its summary', () => {
    const { free, own, other } = cardsOf({ kind: 'free' });
    expect(own.price).toEqual({ amount: `XTS${NBSP}11.11`, period: 'per month' });
    expect(other.price).toEqual({ amount: `XTS${NBSP}111.10`, period: 'per year' });
    expect(own.priceNote).toBe('Tax calculated at checkout.');
    expect([free.price, free.priceMissing, free.summary]).toEqual([null, null, 'Every tool, in full, offline.']);
    expect(other.badge).toBe('Save with a year');
    expect(own.includes).toEqual(['Tool history and its archive']);
  });

  it('stale: every paid card has price: null and priceMissing: Price not shown — never a price as fresh', () => {
    const { cards } = view({ kind: 'free' }, CATALOG, 'stale');
    for (const card of cards.slice(1)) {
      expect(card.price).toBeNull();
      expect(card.priceMissing).toBe('Price not shown');
      expect(card.priceNote).toBeNull();
    }
    expect(cards[0]!.priceMissing).toBeNull();
    // The buttons still work: the site shows the current price itself.
    expect(cards[1]!.action).toMatchObject({ kind: 'checkout', text: 'Choose Monthly' });
  });

  it('manageUrl: null — no Manage subscription and no Switch to; the footer has no link', () => {
    const noManage = catalogOf({ ...RAW, manageUrl: null });
    const result = view({ kind: 'active', licence: facts(), due: false }, noManage);
    expect(result.cards[1]!.action).toEqual({ kind: 'none' });
    expect(result.cards[2]!.action).toEqual({ kind: 'none' });
    expect(result.cards[1]!.state).toBe('Renews on Nov 23, 2026.');
    expect(view({ kind: 'active', licence: without(facts(), 'term'), due: false }, noManage).footer).toEqual({
      text: 'Manage subscription',
    });
  });

  it('Switch to gets ?plan=<id> through URL, keeping the address’s own query', () => {
    const withQuery = catalogOf({ ...RAW, manageUrl: `${MANAGE}?from=ext&plan=old` });
    const action = view({ kind: 'active', licence: facts(), due: false }, withQuery).cards[2]!.action;
    expect(action).toMatchObject({ href: `${MANAGE}?from=ext&plan=pro-annual` });
  });

  it('a plan whose offer ended (until in the past) is not shown', () => {
    const limited = catalogOf({
      ...RAW,
      plans: [RAW.plans[0], RAW.plans[1], { ...RAW.plans[2], until: Math.floor(NOW / 1000) - 1 }],
    });
    expect(view({ kind: 'free' }, limited).cards.map(c => c.id)).toEqual(['free', 'pro-monthly']);
  });

  it('a year licence marks the Annually card', () => {
    const { own, other } = cardsOf({ kind: 'active', licence: facts({ term: 'year' }), due: false });
    expect(own.action).toMatchObject({ text: 'Switch to Monthly', href: `${MANAGE}?plan=pro-monthly` });
    expect(other).toMatchObject({ mark: 'Current plan', current: true });
  });
});
