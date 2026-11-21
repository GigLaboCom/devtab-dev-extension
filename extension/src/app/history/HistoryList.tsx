/** The History list: entries grouped by session (one stretch of work in one tool), newest first. */
import { formatBytes, formatClock, formatTime, plural } from './format';
import { kindTitle, sourceOf } from '@src/history/sources';
import { Button } from '@workspace/ui/button';
import { LockIcon, Trash2Icon } from 'lucide-react';
import type { HistorySource } from '@src/history/sources';
import type { EntrySummary } from '@workspace/tools-shared/history';
import type { ReactElement } from 'react';

interface Group {
  key: string;
  owner: string;
  entries: EntrySummary[];
}

/** Consecutive entries of one session form a group (the list is by time, so a session interrupted by another splits). */
const groups = (entries: readonly EntrySummary[]): Group[] => {
  const out: Group[] = [];
  for (const e of entries) {
    const last = out.at(-1);
    if (last && last.entries[0].session === e.session && last.owner === e.owner) last.entries.push(e);
    else out.push({ key: `${e.session}-${e.id}`, owner: e.owner, entries: [e] });
  }
  return out;
};

export const HistoryList = ({
  entries,
  sources,
  onOpen,
  onDelete,
  empty,
}: {
  entries: readonly EntrySummary[];
  sources: readonly HistorySource[];
  onOpen: (entry: EntrySummary) => void;
  onDelete: (entry: EntrySummary) => void;
  empty: string;
}): ReactElement => {
  if (!entries.length) return <p className="kit-history-empty">{empty}</p>;
  return (
    <ol className="kit-history-list" aria-label="History entries">
      {groups(entries).map(group => {
        const source = sourceOf(sources, group.owner);
        const newest = group.entries[0];
        const oldest = group.entries.at(-1)!;
        return (
          <li key={group.key} className="kit-history-session">
            <div className="kit-history-session-head">
              <span className="kit-history-session-title">{source?.title ?? `Unknown tool “${group.owner}”`}</span>
              <span className="kit-history-session-meta">
                {formatTime(oldest.time)}
                {oldest !== newest && `–${formatClock(newest.time)}`} ·{' '}
                {plural(group.entries.length, 'entry', 'entries')}
              </span>
            </div>
            <ul className="kit-history-entries">
              {group.entries.map(entry => (
                <li key={entry.id} className="kit-history-entry" data-entry={entry.id} data-kind={entry.kind}>
                  <span className="kit-history-entry-time">{formatClock(entry.time)}</span>
                  <span className="kit-history-entry-kind">{kindTitle(sources, entry.owner, entry.kind)}</span>
                  <span className="kit-history-entry-label">
                    {entry.encrypted && <LockIcon aria-label="Encrypted" />}
                    {entry.encrypted ? 'Encrypted entry' : (entry.label ?? '')}
                  </span>
                  <span className="kit-history-entry-size">{formatBytes(entry.bytes)}</span>
                  <span className="kit-history-entry-actions">
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={!source}
                      title={source ? `Open in ${source.title}` : 'No tool of this version opens it'}
                      onClick={() => onOpen(entry)}>
                      Open
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Delete the entry of ${formatTime(entry.time)}`}
                      onClick={() => onDelete(entry)}>
                      <Trash2Icon aria-hidden="true" />
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ol>
  );
};
