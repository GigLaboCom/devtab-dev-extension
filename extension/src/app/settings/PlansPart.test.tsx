/**
 * The plans part of Settings → Pro (pro-plans-and-payment §5.4, §5.5, §8.2): each view of the plan source in words,
 * exactly; when it asks for the list (only on a press in the free state; once on opening with a licence and a list that
 * is not fresh); the links the cards draw. Amounts and hosts are the placeholders of samplePlans (XTS, .invalid).
 */
import { PlansPart } from './PlansPart';
import { memoryPlans } from '@src/plans/memory';
import { parseCatalog } from '@src/plans/model';
import { SAMPLE_CATALOG, SAMPLE_RULES } from '@src/plans/sample';
import { recordFor } from '@src/test/plansRecords';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { SourceState } from '@src/edition/source';
import type { Catalog } from '@src/plans/model';
import type { PlanSource, PlansView } from '@src/plans/source';

afterEach(cleanup);

const T0 = Date.UTC(2026, 10, 24, 12);
const DAY = 86_400_000;
const HOST = 'licence-fake.invalid';
const SITE = { siteUrl: 'https://web.example.invalid/pro/', siteHost: 'web.example.invalid' };
const CATALOG = (() => {
  const parsed = parseCatalog(SAMPLE_CATALOG, SAMPLE_RULES);
  if (!parsed.ok) throw new Error('the sample catalog does not parse');
  return parsed.catalog;
})() as Catalog;
const time = (ms: number) => new Intl.DateTimeFormat('en-US', { timeStyle: 'short' }).format(ms);
const date = (ms: number) => new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(ms);

const FREE: SourceState = { kind: 'free' };
const facts = (over: Record<string, unknown> = {}) => ({
  lid: 'lic_TEST0000000001',
  checkedAt: T0 - DAY,
  checkAfter: T0 + 6 * DAY,
  warnFrom: T0 + 22 * DAY,
  validUntil: T0 + 29 * DAY,
  paidUntil: T0 + 20 * DAY,
  term: 'month' as const,
  renews: true,
  ...over,
});
const ACTIVE: SourceState = { kind: 'active', licence: facts(), due: false };

/** A source that shows one view and counts what it is asked. */
const viewSource = (view: PlansView): PlanSource & { asked: string[] } => {
  const asked: string[] = [];
  return {
    id: 'memoryPlans',
    current: () => view,
    ready: Promise.resolve(view),
    subscribe: () => () => undefined,
    refresh: async reason => void asked.push(reason),
    dispose: () => undefined,
    asked,
  };
};

const part = (source: PlanSource, licence: SourceState = FREE) =>
  render(<PlansPart source={source} licence={licence} host={HOST} now={() => T0} {...SITE} />);
const line = () => document.querySelector('[data-plans] [role="status"]')!;
const cards = () => screen.queryAllByRole('article').map(a => a.getAttribute('aria-labelledby'));

describe('each view of the plan source, in words (§5.4)', () => {
  it('absent: nothing at all', () => {
    const { container } = part(viewSource({ kind: 'absent' }));
    expect(container.innerHTML).toBe('');
  });

  it('idle: the line, See plans, no cards', () => {
    part(viewSource({ kind: 'idle' }));
    expect(line().textContent).toBe(
      'See the Pro plans and their prices. This downloads the list from licence-fake.invalid; nothing about you is sent.',
    );
    expect(line().getAttribute('aria-live')).toBe('polite');
    expect(screen.getByRole('button', { name: 'See plans' })).toBeTruthy();
    expect(cards()).toEqual([]);
  });

  it('loading without a list: the line, a disabled Loading…, the list’s place busy', () => {
    part(viewSource({ kind: 'loading' }));
    expect(line().textContent).toBe('Loading plans…');
    expect((screen.getByRole('button', { name: 'Loading…' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('list', { name: 'Pro plans' }).getAttribute('aria-busy')).toBe('true');
    expect(cards()).toEqual([]);
  });

  it('loading with a stale list: Updating plans…, the cards without prices, no control', () => {
    part(viewSource({ kind: 'loading', stale: { catalog: CATALOG, fetchedAt: T0 - 2 * DAY } }));
    expect(line().textContent).toBe('Updating plans…');
    expect(cards()).toEqual(['plan-free-name', 'plan-pro-monthly-name', 'plan-pro-annual-name']);
    expect(screen.getAllByText('Price not shown')).toHaveLength(2);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('fresh: no line, the cards with prices in the catalog’s order, the badge, Free current in the free state', () => {
    part(viewSource({ kind: 'fresh', catalog: CATALOG, fetchedAt: T0 }));
    expect(line().textContent).toBe('');
    expect(cards()).toEqual(['plan-free-name', 'plan-pro-monthly-name', 'plan-pro-annual-name']);
    const [free, monthly, annual] = screen.getAllByRole('article');
    expect(monthly.querySelector('.kit-plan-card-price')!.textContent).toBe('XTS 11.11 per month');
    expect(annual.querySelector('.kit-plan-card-price')!.textContent).toBe('XTS 111.10 per year');
    expect(document.getElementById('plan-pro-annual-name')!.textContent).toBe('Annually, Save with a year');
    expect(within(free).getByText('Current plan')).toBeTruthy();
    expect(free.closest('li')!.getAttribute('aria-current')).toBe('true');
    expect(screen.queryByText('Price not shown')).toBeNull();
    expect(screen.queryByRole('button', { name: /See plans|Try again/ })).toBeNull();
  });

  it('stale: the line with the list’s date, the cards without prices, Try again and the cards’ links', () => {
    const fetchedAt = T0 - 2 * DAY;
    part(viewSource({ kind: 'stale', catalog: CATALOG, fetchedAt }));
    expect(line().textContent).toBe(
      `These plans are from ${date(fetchedAt)}. Couldn’t update them, so prices aren’t shown.`,
    );
    expect(screen.getAllByText('Price not shown')).toHaveLength(2);
    expect(screen.queryByText(/XTS/)).toBeNull();
    expect(screen.queryByText('Tax calculated at checkout.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /^Choose Monthly/ })).toBeTruthy();
  });

  it.each([
    ['offline', 'Couldn’t load the plans. Check your connection and try again.'],
    ['server', 'Couldn’t load the plans from licence-fake.invalid. Try again later.'],
    ['bad-answer', 'Couldn’t load the plans from licence-fake.invalid. Try again later.'],
  ] as const)('unavailable: %s — the line, Try again, the site’s plans page', (why, text) => {
    part(viewSource({ kind: 'unavailable', why }));
    expect(line().textContent).toBe(text);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    const link = screen.getByRole('link', { name: /^See plans on web\.example\.invalid/ });
    expect(link.getAttribute('href')).toBe('https://web.example.invalid/pro/');
    expect(cards()).toEqual([]);
  });

  it('unavailable: rate-limited and server-busy — the line with the time, Try again disabled until then', () => {
    const retryAt = T0 + 120_000;
    part(viewSource({ kind: 'unavailable', why: 'rate-limited', retryAt }));
    expect(line().textContent).toBe(`Too many attempts. Try again after ${time(retryAt)}.`);
    expect((screen.getByRole('button', { name: 'Try again' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('link')).toBeNull();
    cleanup();
    part(viewSource({ kind: 'unavailable', why: 'server-busy', retryAt }));
    expect(line().textContent).toBe(
      `Couldn’t load the plans: licence-fake.invalid is busy. Try again after ${time(retryAt)}.`,
    );
    expect((screen.getByRole('button', { name: 'Try again' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('unavailable: worker — the line alone', () => {
    part(viewSource({ kind: 'unavailable', why: 'worker' }));
    expect(line().textContent).toBe('The extension was just updated. Reload this page and try again.');
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('unsupported: the line and the site’s plans page', () => {
    part(viewSource({ kind: 'unsupported' }));
    expect(line().textContent).toBe(
      'This version of the extension can’t read the current plans. Update the extension, or see the plans on web.example.invalid.',
    );
    expect(screen.getByRole('link', { name: /^See plans on web\.example\.invalid/ })).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('without the site’s plans page, no such link', () => {
    render(
      <PlansPart
        source={viewSource({ kind: 'unavailable', why: 'offline' })}
        licence={FREE}
        host={HOST}
        siteUrl={undefined}
        siteHost={undefined}
      />,
    );
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('the links of the cards (§5.4, §5.5)', () => {
  it('a new tab of the site, no referrer, the address exactly from the catalog, the hidden words after the text', () => {
    part(viewSource({ kind: 'fresh', catalog: CATALOG, fetchedAt: T0 }));
    const choose = screen.getByRole('link', { name: 'Choose Monthly (opens web.example.invalid in a new tab)' });
    expect(choose.getAttribute('href')).toBe('https://web.example.invalid/pro/checkout/?plan=pro-monthly');
    expect(choose.getAttribute('target')).toBe('_blank');
    expect(choose.getAttribute('rel')).toBe('noopener noreferrer');
    expect(choose.querySelector('.sr-only')!.textContent).toBe(' (opens web.example.invalid in a new tab)');
    expect(choose.dataset.variant).toBe('default');
  });

  it('an active monthly licence: Manage subscription (outline) to manageUrl, Switch to Annually with ?plan=', () => {
    part(viewSource({ kind: 'fresh', catalog: CATALOG, fetchedAt: T0 }), ACTIVE);
    const monthly = screen.getByRole('article', { name: /^Monthly/ });
    expect(within(monthly).getByText(`Renews on ${date(T0 + 20 * DAY)}.`)).toBeTruthy();
    const manage = within(monthly).getByRole('link', { name: /^Manage subscription/ });
    expect(manage.getAttribute('href')).toBe('https://web.example.invalid/pro/manage/');
    expect(manage.dataset.variant).toBe('outline');
    const switchTo = screen.getByRole('link', { name: /^Switch to Annually/ });
    expect(switchTo.getAttribute('href')).toBe('https://web.example.invalid/pro/manage/?plan=pro-annual');
  });

  it('a licence that needs no subscription: the line under the cards, no card offers anything', () => {
    part(viewSource({ kind: 'fresh', catalog: CATALOG, fetchedAt: T0 }), {
      kind: 'active',
      licence: facts({ paidUntil: null, term: undefined, renews: undefined }),
      due: false,
    });
    expect(screen.getByText('Your licence doesn’t need a subscription.')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('a licence of a term no card has: Manage subscription under the cards', () => {
    part(viewSource({ kind: 'fresh', catalog: CATALOG, fetchedAt: T0 }), {
      kind: 'active',
      licence: facts({ term: undefined }),
      due: false,
    });
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('https://web.example.invalid/pro/manage/');
  });

  it('a catalog without a manage address: the words without a link where Manage subscription would be', () => {
    part(viewSource({ kind: 'fresh', catalog: { ...CATALOG, manageUrl: null }, fetchedAt: T0 }), ACTIVE);
    expect(screen.getByText('Manage your subscription on web.example.invalid.')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('when the part asks for the list (§4.5)', () => {
  it('See plans asks once (person), the focus goes to the status line, and the cards come', async () => {
    const source = memoryPlans({ replies: [{ body: SAMPLE_CATALOG }] }, () => Date.now(), SAMPLE_RULES);
    await source.ready;
    part(source);
    fireEvent.click(screen.getByRole('button', { name: 'See plans' }));
    expect(document.activeElement).toBe(line());
    await waitFor(() => expect(cards()).toHaveLength(3));
    expect(source.calls).toBe(1);
    expect(document.activeElement).toBe(line());
    source.dispose();
  });

  it('the free state never asks by itself — not with a stale list either', async () => {
    const source = memoryPlans(
      { record: recordFor('stale', Date.now()), replies: [{ body: SAMPLE_CATALOG }] },
      () => Date.now(),
      SAMPLE_RULES,
    );
    await source.ready;
    part(source, FREE);
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(source.calls).toBe(0);
    expect(source.current().kind).toBe('stale');
    source.dispose();
  });

  it('with a licence and a list that is not fresh, opening asks once (opened); a fresh one, never', async () => {
    const stale = viewSource({ kind: 'stale', catalog: CATALOG, fetchedAt: T0 - 2 * DAY });
    const { rerender } = part(stale, ACTIVE);
    await waitFor(() => expect(stale.asked).toEqual(['opened']));
    rerender(<PlansPart source={stale} licence={{ ...ACTIVE }} host={HOST} now={() => T0} {...SITE} />);
    await act(async () => undefined);
    expect(stale.asked).toEqual(['opened']);
    cleanup();
    const fresh = viewSource({ kind: 'fresh', catalog: CATALOG, fetchedAt: T0 });
    part(fresh, ACTIVE);
    await act(async () => undefined);
    expect(fresh.asked).toEqual([]);
    cleanup();
    const idle = viewSource({ kind: 'idle' });
    part(idle, { kind: 'ended', licence: facts({ renews: false }) });
    await waitFor(() => expect(idle.asked).toEqual(['opened']));
  });

  it('a licence that arrives on the open page (activated here) is not an opening: nothing is asked', async () => {
    const stale = viewSource({ kind: 'stale', catalog: CATALOG, fetchedAt: T0 - 2 * DAY });
    const { rerender } = part(stale, FREE);
    rerender(<PlansPart source={stale} licence={ACTIVE} host={HOST} now={() => T0} {...SITE} />);
    await act(async () => undefined);
    expect(stale.asked).toEqual([]);
  });

  it('while the licence is not read yet, nothing is asked; once it is, as at an opening', async () => {
    const stale = viewSource({ kind: 'stale', catalog: CATALOG, fetchedAt: T0 - 2 * DAY });
    const { rerender } = part(stale, { kind: 'unknown' });
    await act(async () => undefined);
    expect(stale.asked).toEqual([]);
    rerender(<PlansPart source={stale} licence={ACTIVE} host={HOST} now={() => T0} {...SITE} />);
    await waitFor(() => expect(stale.asked).toEqual(['opened']));
  });

  it('Try again waits for its time, then asks', async () => {
    const source = viewSource({ kind: 'unavailable', why: 'offline', retryAt: T0 + 60_000 });
    let now = T0;
    const { rerender } = render(<PlansPart source={source} licence={FREE} host={HOST} now={() => now} {...SITE} />);
    const button = () => screen.getByRole('button', { name: 'Try again' }) as HTMLButtonElement;
    expect(button().disabled).toBe(true);
    now = T0 + 60_000;
    rerender(<PlansPart source={source} licence={FREE} host={HOST} now={() => now} {...SITE} />);
    expect(button().disabled).toBe(false);
    fireEvent.click(button());
    expect(source.asked).toEqual(['person']);
  });
});
