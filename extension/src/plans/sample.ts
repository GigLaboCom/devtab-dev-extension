/**
 * DEVTAB_LICENCE_TEST — the showcase variant of seam `PlanSource` (DEVTAB_VARIANT=…,plans:samplePlans): `memoryPlans`
 * over a placeholder catalog, for screenshots and for work on the plans part without a server. Never in a store build:
 * its prices are in XTS (the ISO 4217 code for tests), its hosts are in the reserved `.invalid` zone, and its catalog's
 * id carries the test mark, which the build check refuses. Development against a live server is `remotePlans` with the
 * `mock` licence configuration, not this.
 */
import { memoryPlans } from './memory';
import { intlCurrencies } from './model';
import type { PlanSourceEnvironment, PlanSourceFactory } from './source';

const SITE = 'https://web.example.invalid';

/** The placeholder catalog: three plans as the server would send them. Texts, amounts and addresses are not the product's. */
export const SAMPLE_CATALOG = {
  v: 1,
  catalog: 'DEVTAB_LICENCE_TEST.sample',
  maxAge: 86_400,
  manageUrl: `${SITE}/pro/manage/`,
  plans: [
    {
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
    },
    {
      id: 'pro-monthly',
      kind: 'paid',
      term: 'month',
      name: 'Monthly',
      summary: 'Pro, billed every month.',
      includes: ['Tool history and its archive', 'Tools remember your options', 'Copy automatically after generating'],
      price: { amount: 1111, currency: 'XTS' },
      priceNote: 'Tax calculated at checkout.',
      badge: null,
      checkoutUrl: `${SITE}/pro/checkout/?plan=pro-monthly`,
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
      checkoutUrl: `${SITE}/pro/checkout/?plan=pro-annual`,
      until: null,
    },
  ],
} as const;

/** The rules the placeholder catalog passes: its host, and XTS besides the currencies Intl knows. */
export const SAMPLE_RULES = { payHosts: ['web.example.invalid'], currencies: new Set([...intlCurrencies(), 'XTS']) };

/** The placeholder list, fetched as the page opens; each `refresh` answers it again. */
export const samplePlans: PlanSourceFactory = Object.assign(
  (env: PlanSourceEnvironment) => {
    const now = env.now ?? Date.now;
    const at = now();
    const source = memoryPlans(
      {
        record: { v: 1, fetchedAt: at, body: SAMPLE_CATALOG, attempts: { last: at, failures: 0 } },
        replies: Array.from({ length: 100 }, () => ({ body: SAMPLE_CATALOG })),
      },
      now,
      SAMPLE_RULES,
    );
    return { ...source, id: 'samplePlans' as const };
  },
  { id: 'samplePlans' as const },
);
