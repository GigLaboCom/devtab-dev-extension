/**
 * The plans part of Settings → Pro (pro-plans-and-payment §5): the Pro plans as the plan source shows them now (seam
 * `PlanSource`, src/plans/source.ts) — a line over the cards, the button that asks for the list, the cards, and the line
 * under them for a licence no card matches. What each card says comes from one pure function (src/plans/cards.ts) over
 * the server's catalog and the licence's state; everything about a plan — name, price, lines, badge, addresses — is the
 * server's, checked against the build's hosts; the part's own words are in ./planTexts.ts.
 *
 * When it asks: the free version only when the person presses See plans or Try again; with a licence, also once when
 * Settings opens and the list is not fresh (§4.5). The service worker holds its own limits besides. The part never
 * goes to the network itself, and a link it draws opens the site in a new tab — nothing about the person goes with it.
 */
import { cardTexts, partTexts } from './planTexts';
import { plansPartView } from '@src/plans/cards';
import { Button } from '@workspace/ui/button';
import { PlanCard, PlanList } from '@workspace/ui/plan-card';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { SourceState } from '@src/edition/source';
import type { CardAction, CardView } from '@src/plans/cards';
import type { Catalog } from '@src/plans/model';
import type { PlanSource, PlansView } from '@src/plans/source';
import type { ReactElement, ReactNode } from 'react';

/** What the composition root gives the part: the source, and the site's plans page with its host (src/licence). */
export interface PlansChoice {
  readonly source: PlanSource;
  /** The site's plans page ("See plans on {siteHost}"); absent — no such link. */
  readonly siteUrl: string | undefined;
  /** The first of the build's pay hosts, for the texts. */
  readonly siteHost: string | undefined;
}

export interface PlansPartProps extends PlansChoice {
  /** The licence's state: marks, lines and actions of the cards. */
  readonly licence: SourceState;
  /** The licence server's host, for the texts. */
  readonly host: string | undefined;
  readonly now?: () => number;
}

/** States in which the installation has a licence record: Settings opening may ask for a list that is not fresh. */
const WITH_LICENCE: ReadonlySet<SourceState['kind']> = new Set([
  'active',
  'grace',
  'expired',
  'ended',
  'revoked',
  'invalid',
]);

const usePlansView = (source: PlanSource): PlansView =>
  useSyncExternalStore(
    listener => source.subscribe(listener),
    () => source.current(),
  );

/** Re-renders at `at` (a button that waits for a time comes back by itself). */
const useRerenderAt = (at: number | undefined, now: () => number): void => {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (at === undefined) return;
    const wait = at - now();
    if (wait <= 0) return;
    const timer = setTimeout(() => setTick(t => t + 1), Math.min(wait + 50, 2 ** 31 - 1));
    return () => clearTimeout(timer);
  }, [at, now]);
};

/** A link that opens a page of the site in a new tab, its text saying so to a screen reader. */
const SiteLink = ({
  href,
  siteHost,
  primary,
  children,
}: {
  href: string;
  siteHost: string | undefined;
  primary: boolean;
  children: ReactNode;
}): ReactElement => (
  <Button asChild variant={primary ? 'default' : 'outline'} className="no-underline">
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
      {siteHost && <span className="sr-only">{cardTexts.opensInNewTab(siteHost)}</span>}
    </a>
  </Button>
);

const actionOf = (action: CardAction, siteHost: string | undefined): ReactNode =>
  action.kind === 'none' ? undefined : (
    <SiteLink href={action.href} siteHost={siteHost} primary={action.primary}>
      {action.text}
    </SiteLink>
  );

const cardOf = (card: CardView, siteHost: string | undefined): ReactElement => (
  <PlanCard
    key={card.id}
    id={`plan-${card.id}`}
    name={card.name}
    {...(card.badge !== null && { badge: card.badge })}
    {...(card.mark !== null && { mark: card.mark })}
    current={card.current}
    {...(card.price !== null && { price: card.price })}
    {...(card.priceMissing !== null && { priceMissing: card.priceMissing })}
    {...(card.priceNote !== null && { priceNote: card.priceNote })}
    {...(card.summary !== null && { summary: card.summary })}
    includes={card.includes}
    {...(card.state !== null && { state: card.state })}
    action={actionOf(card.action, siteHost)}
  />
);

export const PlansPart = ({
  source,
  siteUrl,
  siteHost,
  licence,
  host,
  now = Date.now,
}: PlansPartProps): ReactElement | null => {
  const view = usePlansView(source);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const opened = useRef(false);

  // With a licence, Settings opening asks once for a list that is not fresh; the free version never asks by itself. The
  // opening is the first known state: a licence activated later on this page is not an opening.
  useEffect(() => {
    if (opened.current || licence.kind === 'unknown') return;
    opened.current = true;
    if (!WITH_LICENCE.has(licence.kind)) return;
    void source.ready.then(first => {
      const shown = source.current().kind;
      if (first.kind === 'absent' || shown === 'fresh' || shown === 'loading') return;
      void source.refresh('opened');
    });
  }, [licence.kind, source]);

  const retryAt = view.kind === 'unavailable' ? view.retryAt : undefined;
  useRerenderAt(retryAt, now);

  if (view.kind === 'absent') return null;

  const ask = () => {
    // The button turns into the status line: the focus stays there, the cards that come do not take it.
    statusRef.current?.focus();
    void source.refresh('person');
  };

  const hostText = host ?? '';
  const site = siteHost ?? hostText;
  const waiting = retryAt !== undefined && retryAt > now();
  const tryAgain = (
    <Button type="button" variant="outline" size="sm" disabled={waiting} onClick={ask}>
      {partTexts.tryAgain}
    </Button>
  );
  const siteLink = siteUrl ? (
    <SiteLink href={siteUrl} siteHost={siteHost} primary={false}>
      {partTexts.seePlansOn(site)}
    </SiteLink>
  ) : null;

  let line: string | null = null;
  let controls: ReactNode = null;
  let list: { catalog: Catalog; fresh: boolean } | null = null;
  let busy = false;
  switch (view.kind) {
    case 'idle':
      line = partTexts.idle(hostText);
      controls = (
        <Button type="button" size="sm" onClick={ask}>
          {partTexts.seePlans}
        </Button>
      );
      break;
    case 'loading':
      if (view.stale) {
        line = partTexts.updating;
        list = { catalog: view.stale.catalog, fresh: false };
      } else {
        line = partTexts.loading;
        busy = true;
        controls = (
          <Button type="button" size="sm" disabled>
            {partTexts.loadingButton}
          </Button>
        );
      }
      break;
    case 'fresh':
      list = { catalog: view.catalog, fresh: true };
      break;
    case 'stale':
      line = partTexts.stale(view.fetchedAt);
      list = { catalog: view.catalog, fresh: false };
      controls = tryAgain;
      break;
    case 'unavailable':
      switch (view.why) {
        case 'offline':
          line = partTexts.offline;
          controls = (
            <>
              {tryAgain}
              {siteLink}
            </>
          );
          break;
        case 'server':
        case 'bad-answer':
          line = partTexts.server(hostText);
          controls = (
            <>
              {tryAgain}
              {siteLink}
            </>
          );
          break;
        case 'rate-limited':
          line = partTexts.rateLimited(retryAt ?? now());
          controls = tryAgain;
          break;
        case 'server-busy':
          line = partTexts.serverBusy(hostText, retryAt ?? now());
          controls = tryAgain;
          break;
        default:
          line = partTexts.worker;
      }
      break;
    case 'unsupported':
      line = partTexts.unsupported(site);
      controls = siteLink;
      break;
  }

  const at = now();
  const shown = list ? plansPartView(list.catalog, list.fresh ? 'fresh' : 'stale', licence, at) : null;
  // A licence whose own card has no address to manage it: the words without a link (§3.6).
  const footer = shown?.footer;
  let under: ReactNode = null;
  if (footer?.manageHref)
    under = (
      <SiteLink href={footer.manageHref} siteHost={siteHost} primary={false}>
        {footer.text}
      </SiteLink>
    );
  else if (footer && footer.text === cardTexts.manage) under = partTexts.manageOn(site);
  else if (footer) under = footer.text;
  else if (
    shown &&
    list?.catalog.manageUrl === null &&
    (licence.kind === 'active' || licence.kind === 'grace') &&
    licence.licence.paidUntil !== null
  )
    under = partTexts.manageOn(site);

  return (
    <div className="kit-settings-row" data-plans={view.kind}>
      <div className="kit-settings-text">
        <p ref={statusRef} role="status" aria-live="polite" tabIndex={-1} className="kit-settings-hint">
          {line}
        </p>
        {controls && <div className="kit-settings-buttons">{controls}</div>}
        {(shown || busy) && (
          <PlanList label={partTexts.listLabel} busy={busy}>
            {shown?.cards.map(card => cardOf(card, siteHost))}
          </PlanList>
        )}
        {under && <p className="kit-settings-hint">{under}</p>}
      </div>
    </div>
  );
};
