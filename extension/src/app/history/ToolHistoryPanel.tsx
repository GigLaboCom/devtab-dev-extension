/**
 * A tool's own history on its page: a line that says whether its work is being kept (always visible), and its latest
 * entries to open back in the tool. What the line says comes from the tool's declaration and the host's switches.
 */
import { formatBytes, formatClock, formatTime } from './format';
import { useHistorySettings, useHistoryVersion, useVaultState } from './useHistory';
import { kindTitle } from '@src/history/sources';
import { summaryOf } from '@workspace/tools-shared/history';
import { Button } from '@workspace/ui/button';
import { HistoryIcon, LockIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { HistoryHost } from '@src/history/behaviors';
import type { HistorySource } from '@src/history/sources';
import type { EntrySummary } from '@workspace/tools-shared/history';
import type { ReactElement } from 'react';

const RECENT = 8;

export const ToolHistoryPanel = ({
  host,
  source,
  onOpen,
}: {
  host: HistoryHost;
  source: HistorySource;
  onOpen: (id: string) => void;
}): ReactElement => {
  const settings = useHistorySettings(host);
  const vault = useVaultState(host);
  const version = useHistoryVersion(host);
  const [entries, setEntries] = useState<EntrySummary[]>([]);
  const declared = source.declaration.kinds.length > 0;
  const secrets = source.declaration.kinds.some(k => k.secret);
  const state = !declared
    ? 'none'
    : host.incognito
      ? 'incognito'
      : !settings.on || settings.off.includes(source.owner)
        ? 'off'
        : 'on';

  useEffect(() => {
    let live = true;
    if (!declared) return;
    host.store.page({ owners: [source.owner] }, { limit: RECENT }).then(page => {
      if (live) setEntries(page.rows.map(summaryOf));
    });
    return () => {
      live = false;
    };
  }, [host, source.owner, declared, version]);

  // A tool whose every kind is secret keeps nothing without a master password or while locked: the line says so,
  // never that its work is kept.
  const allSecret = declared && source.declaration.kinds.every(k => k.secret);
  const text =
    state === 'on' && allSecret
      ? {
          unlocked: 'History is on: this tool’s work is kept in this browser, encrypted.',
          locked: 'History is on, but this tool keeps secrets only: nothing is kept while the history is locked.',
          none: 'History is on, but this tool keeps secrets only: nothing is kept without a master password.',
        }[vault]
      : {
          none: 'This tool keeps no history.',
          on: 'History is on: this tool’s work is kept in this browser.',
          off: 'History is off for this tool: nothing new is kept.',
          incognito: 'Incognito window: nothing is kept.',
        }[state];
  const secretText =
    state === 'on' && secrets && !allSecret
      ? vault === 'unlocked'
        ? ' Secrets are kept encrypted.'
        : vault === 'locked'
          ? ' Secrets are not kept while the history is locked.'
          : ' Secrets are not kept (no master password).'
      : '';

  return (
    <aside className="kit-tool-history" aria-label={`${source.title} history`} data-history-state={state}>
      <p className="kit-tool-history-line" role="status">
        <HistoryIcon aria-hidden="true" />
        <span>
          {text}
          {secretText}
        </span>
        <a href="#/history">History</a>
        <a href="#/settings">Settings</a>
      </p>
      {declared && entries.length > 0 && (
        <details className="kit-tool-history-recent">
          <summary>Recent entries</summary>
          <ul className="kit-history-entries">
            {entries.map(entry => (
              <li key={entry.id} className="kit-history-entry" data-entry={entry.id}>
                <span className="kit-history-entry-time" title={formatTime(entry.time)}>
                  {formatClock(entry.time)}
                </span>
                <span className="kit-history-entry-kind">{kindTitle(host.sources, entry.owner, entry.kind)}</span>
                <span className="kit-history-entry-label">
                  {entry.encrypted && <LockIcon aria-label="Encrypted" />}
                  {entry.encrypted ? 'Encrypted entry' : (entry.label ?? '')}
                </span>
                <span className="kit-history-entry-size">{formatBytes(entry.bytes)}</span>
                <span className="kit-history-entry-actions">
                  <Button variant="ghost" size="xs" onClick={() => onOpen(entry.id)}>
                    Open
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </aside>
  );
};
