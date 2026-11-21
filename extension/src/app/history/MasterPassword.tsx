/**
 * The optional master password (D17). Off by default. Set: tools that handle secrets may keep them, encrypted; the
 * password is never stored, and there is no recovery — said where it is set. Locked: encrypted entries cannot be read
 * and secrets are not kept. Turning it off deletes the encrypted entries (they are secrets, which are not kept without a
 * password); forgetting it leaves the same way out.
 */
import { formatBytes, plural } from './format';
import { passwordStrength } from './passwordStrength';
import { useHistorySettings, useVaultState } from './useHistory';
import { IDLE_LOCK_MINUTES } from '@src/history/settings';
import { WrongPasswordError } from '@workspace/tools-shared/history';
import { Button } from '@workspace/ui/button';
import { Checkbox } from '@workspace/ui/checkbox';
import { Input } from '@workspace/ui/input';
import { Label } from '@workspace/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/toggle-group';
import { useState } from 'react';
import type { HistoryHost } from '@src/history/behaviors';
import type { Measure } from '@workspace/tools-shared/history';
import type { ReactElement } from 'react';

type Form = 'set' | 'change' | 'remove' | 'forgot' | null;

const Field = ({
  id,
  label,
  value,
  onChange,
  describedBy,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  describedBy?: string;
}): ReactElement => (
  <div className="kit-history-restore-field">
    <Label htmlFor={id}>{label}</Label>
    <Input
      id={id}
      type="password"
      autoComplete="new-password"
      spellCheck={false}
      value={value}
      aria-describedby={describedBy}
      onChange={e => onChange(e.target.value)}
    />
  </div>
);

export const MasterPassword = ({ host }: { host: HistoryHost }): ReactElement => {
  const vault = useVaultState(host);
  const settings = useHistorySettings(host);
  const [form, setForm] = useState<Form>(null);
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [c, setC] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [encrypted, setEncrypted] = useState<Measure | null>(null);

  const reset = (next: Form = null) => {
    setForm(next);
    setA('');
    setB('');
    setC('');
    setUnderstood(false);
  };
  const run = async (task: () => Promise<string>) => {
    setBusy(true);
    setNote(null);
    try {
      setNote(await task());
      reset();
    } catch (e) {
      setNote(
        e instanceof WrongPasswordError ? 'That is not the master password.' : 'It did not work. Nothing changed.',
      );
    } finally {
      setBusy(false);
    }
  };
  const askRemove = async (next: Form) => {
    reset(next);
    setEncrypted(await host.store.measure({ sealed: true }));
  };
  const removeEncrypted = () =>
    run(async () => {
      const removed = await host.store.delete({ sealed: true });
      await host.vault.removePassword();
      host.changed();
      return `The master password is off. Deleted ${plural(removed.records, 'encrypted entry', 'encrypted entries')}.`;
    });

  const strength = passwordStrength(form === 'change' ? b : a);
  const next = form === 'change' ? b : a;
  const repeat = form === 'change' ? c : b;
  const strong = strength.ok && next === repeat;

  return (
    <div className="kit-history-vault" data-vault={vault}>
      <h3 className="kit-settings-subtitle">Master password (optional)</h3>
      <div className="kit-settings-row">
        <div className="kit-settings-text">
          <span className="kit-settings-label">
            {vault === 'none' ? 'Not set' : vault === 'locked' ? 'Set — locked' : 'Set — unlocked'}
          </span>
          <span className="kit-settings-hint">
            With a master password, tools that handle secrets (passwords, keys, tokens) may keep them, encrypted on this
            device; without one they keep no secrets. Other entries stay unencrypted. Encrypted entries can be read only
            after you unlock; the password locks again after {settings.idleLockMinutes} minutes without activity, when
            the browser closes, or when you lock it.
          </span>
        </div>
        <div className="kit-settings-controls">
          {vault === 'none' && (
            <Button type="button" variant="outline" size="sm" onClick={() => reset('set')}>
              Set a master password…
            </Button>
          )}
          {vault === 'unlocked' && (
            <Button type="button" variant="outline" size="sm" onClick={() => host.vault.lock()}>
              Lock now
            </Button>
          )}
        </div>
      </div>

      {vault === 'locked' && (
        <form
          className="kit-history-vault-form"
          onSubmit={e => {
            e.preventDefault();
            void run(async () => {
              await host.vault.unlock(a);
              return 'Unlocked.';
            });
          }}>
          <Field id="history-unlock" label="Master password" value={a} onChange={setA} />
          <div className="kit-history-confirm-actions">
            <Button type="submit" size="sm" disabled={busy || !a}>
              {busy ? 'Unlocking…' : 'Unlock'}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => askRemove('forgot')}>
              Forgot it?
            </Button>
          </div>
        </form>
      )}

      {vault === 'unlocked' && !form && (
        <div className="kit-settings-row">
          <div className="kit-settings-text">
            <span id="settings-history-idle" className="kit-settings-label">
              Lock after
            </span>
            <span className="kit-settings-hint">Minutes without activity on the extension’s pages.</span>
          </div>
          <div className="kit-settings-controls">
            <ToggleGroup
              type="single"
              variant="segmented"
              size="sm"
              aria-labelledby="settings-history-idle"
              value={String(settings.idleLockMinutes)}
              onValueChange={(v: string) => v && host.settings.save({ ...settings, idleLockMinutes: Number(v) })}>
              {IDLE_LOCK_MINUTES.map(n => (
                <ToggleGroupItem key={n} value={String(n)}>
                  {n} min
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <Button type="button" variant="outline" size="sm" onClick={() => reset('change')}>
              Change…
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => askRemove('remove')}>
              Turn off…
            </Button>
          </div>
        </div>
      )}

      {(form === 'set' || form === 'change') && (
        <form
          className="kit-history-vault-form"
          onSubmit={e => {
            e.preventDefault();
            if (!strong || (form === 'set' && !understood)) return;
            void run(async () => {
              if (form === 'set') {
                await host.vault.setPassword(a);
                return 'The master password is set and the history is unlocked.';
              }
              await host.vault.changePassword(a, b);
              return 'The master password is changed. Nothing had to be encrypted again.';
            });
          }}>
          {form === 'change' && (
            <Field id="history-current" label="Current master password" value={a} onChange={setA} />
          )}
          <Field
            id="history-new"
            label={form === 'set' ? 'Master password' : 'New master password'}
            value={next}
            onChange={form === 'change' ? setB : setA}
            describedBy="history-strength"
          />
          <Field id="history-repeat" label="The same again" value={repeat} onChange={form === 'change' ? setC : setB} />
          <p id="history-strength" className="kit-settings-hint" role="status">
            {next
              ? strength.ok
                ? `About ${strength.bits} bits — a rough estimate made on this device.`
                : strength.problem
              : 'At least 12 characters. A few unrelated words make a good one.'}
            {repeat && next !== repeat ? ' The two do not match.' : ''}
          </p>
          {form === 'set' && (
            <div className="kit-history-vault-warning" role="note">
              <p>
                <strong>There is no way to recover this password.</strong> It is not stored anywhere — not here, not in
                an export. If you forget it, the encrypted entries cannot be read by anyone, and the only way out is to
                delete them.
              </p>
              <div className="kit-history-check">
                <Checkbox
                  id="history-understood"
                  checked={understood}
                  onCheckedChange={v => setUnderstood(v === true)}
                />
                <Label htmlFor="history-understood" className="font-normal">
                  I understand: forgotten means lost
                </Label>
              </div>
            </div>
          )}
          <div className="kit-history-confirm-actions">
            <Button
              type="submit"
              size="sm"
              disabled={busy || !strong || (form === 'set' && !understood) || (form === 'change' && !a)}>
              {form === 'set' ? 'Set the master password' : 'Change the master password'}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => reset()}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {(form === 'remove' || form === 'forgot') && encrypted && (
        <div className="kit-history-confirm" role="alertdialog" aria-labelledby="history-remove-text">
          <p id="history-remove-text">
            {form === 'forgot'
              ? 'Without the password the encrypted entries cannot be opened. '
              : 'Without a master password no secrets are kept, so the encrypted entries go with it. '}
            Delete {plural(encrypted.records, 'encrypted entry', 'encrypted entries')} (
            {formatBytes(encrypted.recordBytes + encrypted.blobBytes)}) and turn the master password off? Other entries
            stay. This cannot be undone.
          </p>
          <div className="kit-history-confirm-actions">
            <Button variant="destructive" size="sm" disabled={busy} onClick={removeEncrypted}>
              Delete the encrypted history
            </Button>
            <Button variant="outline" size="sm" onClick={() => reset()}>
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
    </div>
  );
};
