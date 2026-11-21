/**
 * "Restore from file…": pick an export, see what it holds (every checksum is verified before anything is written), give
 * the file's password when its encrypted entries need it, restore. Each kind of refusal has its own message.
 */
import { formatBytes, formatTime, plural } from './format';
import product from '../../../product.json';
import { createDebug } from '@extension/logger';
import { ImportError } from '@workspace/tools-shared/history';
import { Button } from '@workspace/ui/button';
import { Input } from '@workspace/ui/input';
import { Label } from '@workspace/ui/label';
import { useRef, useState } from 'react';
import type { HistoryHost } from '@src/history/behaviors';
import type { ArchiveInspection, ArchiveProblem, ImportReport, KeyringPlan } from '@workspace/tools-shared/history';
import type { ReactElement } from 'react';

const debug = createDebug('extension:history');

export const problemText = (problem: ArchiveProblem): string => {
  switch (problem.code) {
    case 'not-zip':
      return 'This file is not a history export: it is not a ZIP archive. Nothing was imported.';
    case 'foreign':
      return 'This ZIP archive is not a history export (it has no tool-history manifest). Nothing was imported.';
    case 'newer':
      return `This export was made by a newer version of ${product.name} (format ${problem.version}); this version reads format 1. Update ${product.name} to restore it. Nothing was imported.`;
    case 'damaged':
      return `The file is damaged (${problem.detail}). Nothing was imported.`;
  }
};

export const reportText = (r: ImportReport): string =>
  [
    `Restored ${plural(r.added, 'entry', 'entries')}.`,
    r.same ? `${plural(r.same, 'entry', 'entries')} were already here.` : '',
    r.conflicts
      ? `${plural(r.conflicts, 'entry', 'entries')} differed from the ones here; the ones here were kept.`
      : '',
    r.skippedEncrypted
      ? `${plural(r.skippedEncrypted, 'encrypted entry', 'encrypted entries')} left out: they need the password the file was made with.`
      : '',
    r.keyring === 'take' ? 'The file’s master password is now this history’s master password.' : '',
  ]
    .filter(Boolean)
    .join(' ');

const planText = (plan: KeyringPlan, encrypted: number): string => {
  if (!encrypted) return '';
  switch (plan.plan) {
    case 'take':
      return `${plural(encrypted, 'entry', 'entries')} are encrypted. This history has no master password, so the file’s password becomes its master password.`;
    case 'same':
      return `${plural(encrypted, 'entry', 'entries')} are encrypted with this history’s own key.`;
    case 'adopt':
      return `${plural(encrypted, 'entry', 'entries')} are encrypted with another master password. Give it to bring them in (this history must be unlocked); without it they are left out.`;
    default:
      return '';
  }
};

export const RestorePanel = ({
  host,
  disabled,
  onDone,
}: {
  host: HistoryHost;
  disabled: boolean;
  onDone: (message: string) => void;
}): ReactElement => {
  const input = useRef<HTMLInputElement>(null);
  const [inspection, setInspection] = useState<ArchiveInspection | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setMessage('Checking the file…');
    setInspection(null);
    try {
      const result = await host.archive.inspect(file);
      if (result.ok) {
        setInspection(result);
        setMessage(null);
      } else setMessage(problemText(result.problem));
    } catch (e) {
      setMessage('The file could not be read. Nothing was imported.');
      debug.warn('inspect', e);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const restore = async () => {
    if (!inspection) return;
    setBusy(true);
    try {
      const plan = host.archive.plan(inspection, host.vault);
      const report = await host.archive.restore(host.store, inspection, {
        vault: host.vault,
        ...(plan.plan === 'adopt' && password ? { password } : {}),
      });
      setInspection(null);
      setPassword('');
      setMessage(null);
      onDone(reportText(report));
    } catch (e) {
      setMessage(e instanceof ImportError ? e.message : 'The restore failed. Nothing was imported.');
      debug.warn('restore', e);
    } finally {
      setBusy(false);
    }
  };

  const plan = inspection ? host.archive.plan(inspection, host.vault) : null;
  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".zip,application/zip"
        hidden
        aria-label="History export to restore"
        data-history-restore-input
        onChange={e => pick(e.target.files?.[0])}
      />
      <Button variant="outline" size="sm" disabled={disabled || busy} onClick={() => input.current?.click()}>
        Restore from file…
      </Button>
      {(inspection || message) && (
        <div className="kit-history-restore" role="region" aria-label="Restore from file">
          {message && (
            <p className="kit-history-note" role="status">
              {message}
            </p>
          )}
          {inspection && plan && (
            <>
              <p>
                {plural(inspection.summary.records, 'entry', 'entries')} and {plural(inspection.summary.blobs, 'file')}{' '}
                ({formatBytes(inspection.summary.recordBytes + inspection.summary.blobBytes)}), exported by{' '}
                {inspection.manifest.producer?.name ?? 'an unknown producer'} on{' '}
                {formatTime(Date.parse(inspection.manifest.created))}. Every checksum matches.
                {inspection.newerReadable &&
                  ' It is of a newer format; what this version does not know is kept as it is.'}
              </p>
              {planText(plan, inspection.summary.encryptedRecords) && (
                <p>{planText(plan, inspection.summary.encryptedRecords)}</p>
              )}
              {plan.plan === 'adopt' && inspection.summary.encryptedRecords > 0 && (
                <div className="kit-history-restore-field">
                  <Label htmlFor="history-restore-password">The file’s master password</Label>
                  <Input
                    id="history-restore-password"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                  />
                </div>
              )}
              <div className="kit-history-confirm-actions">
                <Button size="sm" disabled={busy} onClick={restore}>
                  Restore
                </Button>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => setInspection(null)}>
                  Cancel
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
};
