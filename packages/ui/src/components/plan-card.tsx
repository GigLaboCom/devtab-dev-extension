/**
 * A plan as a card, and the list of them — what a page that sells a subscription shows: the plan's name (and a badge),
 * its price and period or the words that stand where a price is not shown, a note under the price, a summary, what it
 * includes, a state line and one action. The kit draws exactly what it is given: every text and the action come from
 * the host, which decides which plan is current and what its button does. The look is `kit-plans*` and
 * `kit-plan-card*` in @workspace/dna/sections.css, on a Card (`cn-card*`, style-gpui.css).
 *
 *   <PlanList label busy>                 <ul role="list"> in the kit-plans grid: one row of cards in a wide container
 *     <PlanCard id name … action />       (at least 40rem, and at least 13rem a card), one column below; `busy` →
 *                                         aria-busy while the list is on its way
 *
 * A card is an <li> holding an <article> named by its heading (`{id}-name`) and described by its state line
 * (`{id}-state`); the current plan is `aria-current` on the item and says so in words (`mark`), never by colour only.
 * The badge is read after the name, behind a comma a screen reader hears. The price is one line: the amount, then the
 * period ("XTS 11.11 per month").
 */
import { Badge } from './badge';
import { CheckIcon } from 'lucide-react';
import { Children } from 'react';
import type { ReactElement, ReactNode } from 'react';

export interface PlanCardProps {
  /** Prefix for the DOM ids (`{id}-name`, `{id}-state`). */
  readonly id: string;
  readonly name: string;
  readonly badge?: string;
  /** "Current plan" / "Your plan"; sets the mark. */
  readonly mark?: string;
  readonly current?: boolean;
  /** The price as one text ("XTS 11.11") and its period ("per month"); absent with `priceMissing` or for a free plan. */
  readonly price?: { readonly amount: string; readonly period: string };
  /** Shown where the price would be ("Price not shown"). */
  readonly priceMissing?: string;
  readonly priceNote?: string;
  readonly summary?: string;
  readonly includes: readonly string[];
  /** The card's state line ("Renews on Nov 23, 2026."). */
  readonly state?: string;
  /** The button or link the host supplies. */
  readonly action?: ReactNode;
}

/** One plan as a card: an <li> holding an <article>. */
export const PlanCard = ({
  id,
  name,
  badge,
  mark,
  current = false,
  price,
  priceMissing,
  priceNote,
  summary,
  includes,
  state,
  action,
}: PlanCardProps): ReactElement => {
  // A plan with neither a price nor words in its place (a free plan) shows its summary there.
  const priced = price !== undefined || priceMissing !== undefined;
  return (
    <li className="kit-plan-card-item" aria-current={current ? 'true' : undefined}>
      <article
        data-slot="card"
        data-current={current ? '' : undefined}
        aria-labelledby={`${id}-name`}
        aria-describedby={state ? `${id}-state` : undefined}
        className="cn-card group/card flex flex-col kit-plan-card">
        <div className="kit-plan-card-head">
          <h3 id={`${id}-name`} className="cn-card-title kit-plan-card-name">
            {name}
            {badge && (
              <>
                <span className="sr-only">, </span>
                <Badge variant="secondary">{badge}</Badge>
              </>
            )}
          </h3>
          {mark && <span className="kit-plan-card-mark">{mark}</span>}
        </div>
        <div className="kit-plan-card-body">
          {price ? (
            <p className="kit-plan-card-price">
              {price.amount} <span className="kit-plan-card-period">{price.period}</span>
            </p>
          ) : priceMissing ? (
            <p className="kit-plan-card-price" data-missing="">
              {priceMissing}
            </p>
          ) : (
            summary && <p className="kit-plan-card-price kit-plan-card-summary">{summary}</p>
          )}
          {priceNote && <p className="kit-plan-card-note">{priceNote}</p>}
          {priced && summary && <p className="kit-plan-card-summary">{summary}</p>}
          {includes.length > 0 && (
            <ul className="kit-plan-card-includes">
              {includes.map(line => (
                <li key={line}>
                  <CheckIcon aria-hidden="true" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {(state || action) && (
          <div className="kit-plan-card-foot">
            {state && (
              <p id={`${id}-state`} className="kit-plan-card-state">
                {state}
              </p>
            )}
            {action && <div className="kit-plan-card-action">{action}</div>}
          </div>
        )}
      </article>
    </li>
  );
};

/** The list of plan cards: <ul role="list">, the kit-plans grid, `busy` → aria-busy. */
export const PlanList = ({
  label,
  busy = false,
  children,
}: {
  readonly label: string;
  readonly busy?: boolean;
  readonly children?: ReactNode;
}): ReactElement => (
  // The count picks the grid's columns (one row of all the cards where they fit); the wrapper is the container the
  // width is measured on — a grid cannot query its own width.
  <div className="kit-plans" data-count={Children.toArray(children).length}>
    {/* role="list" said again: a list styled without markers loses its role in WebKit. */}
    {/* eslint-disable-next-line jsx-a11y/no-redundant-roles */}
    <ul role="list" aria-label={label} aria-busy={busy ? 'true' : undefined} className="kit-plans-list">
      {children}
    </ul>
  </div>
);
