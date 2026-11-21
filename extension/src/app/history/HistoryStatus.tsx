/**
 * One line that says whether history is being kept here and now — on the History page and, for one tool, on its page
 * (ToolHistoryPanel). Off, incognito and unavailable are said plainly; a master password adds whether it is locked.
 */
import { useHistorySettings, useVaultState } from './useHistory';
import { Button } from '@workspace/ui/button';
import { HistoryIcon, LockIcon, LockOpenIcon } from 'lucide-react';
import type { HistoryHost } from '@src/history/behaviors';
import type { ReactElement } from 'react';

export const HistoryStatus = ({ host }: { host: HistoryHost }): ReactElement => {
  const settings = useHistorySettings(host);
  const vault = useVaultState(host);
  const state = host.incognito ? 'incognito' : settings.on ? 'on' : 'off';
  const text = {
    on: 'History is on: your tools keep their work in this browser.',
    off: 'History is off: nothing new is kept. What was kept stays until you delete it.',
    incognito: 'This is an incognito window: nothing is kept.',
  }[state];
  return (
    <div className="kit-history-status" data-history-state={state} role="status">
      <HistoryIcon aria-hidden="true" />
      <span>{text}</span>
      {vault !== 'none' && (
        <span className="kit-history-lock" data-vault={vault}>
          {vault === 'locked' ? <LockIcon aria-hidden="true" /> : <LockOpenIcon aria-hidden="true" />}
          {vault === 'locked' ? 'Encrypted entries are locked.' : 'Unlocked.'}
          {vault === 'unlocked' && (
            <Button variant="ghost" size="xs" onClick={() => host.vault.lock()}>
              Lock now
            </Button>
          )}
        </span>
      )}
      <a className="kit-history-status-link" href="#/settings">
        Settings
      </a>
    </div>
  );
};
