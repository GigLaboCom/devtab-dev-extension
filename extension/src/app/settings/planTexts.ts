/**
 * The extension's own words around the Pro plans (the frame; everything about a plan — its name, price, lines, badge —
 * comes from the server). Dates in en-US with the medium style, times with the short one; the apostrophe is ’.
 * `{host}` is the licence server's host, `{siteHost}` the first of the build's pay hosts, `{name}` a plan's name from
 * the server, `{paidUntil}` the token's `paid`.
 */
const dateText = (ms: number): string => new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(ms);
const timeText = (ms: number): string => new Intl.DateTimeFormat('en-US', { timeStyle: 'short' }).format(ms);

/** The words of a plan card, by the licence's state. */
export const cardTexts = {
  currentPlan: 'Current plan',
  yourPlan: 'Your plan',
  renewsOn: (paidUntil: number) => `Renews on ${dateText(paidUntil)}.`,
  cancelled: (paidUntil: number) => `Cancelled. Pro stays until ${dateText(paidUntil)}.`,
  paused: 'Paused until the licence is checked.',
  endedOn: (paidUntil: number) => `Ended on ${dateText(paidUntil)}.`,
  choose: (name: string) => `Choose ${name}`,
  renew: (name: string) => `Renew ${name}`,
  switchTo: (name: string) => `Switch to ${name}`,
  manage: 'Manage subscription',
  priceNotShown: 'Price not shown',
  noSubscription: 'Your licence doesn’t need a subscription.',
  /** Hidden after a pay link's text. */
  opensInNewTab: (siteHost: string) => ` (opens ${siteHost} in a new tab)`,
} as const;

/** The words of the plans part, by what the plan source shows. */
export const partTexts = {
  listLabel: 'Pro plans',
  idle: (host: string) =>
    `See the Pro plans and their prices. This downloads the list from ${host}; nothing about you is sent.`,
  seePlans: 'See plans',
  loading: 'Loading plans…',
  loadingButton: 'Loading…',
  updating: 'Updating plans…',
  stale: (fetchedAt: number) =>
    `These plans are from ${dateText(fetchedAt)}. Couldn’t update them, so prices aren’t shown.`,
  tryAgain: 'Try again',
  offline: 'Couldn’t load the plans. Check your connection and try again.',
  server: (host: string) => `Couldn’t load the plans from ${host}. Try again later.`,
  rateLimited: (retryAt: number) => `Too many attempts. Try again after ${timeText(retryAt)}.`,
  serverBusy: (host: string, retryAt: number) =>
    `Couldn’t load the plans: ${host} is busy. Try again after ${timeText(retryAt)}.`,
  worker: 'The extension was just updated. Reload this page and try again.',
  unsupported: (siteHost: string) =>
    `This version of the extension can’t read the current plans. Update the extension, or see the plans on ${siteHost}.`,
  seePlansOn: (siteHost: string) => `See plans on ${siteHost}`,
  manageOn: (siteHost: string) => `Manage your subscription on ${siteHost}.`,
} as const;
