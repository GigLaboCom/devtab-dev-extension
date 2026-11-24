/**
 * The line over the History section in a build that follows a licence (pro-entitlement §6.7.5): while the licence is in
 * its grace period (over the history, which still records) or Pro is off because of it — expired, ended, revoked, not
 * verified (over the sentence of D25) — the state's line of Settings → Pro and a link there. Nothing in the free state,
 * with an active licence, or in a build whose edition is fixed.
 */
import { proTexts, stateLine } from '../settings/proTexts';
import { useLicenceState } from '../useHostEdition';
import type { SourceState } from '@src/edition/source';
import type { HistoryHost } from '@src/history/behaviors';
import type { ReactElement } from 'react';

const SHOWN: ReadonlySet<SourceState['kind']> = new Set(['grace', 'expired', 'ended', 'revoked', 'invalid']);

export const LicenceNotice = ({ host }: { host: Pick<HistoryHost, 'licence' | 'onEdition'> }): ReactElement | null => {
  const state = useLicenceState(host);
  if (!state || !SHOWN.has(state.kind)) return null;
  return (
    <p className="kit-history-status" role="status" data-licence-notice={state.kind}>
      <span>{stateLine(state)}</span>
      <a className="kit-history-status-link" href="#/settings">
        {proTexts.openSettings}
      </a>
    </p>
  );
};
