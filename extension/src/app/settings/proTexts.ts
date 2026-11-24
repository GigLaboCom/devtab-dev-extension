/**
 * The words of Settings → Pro, of the line over the History section and of the licence's lines in Your data
 * (pro-entitlement §6.7, pro-plans-and-payment §5.7). Words only: no price and no link to buy — what a plan costs and
 * where it is bought come from the server and are drawn by the plans part (./PlansPart.tsx, ./planTexts.ts). Dates in
 * en-US with the medium style ("Nov 23, 2026"), times with the short one ("3:05 PM"); the apostrophe is ’. `{host}` is
 * the licence server's host.
 */
import type { SourceState } from '@src/edition/source';
import type { LicenceError } from '@src/shared/licenceMessages';

const dateText = (ms: number): string => new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(ms);
const timeText = (ms: number): string => new Intl.DateTimeFormat('en-US', { timeStyle: 'short' }).format(ms);

/** The block's own words, by the licence's state (§6.7.2). */
export const proTexts = {
  title: 'Pro',
  reading: 'Reading the licence…',
  /** The group's hint in the free state. */
  intro:
    'Every tool works in full in this version. Pro adds memory: the tool history and its archive, tools that remember your options, and copying automatically after generating.',
  /** Over the key field in the free state, under the plans. */
  alreadyBought: 'Already bought Pro? Paste your licence key.',
  active: 'Pro is active in this browser.',
  checkedOn: (checkedAt: number) => `Licence checked on ${dateText(checkedAt)}.`,
  /** Follows `checkedOn` when the licence has a paid date. */
  paidUntil: (paidUntil: number) => ` Paid until ${dateText(paidUntil)}.`,
  grace: (checkedAt: number, validUntil: number) =>
    `Couldn’t check your licence since ${dateText(checkedAt)}. Pro stays until ${dateText(validUntil)}.`,
  expired: (checkedAt: number) =>
    `Pro is paused: the licence couldn’t be checked since ${dateText(checkedAt)}. Connect to the internet, check that your computer’s clock is right, and press Check now.`,
  ended: (paidUntil: number) =>
    `Your Pro subscription ended on ${dateText(paidUntil)}. If you renewed it, press Check now.`,
  revoked: {
    refund: 'This licence was refunded, so Pro is off in this browser.',
    deactivated:
      'This browser was deactivated from the licence, so Pro is off here. To use Pro here again, activate a key.',
    'key-blocked': 'This licence key was blocked, so Pro is off in this browser.',
    'seat-limit':
      'This licence is active in as many browsers as it allows, so Pro is off here. Deactivate it in another browser, then activate here again.',
    'unknown-installation':
      'The licence server no longer knows this browser, so Pro is off here. Activate your key again.',
  },
  invalid: 'The licence stored in this browser couldn’t be verified, so Pro is off. Activate your key again.',
  keyLabel: 'Licence key',
  keyPlaceholder: 'Paste your licence key',
  disclosure: (host: string) =>
    `Activating sends this key to ${host} to check it. After that, about once a week while you use the extension, it sends this installation’s random number and a secret issued for it — nothing about what you do in the tools.`,
  /** In place of the field and its button in a build without a server. */
  cannotActivate: 'Pro can’t be activated in this build.',
  activate: 'Activate',
  activating: 'Activating…',
  checkNow: 'Check now',
  deactivateInBrowser: 'Deactivate in this browser',
  remove: 'Remove from this browser',
  confirmDeactivate: 'Deactivate Pro in this browser? Your history and saved options stay in this browser.',
  deactivate: 'Deactivate',
  cancel: 'Cancel',
  deactivated: 'Deactivated in this browser.',
  checked: 'Checked just now.',
  /** The link of the line over the History section. */
  openSettings: 'Open Settings',
} as const;

/** The line of a state (`role="status"`); the free state has none. */
export const stateLine = (state: SourceState): string | null => {
  switch (state.kind) {
    case 'unknown':
      return proTexts.reading;
    case 'active':
      return proTexts.active;
    case 'grace':
      return proTexts.grace(state.licence.checkedAt, state.licence.validUntil);
    case 'expired':
      return proTexts.expired(state.licence.checkedAt);
    case 'ended':
      // An ended licence has its paid date; a token without one says when the server signed the end.
      return proTexts.ended(state.licence.paidUntil ?? state.licence.validUntil);
    case 'revoked':
      return proTexts.revoked[state.reason];
    case 'invalid':
      return proTexts.invalid;
    default:
      // free, and a fixed edition (never shown: a fixed build has no block)
      return null;
  }
};

/** What an action that failed says (§6.7.4); `activating` picks the words of a server that could not be reached. */
export const errorText = (error: LicenceError, activating: boolean, retryAt: number): string => {
  switch (error) {
    case 'malformed-key':
      return 'This doesn’t look like a licence key. Check that you copied all of it.';
    case 'key-unknown':
      return 'This licence key isn’t known. Check that you copied all of it.';
    case 'seat-limit':
      return 'This licence is already active in as many browsers as it allows. Deactivate it in another browser first.';
    case 'key-blocked':
      return 'This licence key is blocked.';
    case 'licence-inactive':
      return 'This licence isn’t active: the subscription ended or the purchase was refunded.';
    case 'offline':
    case 'server':
      return activating
        ? 'Couldn’t reach the licence server. Check your connection and try again.'
        : 'Couldn’t reach the licence server, so nothing was changed.';
    case 'rate-limited':
      return `Too many attempts. Try again after ${timeText(retryAt)}.`;
    case 'server-busy':
      return `The licence server is busy. Try again after ${timeText(retryAt)}.`;
    case 'bad-answer':
      return 'The licence server’s answer couldn’t be verified, so nothing was changed. Try again later.';
    case 'busy':
      return 'Another tab is doing this right now. Try again in a moment.';
    case 'unavailable':
      return 'Pro can’t be activated in this build.';
    default:
      // worker, version, refused
      return 'The extension was just updated. Reload this page and try again.';
  }
};

/** The words of Settings → Your data in a build that follows a licence (§6.7.5; pro-plans-and-payment §5.7). */
export const yourDataTexts = {
  /** The end of the paragraph today, as the fixed builds keep it. */
  nothingSent: 'Nothing is sent anywhere until you press Enter on a web search',
  /** The same words in the free state. */
  nothingSentFree: 'Nothing is sent anywhere until you press Enter on a web search or ask to see the Pro plans',
  /** The same words with a licence that is not in the free state. */
  nothingSentLicence:
    'Apart from the licence check below, nothing is sent anywhere until you press Enter on a web search',
  plans: (host: string) =>
    `Pro plans: when you press See plans in Settings → Pro, the extension downloads the list of plans from ${host}. The request carries nothing about you, and the list is kept in this browser to show it again.`,
  licence: (host: string) =>
    `Licence: about once a week while you use the extension, it sends this licence’s number, this installation’s random number and a secret issued for it to ${host} to keep Pro active, and downloads the plans list when you open Settings and it is older than a day. Nothing you type, paste or open in the tools, no settings and no history are ever sent.`,
} as const;
