/**
 * «History» (D17): what the tools kept in this browser — the list with its filters, grouped by session; open an entry
 * back in its tool; delete what the filter shows (counted first, asked once); export what is shown or everything; and
 * restore from an export. The page names no tool: names, kinds and where an entry opens come from the sources. In a build
 * without the history (`host.included` false, D25) the section stays, with one sentence in place of all that, and nothing
 * of the history is read.
 */
import { download } from './download';
import { HISTORY_EXCLUDED } from './excluded';
import { formatBytes, plural } from './format';
import { filterOf, HistoryFilters, INITIAL_FILTER } from './HistoryFilters';
import { HistoryList } from './HistoryList';
import { HistoryStatus } from './HistoryStatus';
import { handOffRestore } from './restoreHandoff';
import { RestorePanel } from './RestorePanel';
import { useActivity, useHistoryVersion, useVaultState } from './useHistory';
import { go } from '../route';
import { createDebug } from '@extension/logger';
import { sourceOf } from '@src/history/sources';
import { isEverything, summaryOf } from '@workspace/tools-shared/history';
import { Button } from '@workspace/ui/button';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FilterState } from './HistoryFilters';
import type { HistoryHost } from '@src/history/behaviors';
import type { EntrySummary, HistoryFilter, Measure, PageCursor } from '@workspace/tools-shared/history';
import type { ReactElement } from 'react';

const debug = createDebug('extension:history');
const PAGE = 100;

type Confirm = { filter: HistoryFilter; measure: Measure; what: string } | null;

export const HistoryPage = ({ host }: { host: HistoryHost }): ReactElement =>
  host.included ? (
    <KeptHistoryPage host={host} />
  ) : (
    <section className="kit-section" aria-labelledby="history-title" data-page="history" data-history-state="excluded">
      <header className="kit-section-head">
        <div>
          <h1 id="history-title" className="kit-section-title">
            History
          </h1>
          <p className="kit-section-hint">{HISTORY_EXCLUDED.section}</p>
        </div>
      </header>
    </section>
  );

const KeptHistoryPage = ({ host }: { host: HistoryHost }): ReactElement => {
  useActivity(host);
  const version = useHistoryVersion(host);
  const vault = useVaultState(host);
  const [state, setState] = useState<FilterState>(INITIAL_FILTER);
  // "Now" moves when the filters change, so "last hour" means the hour before the user chose it.
  const [now, setNow] = useState(() => Date.now());
  const filter = useMemo(() => filterOf(state, now), [state, now]);
  const [entries, setEntries] = useState<EntrySummary[]>([]);
  const [next, setNext] = useState<PageCursor | undefined>();
  const [shown, setShown] = useState<Measure | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const request = useRef(0);

  useEffect(() => {
    const id = ++request.current;
    Promise.all([host.store.page(filter, { limit: PAGE }), host.store.measure(filter)]).then(
      ([page, measure]) => {
        if (id !== request.current) return;
        setEntries(page.rows.map(summaryOf));
        setNext(page.next);
        setShown(measure);
      },
      e => debug.warn('list', e),
    );
  }, [host, filter, version, vault]);

  const more = () => {
    if (!next) return;
    host.store.page(filter, { limit: PAGE, before: next }).then(page => {
      setEntries(list => [...list, ...page.rows.map(summaryOf)]);
      setNext(page.next);
    });
  };

  const change = (s: FilterState) => {
    setState(s);
    setNow(Date.now());
    setConfirm(null);
  };

  const askDelete = async (f: HistoryFilter, what: string) => {
    setNote(null);
    setConfirm({ filter: f, measure: await host.store.measure(f), what });
  };

  const remove = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      const removed = await host.store.delete(confirm.filter);
      setNote(
        `Deleted ${plural(removed.records, 'entry', 'entries')} and ${formatBytes(removed.recordBytes + removed.blobBytes)}.`,
      );
      setConfirm(null);
      host.changed();
    } finally {
      setBusy(false);
    }
  };

  const exportArchive = async (f: HistoryFilter) => {
    setBusy(true);
    setNote(null);
    try {
      const { records, size } = await download(host, f);
      setNote(`Saved ${plural(records, 'entry', 'entries')} in a ${formatBytes(size)} file.`);
    } catch (e) {
      setNote('The export failed. Nothing was saved.');
      debug.warn('export', e);
    } finally {
      setBusy(false);
    }
  };

  const open = (entry: EntrySummary) => {
    const source = sourceOf(host.sources, entry.owner);
    if (!source) return;
    handOffRestore(entry.owner, entry.id);
    go(source.hash);
  };

  const filtered = !isEverything(filter);
  return (
    <section className="kit-section" aria-labelledby="history-title" data-page="history">
      <header className="kit-section-head">
        <div>
          <h1 id="history-title" className="kit-section-title">
            History
          </h1>
          <p className="kit-section-hint">
            What your tools kept in this browser. It never leaves it, except in a file you export.
          </p>
        </div>
      </header>
      <div className="kit-history">
        <HistoryStatus host={host} />
        <HistoryFilters state={state} sources={host.sources} onChange={change} now={now} />
        <div className="kit-history-bar">
          <p className="kit-history-count" role="status" data-history-count={shown?.records ?? ''}>
            {shown
              ? `${plural(shown.records, 'entry', 'entries')} · ${formatBytes(shown.recordBytes + shown.blobBytes)}${filtered ? ' match the filter' : ''}`
              : ' '}
          </p>
          <div className="kit-history-actions">
            <Button
              variant="outline"
              size="sm"
              disabled={busy || !shown?.records}
              onClick={() => exportArchive(filter)}>
              {filtered ? 'Export shown' : 'Export all'}
            </Button>
            {filtered && (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => exportArchive({})}>
                Export all
              </Button>
            )}
            <RestorePanel host={host} disabled={busy} onDone={message => (setNote(message), host.changed())} />
            <Button
              variant="destructive"
              size="sm"
              disabled={busy || !shown?.records}
              onClick={() => askDelete(filter, filtered ? 'the entries the filter shows' : 'the whole history')}>
              {filtered ? 'Delete shown…' : 'Delete all…'}
            </Button>
          </div>
        </div>
        {confirm && (
          <div className="kit-history-confirm" role="alertdialog" aria-labelledby="history-confirm-text">
            <p id="history-confirm-text">
              Delete {confirm.what}: {plural(confirm.measure.records, 'entry', 'entries')} and{' '}
              {formatBytes(confirm.measure.recordBytes + confirm.measure.blobBytes)}
              {confirm.measure.blobs ? ` (with ${plural(confirm.measure.blobs, 'file')} no other entry uses)` : ''}?
              This cannot be undone.
            </p>
            <div className="kit-history-confirm-actions">
              <Button variant="destructive" size="sm" disabled={busy || !confirm.measure.records} onClick={remove}>
                Delete permanently
              </Button>
              <Button variant="outline" size="sm" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        {note && (
          <p className="kit-history-note" role="status">
            {note}
          </p>
        )}
        <HistoryList
          entries={entries}
          sources={host.sources}
          onOpen={open}
          onDelete={entry => askDelete({ ids: [entry.id] }, 'this entry')}
          empty={filtered ? 'Nothing matches the filter.' : 'Nothing kept yet. Your tools record here as you use them.'}
        />
        {next && (
          <div className="kit-history-more">
            <Button variant="outline" size="sm" onClick={more}>
              Show older entries
            </Button>
          </div>
        )}
      </div>
    </section>
  );
};
