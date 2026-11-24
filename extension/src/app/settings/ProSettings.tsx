/**
 * Settings → Pro (pro-entitlement §6.7): the licence's state in one line, the Pro plans (./PlansPart.tsx), and the
 * controls — the key field with what activating sends, Check now, Deactivate in this browser, Remove from this browser.
 * Drawn only where the build follows a licence (`HistoryHost.licence`, source `licensed`); a build whose edition is
 * fixed (`fixedPro`, `fixedFree`) has no block at all. Everything goes through the licence's controls
 * (src/edition/licenceClient.ts): the service worker alone talks to the server and writes the records, and the new state
 * reaches every open tab through storage. The key is kept nowhere but in the field while it is typed.
 */
import { PlansPart } from './PlansPart';
import { errorText, proTexts, stateLine } from './proTexts';
import { useLicenceState } from '../useHostEdition';
import { Button } from '@workspace/ui/button';
import { Input } from '@workspace/ui/input';
import { Label } from '@workspace/ui/label';
import { Suspense, use, useRef, useState } from 'react';
import type { PlansChoice } from './PlansPart';
import type { SourceState } from '@src/edition/source';
import type { HistoryHost, LicenceView } from '@src/history/behaviors';
import type { LicenceOutcome } from '@src/shared/licenceMessages';
import type { ReactElement } from 'react';

export interface ProSettingsProps {
  readonly host: Pick<HistoryHost, 'licence' | 'onEdition'>;
  /** The plans of the build, loaded with the block (the same promise on every call); absent — no plans part. */
  readonly plans?: () => Promise<PlansChoice>;
}

type Action = 'activate' | 'check' | 'deactivate' | 'remove';

/** States whose block holds the key field. */
const FIELD: ReadonlySet<SourceState['kind']> = new Set(['free', 'ended', 'revoked', 'invalid']);
const CHECK: ReadonlySet<SourceState['kind']> = new Set(['active', 'grace', 'expired', 'ended']);
const DEACTIVATE: ReadonlySet<SourceState['kind']> = new Set(['active', 'grace', 'expired']);
const REMOVE: ReadonlySet<SourceState['kind']> = new Set(['ended', 'revoked', 'invalid']);

/** The words under the line: when an active licence was checked and until when it is paid. */
const detailOf = (state: SourceState): string | null =>
  state.kind === 'active'
    ? proTexts.checkedOn(state.licence.checkedAt) +
      (state.licence.paidUntil !== null ? proTexts.paidUntil(state.licence.paidUntil) : '')
    : null;

/** The plans part once the plans' module has loaded; until then, nothing in its place. */
const LoadedPlans = ({
  plans,
  state,
  host,
}: {
  plans: () => Promise<PlansChoice>;
  state: SourceState;
  host: string | undefined;
}): ReactElement | null => <PlansPart {...use(plans())} licence={state} host={host} />;

export const ProSettings = ({ host, plans }: ProSettingsProps): ReactElement | null => {
  const state = useLicenceState(host);
  const licence = host.licence;
  if (!licence || !state) return null;
  return <ProBlock licence={licence} state={state} plans={plans} />;
};

const ProBlock = ({
  licence,
  state,
  plans,
}: {
  licence: LicenceView;
  state: SourceState;
  plans?: () => Promise<PlansChoice>;
}): ReactElement => {
  const [key, setKey] = useState('');
  const [pending, setPending] = useState<Action | null>(null);
  const [error, setError] = useState<{ text: string; at: 'field' | 'block' } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);

  const kind = state.kind;
  const line = stateLine(state);
  const detail = detailOf(state);
  const textOf = (outcome: Extract<LicenceOutcome, { ok: false }>, activating: boolean) =>
    errorText(outcome.error, activating, outcome.retryAt ?? Date.now() + 60_000);

  const run = async (action: Action, call: () => Promise<LicenceOutcome>, done: string | null) => {
    setPending(action);
    setError(null);
    setNote(null);
    const outcome = await call();
    setPending(null);
    if (outcome.ok) {
      setNote(done);
      return;
    }
    setError({ text: textOf(outcome, false), at: 'block' });
  };

  const activate = async () => {
    setPending('activate');
    setError(null);
    setNote(null);
    const outcome = await licence.activate(key);
    setPending(null);
    if (outcome.ok) {
      setKey('');
      // The new state comes through storage, in every open tab; the status line says it.
      statusRef.current?.focus();
      return;
    }
    setError({ text: textOf(outcome, true), at: 'field' });
    // After the field is writable again.
    setTimeout(() => fieldRef.current?.focus(), 0);
  };

  const field = FIELD.has(kind);
  const busy = pending !== null;
  const blockButtons = !confirming && (CHECK.has(kind) || DEACTIVATE.has(kind));
  const statusRow = line !== null || detail !== null || note !== null || error?.at === 'block' || blockButtons;

  return (
    <section className="kit-settings-group" aria-labelledby="settings-pro" data-settings="pro" data-licence={kind}>
      <h2 id="settings-pro" className="kit-settings-group-title">
        {proTexts.title}
      </h2>
      {kind === 'free' && <p className="kit-settings-hint kit-settings-intro">{proTexts.intro}</p>}
      {/* Always the same element, so the focus given to it stays when the state changes; hidden while it has no words. */}
      <div className={statusRow ? 'kit-settings-row' : 'kit-settings-row sr-only'} data-setting="licence-state">
        <div className="kit-settings-text">
          <p ref={statusRef} role="status" tabIndex={-1} className="kit-settings-label" data-licence-line>
            {line}
          </p>
          {detail && <span className="kit-settings-hint">{detail}</span>}
          {note && (
            <span className="kit-settings-note" role="status">
              {note}
            </span>
          )}
          {error?.at === 'block' && (
            <span className="kit-settings-note" role="alert">
              {error.text}
            </span>
          )}
          {blockButtons && (
            <div className="kit-settings-buttons">
              {CHECK.has(kind) && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => run('check', () => licence.check(), proTexts.checked)}>
                  {proTexts.checkNow}
                </Button>
              )}
              {DEACTIVATE.has(kind) && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => (setConfirming(true), setError(null), setNote(null))}>
                  {proTexts.deactivateInBrowser}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
      {confirming && DEACTIVATE.has(kind) && (
        <div className="kit-settings-row" data-setting="licence-deactivate">
          <div className="kit-settings-text">
            <span id="settings-pro-confirm" className="kit-settings-label">
              {proTexts.confirmDeactivate}
            </span>
            <div className="kit-settings-buttons" role="group" aria-labelledby="settings-pro-confirm">
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={busy}
                onClick={async () => {
                  await run('deactivate', () => licence.deactivate(), proTexts.deactivated);
                  setConfirming(false);
                }}>
                {proTexts.deactivate}
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setConfirming(false)}>
                {proTexts.cancel}
              </Button>
            </div>
          </div>
        </div>
      )}
      {plans && kind !== 'unknown' && (
        <Suspense fallback={null}>
          <LoadedPlans plans={plans} state={state} host={licence.host} />
        </Suspense>
      )}
      {field &&
        (licence.host === undefined ? (
          <p className="kit-settings-hint kit-settings-prose">{proTexts.cannotActivate}</p>
        ) : (
          <div className="kit-settings-row" data-setting="licence-key">
            <div className="kit-settings-text">
              {kind === 'free' && <span className="kit-settings-hint">{proTexts.alreadyBought}</span>}
              <Label htmlFor="settings-pro-key" className="kit-settings-label">
                {proTexts.keyLabel}
              </Label>
              <Input
                ref={fieldRef}
                id="settings-pro-key"
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder={proTexts.keyPlaceholder}
                aria-describedby="settings-pro-disclosure"
                aria-invalid={error?.at === 'field' ? true : undefined}
                readOnly={pending === 'activate'}
                value={key}
                onChange={e => setKey(e.target.value)}
              />
              <span id="settings-pro-disclosure" className="kit-settings-hint">
                {proTexts.disclosure(licence.host)}
              </span>
              {error?.at === 'field' && (
                <span className="kit-settings-note" role="alert">
                  {error.text}
                </span>
              )}
              <div className="kit-settings-buttons">
                <Button type="button" size="sm" disabled={busy || key.trim() === ''} onClick={activate}>
                  {pending === 'activate' ? proTexts.activating : proTexts.activate}
                </Button>
                {REMOVE.has(kind) && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => run('remove', () => licence.remove(), null)}>
                    {proTexts.remove}
                  </Button>
                )}
              </div>
            </div>
          </div>
        ))}
      {field && licence.host === undefined && REMOVE.has(kind) && (
        <div className="kit-settings-buttons">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => run('remove', () => licence.remove(), null)}>
            {proTexts.remove}
          </Button>
        </div>
      )}
    </section>
  );
};
