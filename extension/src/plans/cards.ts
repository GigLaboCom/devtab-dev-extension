/**
 * The plan cards as data: for a catalog, how fresh it is and the licence's state, what each card shows — its mark,
 * price (or that the price is not shown), state line and action — and the line under the cards for a licence no card
 * matches. One pure function, so every cell of the cards' table is a unit test without React. No chrome, no React.
 *
 * "The card of the licence's own term" is the paid plan whose `term` equals the token's `term`; the other paid cards
 * offer a switch, a purchase or nothing, by the state. A card is never told more than the server and the token say.
 */
import { plansAt } from './model';
import { formatPrice, periodText } from './price';
import { cardTexts } from '@src/app/settings/planTexts';
import type { Catalog, Plan } from './model';
import type { LicenceFacts } from '@extension/licence';
import type { SourceState } from '@src/edition/source';
import type { Freshness } from '@src/shared/plansRecord';

export type CardAction =
  | { readonly kind: 'checkout'; readonly href: string; readonly text: string; readonly primary: true }
  | { readonly kind: 'manage'; readonly href: string; readonly text: string; readonly primary: false }
  | { readonly kind: 'none' };

export interface CardView {
  readonly id: string;
  readonly name: string;
  readonly badge: string | null;
  readonly mark: string | null;
  readonly current: boolean;
  readonly price: { readonly amount: string; readonly period: string } | null;
  readonly priceMissing: string | null;
  readonly priceNote: string | null;
  readonly summary: string | null;
  readonly includes: readonly string[];
  readonly state: string | null;
  readonly action: CardAction;
}

export interface PlansPartView {
  readonly cards: readonly CardView[];
  /** The line under the cards for licences without a matching card. */
  readonly footer: { readonly text: string; readonly manageHref?: string } | null;
}

const NONE: CardAction = { kind: 'none' };

const checkout = (plan: Plan, text: string): CardAction =>
  plan.checkoutUrl ? { kind: 'checkout', href: plan.checkoutUrl, text, primary: true } : NONE;

const manage = (href: string | null, text: string): CardAction =>
  href ? { kind: 'manage', href, text, primary: false } : NONE;

/** `manageUrl?plan=<id>`, built through URL (the site's addresses end with a slash: `/pro/manage/?plan=…`). */
const switchHref = (manageUrl: string | null, id: string): string | null => {
  if (!manageUrl) return null;
  const url = new URL(manageUrl);
  url.searchParams.set('plan', id);
  return url.href;
};

interface Look {
  readonly mark: string | null;
  readonly current: boolean;
  readonly state: string | null;
  readonly action: CardAction;
}
const PLAIN: Look = { mark: null, current: false, state: null, action: NONE };
const CURRENT: Look = { ...PLAIN, mark: cardTexts.currentPlan, current: true };

/** The facts of a state that carries a licence. */
const licenceOf = (state: SourceState): LicenceFacts | undefined => ('licence' in state ? state.licence : undefined);

/** The cards' table: Free, the paid card of the licence's own term, the other paid cards — by the licence's state. */
export const plansPartView = (
  catalog: Catalog,
  freshness: Exclude<Freshness, 'expired'>,
  licence: SourceState,
  now: number,
): PlansPartView => {
  const plans = plansAt(catalog, now);
  const facts = licenceOf(licence);
  const term = facts?.term;
  const own = term === undefined ? undefined : plans.find(p => p.kind === 'paid' && p.term === term);
  let footer: PlansPartView['footer'] = null;

  const look = (plan: Plan): Look => {
    const isOwn = plan === own;
    switch (licence.kind) {
      case 'free':
      case 'revoked':
      case 'invalid':
        return plan.kind === 'free' ? CURRENT : { ...PLAIN, action: checkout(plan, cardTexts.choose(plan.name)) };
      case 'ended':
        if (plan.kind === 'free') return CURRENT;
        if (!isOwn) return { ...PLAIN, action: checkout(plan, cardTexts.choose(plan.name)) };
        return {
          ...PLAIN,
          state: facts?.paidUntil != null ? cardTexts.endedOn(facts.paidUntil) : null,
          action: checkout(plan, cardTexts.renew(plan.name)),
        };
      case 'active':
      case 'grace': {
        // Without a card of its own term — or with a licence that needs no subscription — no card offers anything.
        const paidUntil = facts?.paidUntil ?? null;
        if (plan.kind === 'free' || !own || paidUntil === null) return PLAIN;
        if (!isOwn)
          return { ...PLAIN, action: manage(switchHref(catalog.manageUrl, plan.id), cardTexts.switchTo(plan.name)) };
        return {
          ...CURRENT,
          state: facts?.renews === false ? cardTexts.cancelled(paidUntil) : cardTexts.renewsOn(paidUntil),
          action: manage(catalog.manageUrl, cardTexts.manage),
        };
      }
      case 'expired':
        return isOwn ? { ...PLAIN, mark: cardTexts.yourPlan, current: true, state: cardTexts.paused } : PLAIN;
      default:
        // unknown (the licence is not read yet) and fixed (a build without a licence): no mark, no link.
        return PLAIN;
    }
  };

  if (licence.kind === 'active' || licence.kind === 'grace') {
    if (facts?.paidUntil === null) footer = { text: cardTexts.noSubscription };
    else if (!own) footer = { text: cardTexts.manage, ...(catalog.manageUrl ? { manageHref: catalog.manageUrl } : {}) };
  }

  const cards = plans.map((plan): CardView => {
    const shown = look(plan);
    const priced = freshness === 'fresh';
    return {
      id: plan.id,
      name: plan.name,
      badge: plan.badge,
      ...shown,
      price:
        plan.kind === 'paid' && priced && plan.price && plan.term
          ? { amount: formatPrice(plan.price), period: periodText(plan.term) }
          : null,
      priceMissing: plan.kind === 'paid' && !priced ? cardTexts.priceNotShown : null,
      priceNote: priced ? plan.priceNote : null,
      summary: plan.summary,
      includes: plan.includes,
    };
  });
  return { cards, footer };
};
