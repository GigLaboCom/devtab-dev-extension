/**
 * Settings → History (D17), mounted by one line in SettingsPage: the master switch, how long entries are kept, the size
 * budget, the storage used, what each tool keeps (from the definitions, with a switch per tool), the optional master
 * password, and "Delete everything".
 */
import { formatBytes, plural } from './format';
import { MasterPassword } from './MasterPassword';
import { useHistorySettings, useHistoryStats } from './useHistory';
import { isBare } from '../route';
import { createDebug } from '@extension/logger';
import { BUDGET_MIB, RETENTION_DAYS } from '@src/history/settings';
import { Button } from '@workspace/ui/button';
import { Label } from '@workspace/ui/label';
import { Switch } from '@workspace/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/toggle-group';
import { useState } from 'react';
import type { HistoryHost } from '@src/history/behaviors';
import type { HistorySettings as Settings } from '@src/history/settings';
import type { Measure } from '@workspace/tools-shared/history';
import type { ReactElement } from 'react';

const debug = createDebug('extension:history');

const days = (n: number) => (n === 365 ? '1 year' : `${n} days`);
const budget = (n: number) => (n >= 1024 ? `${n / 1024} GB` : `${n} MB`);

export const HistorySettings = ({ host }: { host: HistoryHost }): ReactElement => {
  const settings = useHistorySettings(host);
  const stats = useHistoryStats(host);
  const [wipe, setWipe] = useState<Measure | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const save = (next: Settings) => host.settings.save(next).catch(e => debug.warn('save', e));
  const recordable = host.sources.filter(s => s.declaration.kinds.length > 0);
  const silent = host.sources.filter(s => s.declaration.kinds.length === 0);

  const deleteAll = async () => {
    const removed = await host.store.delete({});
    setWipe(null);
    setNote(
      `Deleted ${plural(removed.records, 'entry', 'entries')} and ${formatBytes(removed.recordBytes + removed.blobBytes)}.`,
    );
    host.changed();
  };

  return (
    <section className="kit-settings-group" aria-labelledby="settings-history" data-settings="history">
      <h2 id="settings-history" className="kit-settings-group-title">
        History
      </h2>
      <p className="kit-settings-hint kit-settings-intro">
        Tools keep what you did in them — inputs, options and results — so you can open it again. It stays in this
        browser (never sent anywhere) and is deleted after the time you choose. Incognito windows keep nothing.
      </p>
      <div className="kit-settings-row">
        <div className="kit-settings-text">
          <Label htmlFor="settings-history-on" className="kit-settings-label">
            Keep a history of my tools
          </Label>
          <span id="settings-history-on-hint" className="kit-settings-hint">
            Off: nothing new is kept. What was kept stays until it is deleted.
          </span>
        </div>
        <div className="kit-settings-controls">
          <Switch
            id="settings-history-on"
            aria-describedby="settings-history-on-hint"
            checked={settings.on}
            onCheckedChange={on => save({ ...settings, on })}
          />
        </div>
      </div>
      <div className="kit-settings-row">
        <div className="kit-settings-text">
          <span id="settings-history-retention" className="kit-settings-label">
            Keep entries for
          </span>
          <span className="kit-settings-hint">Older entries are deleted by themselves.</span>
        </div>
        <ToggleGroup
          type="single"
          variant="segmented"
          size="sm"
          aria-labelledby="settings-history-retention"
          value={String(settings.retentionDays)}
          onValueChange={(v: string) => v && save({ ...settings, retentionDays: Number(v) })}>
          {RETENTION_DAYS.map(n => (
            <ToggleGroupItem key={n} value={String(n)}>
              {days(n)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div className="kit-settings-row">
        <div className="kit-settings-text">
          <span id="settings-history-budget" className="kit-settings-label">
            Use at most
          </span>
          <span className="kit-settings-hint" data-history-used>
            {stats
              ? `Now: ${plural(stats.records, 'entry', 'entries')}, ${formatBytes(stats.recordBytes + stats.blobBytes)} (${plural(stats.blobs, 'file')}). Over the limit, the oldest entries go first.`
              : 'Now: unknown.'}
          </span>
        </div>
        <ToggleGroup
          type="single"
          variant="segmented"
          size="sm"
          aria-labelledby="settings-history-budget"
          value={String(settings.budgetMiB)}
          onValueChange={(v: string) => v && save({ ...settings, budgetMiB: Number(v) })}>
          {BUDGET_MIB.map(n => (
            <ToggleGroupItem key={n} value={String(n)}>
              {budget(n)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <h3 className="kit-settings-subtitle">What each tool keeps</h3>
      {recordable.map(source => {
        const id = `settings-history-owner-${source.owner}`;
        return (
          <div key={source.owner} className="kit-settings-row" data-history-owner={source.owner}>
            <div className="kit-settings-text">
              <Label htmlFor={id} className="kit-settings-label">
                {source.title}
              </Label>
              <span id={`${id}-hint`} className="kit-settings-hint">
                Keeps: {source.declaration.records} Never: {source.declaration.never}
              </span>
            </div>
            <div className="kit-settings-controls">
              <Switch
                id={id}
                aria-describedby={`${id}-hint`}
                checked={!settings.off.includes(source.owner)}
                disabled={!settings.on}
                onCheckedChange={on =>
                  save({
                    ...settings,
                    off: on ? settings.off.filter(o => o !== source.owner) : [...settings.off, source.owner],
                  })
                }
              />
            </div>
          </div>
        );
      })}
      {silent.length > 0 && (
        <p className="kit-settings-hint kit-settings-prose">Keep nothing: {silent.map(s => s.title).join(', ')}.</p>
      )}

      <MasterPassword host={host} />

      <div className="kit-settings-actions">
        {/* Without the frame (the options page in Chrome's dialog) History opens in a tab of its own, framed. */}
        <a
          className="kit-history-status-link"
          {...(isBare(window.location.search)
            ? { href: 'index.html#/history', target: '_blank', rel: 'noopener' }
            : { href: '#/history' })}>
          Open History
        </a>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={!stats?.records}
          onClick={async () => {
            setNote(null);
            setWipe(await host.store.measure({}));
          }}>
          Delete everything…
        </Button>
      </div>
      {wipe && (
        <div className="kit-history-confirm" role="alertdialog" aria-labelledby="settings-history-wipe">
          <p id="settings-history-wipe">
            Delete the whole history: {plural(wipe.records, 'entry', 'entries')} and{' '}
            {formatBytes(wipe.recordBytes + wipe.blobBytes)}? This cannot be undone.
          </p>
          <div className="kit-history-confirm-actions">
            <Button variant="destructive" size="sm" onClick={deleteAll}>
              Delete permanently
            </Button>
            <Button variant="outline" size="sm" onClick={() => setWipe(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {note && (
        <p className="kit-settings-note" role="status">
          {note}
        </p>
      )}
    </section>
  );
};
