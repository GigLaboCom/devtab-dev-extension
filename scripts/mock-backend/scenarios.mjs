// DEVTAB_MOCK_BACKEND — development only.
//
// The mock's scenarios as data: each has a name, one line on what the server does and one on what the extension is
// expected to do (from the state tables of pro-entitlement-implementation.md §4.4, §6.7 and pro-plans-and-payment.md
// §5.4). Licence scenarios are chosen by the licence key (visibly fake keys in the server's key format, backend.md
// §5.2) or for every request by an override; faults and plans scenarios apply to every request.
import { DAY } from './contract.mjs';

const subscription = (term, paidInDays, renews = true) => ({
  status: 'active',
  term,
  renews,
  paidIn: paidInDays * DAY,
});
const MONTHLY = subscription('month', 30);

/**
 * A licence scenario:
 * - `key` (and `aliases`): the licence keys that open it;
 * - `grant`: the licence an activation signs; `check`: the licence a refresh signs (default: `grant`);
 *   `{ status, term?, renews?, paidIn: seconds from now | null, reason? }`;
 * - `activation`: an error code activation answers instead of a token;
 * - `error`: an error code every licence endpoint answers;
 * - `backdate`: seconds the mock moves `iat` back (mock only: a token as a client holds it after that long offline);
 * - `seatsTaken`, `churnUsed`: the licence starts with its seats or its 30-day activations used up;
 * - `signWith`: the signing key's role for this licence's tokens.
 */
export const LICENCE_SCENARIOS = Object.freeze([
  {
    name: 'active-monthly',
    key: 'DTD-MOCK-ACTV-MNTH-0000-0000',
    aliases: ['DTD-TEST-AAAA-BBBB-CCCC-DDDD'],
    summary: 'Activates; signs active tokens of a monthly subscription paid 30 days ahead, renewing.',
    expect: 'active: "Pro is active in this browser." Monthly is the current plan, "Renews on {paidUntil}."',
    grant: MONTHLY,
  },
  {
    name: 'active-annual',
    key: 'DTD-MOCK-ACTV-YEAR-0000-0000',
    summary: 'Activates; signs active tokens of an annual subscription paid 365 days ahead, renewing.',
    expect: 'active; Annually is the current plan, Monthly offers "Switch to Monthly".',
    grant: subscription('year', 365),
  },
  {
    name: 'last-days',
    key: 'DTD-MOCK-LAST-DAYS-0000-0000',
    summary: 'Signs active tokens issued 25 days ago: the window without the server is in its last days.',
    expect: 'grace: "Couldn’t check your licence since {checkedAt}. Pro stays until {validUntil}."; checks hourly.',
    grant: subscription('month', 20),
    backdate: 25 * DAY,
  },
  {
    name: 'expired',
    key: 'DTD-MOCK-EXPD-0000-0000-0000',
    summary: 'Signs active tokens issued 31 days ago: the window without the server is over.',
    expect: 'expired: "Pro is paused: the licence couldn’t be checked since {checkedAt}. …"; Pro features off.',
    grant: subscription('month', 20),
    backdate: 31 * DAY,
  },
  {
    name: 'cancelled',
    key: 'DTD-MOCK-CNCL-0000-0000-0000',
    summary: 'Signs active tokens of a monthly subscription cancelled but paid 10 days ahead (renews: false).',
    expect: 'active; the Monthly card says "Cancelled. Pro stays until {paidUntil}."',
    grant: subscription('month', 10, false),
  },
  {
    name: 'complimentary',
    key: 'DTD-MOCK-CMPL-0000-0000-0000',
    summary: 'Signs active tokens of a licence without a subscription (paid: null, no term or renews).',
    expect: 'active without "Paid until"; under the cards "Your licence doesn’t need a subscription."',
    grant: { status: 'active', paidIn: null },
  },
  {
    name: 'ended',
    key: 'DTD-MOCK-ENDD-0000-0000-0000',
    summary: 'Activation: 403 licence-inactive. Refresh: a signed ended token (paid yesterday, term month).',
    expect: 'activation: the licence-inactive text; after Check now: "Your Pro subscription ended on {paidUntil}. …"',
    activation: 'licence-inactive',
    grant: { status: 'ended', term: 'month', paidIn: -1 * DAY },
  },
  {
    name: 'revoked-refund',
    key: 'DTD-MOCK-RVKD-RFND-0000-0000',
    summary: 'Activation: 403 licence-inactive. Refresh: a signed revoked token, reason refund.',
    expect: 'after Check now: "This licence was refunded, so Pro is off in this browser."',
    activation: 'licence-inactive',
    grant: { status: 'revoked', reason: 'refund', paidIn: 10 * DAY },
  },
  {
    name: 'revoked-key-blocked',
    key: 'DTD-MOCK-RVKD-BLKD-0000-0000',
    summary: 'Activation: 403 key-blocked. Refresh: a signed revoked token, reason key-blocked.',
    expect: 'activation: "This licence key is blocked."; after Check now: "This licence key was blocked, …"',
    activation: 'key-blocked',
    grant: { status: 'revoked', reason: 'key-blocked', paidIn: null },
  },
  {
    name: 'revoked-deactivated',
    key: 'DTD-MOCK-RVKD-DEAC-0000-0000',
    summary: 'Activates (monthly); every refresh signs revoked, reason deactivated (freed elsewhere).',
    expect: 'after Check now: "This browser was deactivated from the licence, so Pro is off here. …"',
    grant: MONTHLY,
    check: { status: 'revoked', reason: 'deactivated', paidIn: 30 * DAY },
  },
  {
    name: 'revoked-seat-limit',
    key: 'DTD-MOCK-RVKD-SEAT-0000-0000',
    summary: 'Activates (monthly); every refresh signs revoked, reason seat-limit (released, no seat left).',
    expect: 'after Check now: "This licence is active in as many browsers as it allows, so Pro is off here. …"',
    grant: MONTHLY,
    check: { status: 'revoked', reason: 'seat-limit', paidIn: 30 * DAY },
  },
  {
    name: 'revoked-unknown-installation',
    key: 'DTD-MOCK-RVKD-GONE-0000-0000',
    summary: 'Activates (monthly); every refresh signs revoked, reason unknown-installation.',
    expect: 'after Check now: "The licence server no longer knows this browser, so Pro is off here. …"',
    grant: MONTHLY,
    check: { status: 'revoked', reason: 'unknown-installation', paidIn: null },
  },
  {
    name: 'seat-limit',
    key: 'DTD-MOCK-SEAT-0000-0000-0000',
    summary: 'Every seat of the licence is taken: activation answers 409 seat-limit.',
    expect: 'activation: "This licence is already active in as many browsers as it allows. …"; nothing stored.',
    grant: MONTHLY,
    seatsTaken: true,
  },
  {
    name: 'activation-churn',
    key: 'DTD-MOCK-CHRN-0000-0000-0000',
    summary: 'Seats are free but 3 × seats new activations happened in 30 days: activation answers 409 seat-limit.',
    expect: 'activation: the seat-limit text, the same as a full licence (amendment А6).',
    grant: MONTHLY,
    churnUsed: true,
  },
  {
    name: 'standby-key',
    key: 'DTD-MOCK-STBY-0000-0000-0000',
    summary: 'Like active-monthly, but this licence’s tokens are signed with the standby key p2.',
    expect: 'a build that trusts both keys: active; a build with p1 only: unknown-key, nothing changes.',
    grant: MONTHLY,
    signWith: 'p2',
  },
  {
    name: 'key-unknown',
    key: 'DTD-MOCK-0000-0000-0000-0000',
    summary: 'Activation: 404 key-unknown (so does any key not listed). Refresh: revoked, unknown-installation.',
    expect: 'activation: "This licence key isn’t known. Check that you copied all of it."',
    activation: 'key-unknown',
    grant: { status: 'revoked', reason: 'unknown-installation', paidIn: null },
  },
  {
    name: 'bad-request',
    key: 'DTD-MOCK-BADR-0000-0000-0000',
    summary: 'Answers 400 bad-request (as if the body broke the contract).',
    expect: 'treated as "couldn’t reach": "Couldn’t reach the licence server. …"; nothing stored.',
    error: 'bad-request',
    grant: MONTHLY,
  },
  {
    name: 'rate-limited',
    key: 'DTD-MOCK-RATE-0000-0000-0000',
    summary: 'Answers 429 rate-limited with Retry-After in seconds (default 120).',
    expect: '"Too many attempts. Try again after {time}."; no new request before that time.',
    error: 'rate-limited',
    grant: MONTHLY,
  },
]);

/** Transport-level faults: they apply to every endpoint in `faultOn` (default: all four) until switched off. */
export const FAULTS = Object.freeze([
  { name: 'none', summary: 'Answers normally.', expect: 'as the scenario says.' },
  {
    name: 'drop',
    summary: 'Closes the connection without an answer (stop the mock for a refused connection).',
    expect: 'offline: nothing changes, failures grow; activation "Couldn’t reach the licence server. …"',
  },
  {
    name: 'timeout',
    summary: 'Never answers; the client gives up after its 10 s timeout.',
    expect: 'offline (timeout): nothing changes.',
  },
  {
    name: 'slow',
    summary: 'Answers normally after `delayMs` (default 3000).',
    expect: 'under 10 s: as the scenario; over 10 s: as timeout.',
  },
  {
    name: 'http-500',
    summary: 'Answers 500 with a JSON error body outside the contract’s codes.',
    expect: 'server: nothing changes; Check now "Couldn’t reach the licence server, so nothing was changed."',
  },
  {
    name: 'http-503',
    summary: 'Answers 503 unavailable without Retry-After (the server’s processing timeout).',
    expect: 'server: nothing changes.',
  },
  {
    name: 'portal',
    summary: 'Answers 200 with an HTML page, like a guest Wi-Fi portal.',
    expect: 'not JSON → server: nothing changes.',
  },
  {
    name: 'redirect',
    summary: 'Answers 302 to another address.',
    expect: 'the client fetches with redirect: "error" → server: nothing changes.',
  },
  {
    name: 'too-large',
    summary: 'Answers 200 with a JSON body one byte over the client’s limit (16 KB; plans 32 KB).',
    expect: 'too large → server: nothing changes.',
  },
  {
    name: 'bad-signature',
    summary: 'Signs as usual, then flips one bit of the signature.',
    expect: 'bad-answer: "The licence server’s answer couldn’t be verified, so nothing was changed. …"',
  },
  {
    name: 'unknown-kid',
    summary: 'Signs with a key whose id no build knows.',
    expect: 'unknown-key → bad-answer: nothing changes.',
  },
  {
    name: 'replay',
    summary: 'Answers with the oldest token issued to this installation (an older iat after any later answer).',
    expect: 'refresh: not accepted (older) → bad-answer; the held token and its exp stay.',
  },
]);

const PAY_HOST = 'web.example.invalid';
export const PAY_HOSTS = Object.freeze([PAY_HOST]);
const site = path => `https://${PAY_HOST}${path}`;

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
const PRO_MONTHLY = {
  id: 'pro-monthly',
  kind: 'paid',
  term: 'month',
  name: 'Monthly',
  summary: 'Pro, billed every month.',
  includes: ['Tool history and its archive', 'Tools remember your options', 'Copy automatically after generating'],
  price: { amount: 1111, currency: 'XTS' },
  priceNote: 'Tax calculated at checkout.',
  badge: null,
  checkoutUrl: site('/pro/checkout/?plan=pro-monthly'),
  until: null,
};
const PRO_ANNUAL = {
  id: 'pro-annual',
  kind: 'paid',
  term: 'year',
  name: 'Annually',
  summary: 'Pro, billed once a year.',
  includes: ['Everything in Monthly'],
  price: { amount: 11110, currency: 'XTS' },
  priceNote: 'Tax calculated at checkout.',
  badge: 'Save with a year',
  checkoutUrl: site('/pro/checkout/?plan=pro-annual'),
  until: null,
};

/** The catalog of plans §4.3 with placeholders only (currency XTS, amounts 1111 and 11110, hosts in .invalid). */
const catalog = (plans, extra = {}) => ({
  v: 1,
  catalog: 'mock-2026-11-23.1',
  maxAge: 86_400,
  manageUrl: site('/pro/manage/'),
  plans,
  ...extra,
});

/** Plans scenarios: `body(nowSeconds)` builds the catalog; `error` answers an error instead. */
export const PLANS_SCENARIOS = Object.freeze([
  {
    name: 'three',
    summary: 'The three plans Free, Monthly, Annually (placeholder prices XTS 11.11 and XTS 111.10).',
    expect: 'fresh: three cards with prices; Free is the current plan without a licence.',
    body: () => catalog([FREE, PRO_MONTHLY, PRO_ANNUAL]),
  },
  {
    name: 'withdrawn',
    summary: 'Annually is withdrawn: a newer catalog with Free and Monthly only.',
    expect: 'two cards; a licence with term year has no current card and a "Manage subscription" link.',
    body: () => ({ ...catalog([FREE, PRO_MONTHLY]), catalog: 'mock-2026-11-23.2' }),
  },
  {
    name: 'extra-unknown',
    summary: 'An unknown extra plan (kind "team") and unknown fields in the catalog and in every plan.',
    expect: 'unknown fields ignored; the team plan dropped (kind); the three cards show.',
    body: () =>
      catalog(
        [
          FREE,
          { ...PRO_MONTHLY, seats: 3, highlight: 'blue' },
          { ...PRO_ANNUAL, seats: 3 },
          { ...PRO_MONTHLY, id: 'pro-team', kind: 'team', name: 'Team', seats: 10 },
        ],
        { region: 'mock', features: ['history'] },
      ),
  },
  {
    name: 'empty',
    summary: 'An empty list of plans.',
    expect: 'empty → bad-answer: the cache stays; without one "Couldn’t load the plans from {host}. …"',
    body: () => catalog([]),
  },
  {
    name: 'bad-pay-host',
    summary: 'Annually’s checkout address is on a host the build does not allow.',
    expect: 'Annually dropped (url); Free and Monthly show; Monthly links to web.example.invalid.',
    body: () =>
      catalog([
        FREE,
        PRO_MONTHLY,
        { ...PRO_ANNUAL, checkoutUrl: 'https://pay.elsewhere.invalid/checkout?plan=pro-annual' },
      ]),
  },
  {
    name: 'stale-max-age',
    summary: 'maxAge 1 second, below the client’s bounds (it keeps 1 hour): the list goes stale soon.',
    expect: 'fresh for 1 h, then stale: "These plans are from {date}. …" and "Price not shown".',
    body: () => ({ ...catalog([FREE, PRO_MONTHLY, PRO_ANNUAL]), maxAge: 1 }),
  },
  {
    name: 'unsupported',
    summary: 'A catalog of format v 2.',
    expect: 'unsupported: "This version of the extension can’t read the current plans. …"; the cache stays.',
    body: () => ({ ...catalog([FREE, PRO_MONTHLY, PRO_ANNUAL]), v: 2 }),
  },
  {
    name: 'offer-ended',
    summary: 'A limited offer whose `until` passed yesterday, next to the three plans.',
    expect: 'the offer is not shown; the three cards show.',
    body: now =>
      catalog([
        FREE,
        PRO_MONTHLY,
        PRO_ANNUAL,
        { ...PRO_ANNUAL, id: 'pro-annual-offer', name: 'Annual offer', until: now - DAY },
      ]),
  },
  {
    name: 'rate-limited',
    summary: 'Answers 429 rate-limited with Retry-After in seconds.',
    expect: '"Too many attempts. Try again after {time}."; Try again disabled until then.',
    error: 'rate-limited',
  },
]);

export const licenceScenario = name => LICENCE_SCENARIOS.find(s => s.name === name);
export const plansScenario = name => PLANS_SCENARIOS.find(s => s.name === name);
export const fault = name => FAULTS.find(f => f.name === name);
