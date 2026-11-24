/**
 * Settings → Pro (pro-entitlement §6.7): every line of the states table and of the errors table, exactly; the steps of
 * Activate (§6.7.3) over fake licence controls; the focus; the names of the buttons and the field's description; the
 * deactivation asked on the spot; the plans part between the state's line and the key field. A build whose source is
 * fixed has no block.
 */
import { ProSettings } from './ProSettings';
import { memoryPlans } from '@src/plans/memory';
import { SAMPLE_RULES } from '@src/plans/sample';
import { settled } from '@src/start/tileSources';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlansChoice } from './PlansPart';
import type { SourceState } from '@src/edition/source';
import type { LicenceView } from '@src/history/behaviors';
import type { LicenceError, LicenceOutcome } from '@src/shared/licenceMessages';

afterEach(cleanup);

const DAY = 86_400_000;
const CHECKED = Date.UTC(2026, 10, 1, 12);
const VALID = Date.UTC(2026, 11, 1, 12);
const PAID = Date.UTC(2026, 10, 23, 12);
const date = (ms: number) => new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(ms);
const time = (ms: number) => new Intl.DateTimeFormat('en-US', { timeStyle: 'short' }).format(ms);
const HOST = 'licence-fake.invalid';

const facts = (paidUntil: number | null = PAID) => ({
  lid: 'lic_TEST0000000001',
  checkedAt: CHECKED,
  checkAfter: CHECKED + 7 * DAY,
  warnFrom: VALID - 7 * DAY,
  validUntil: VALID,
  paidUntil,
});

const STATES: Record<string, SourceState> = {
  unknown: { kind: 'unknown' },
  free: { kind: 'free' },
  active: { kind: 'active', licence: facts(), due: false },
  grace: { kind: 'grace', licence: facts() },
  expired: { kind: 'expired', licence: facts() },
  ended: { kind: 'ended', licence: facts() },
  refund: { kind: 'revoked', licence: facts(), reason: 'refund' },
  deactivated: { kind: 'revoked', licence: facts(), reason: 'deactivated' },
  'key-blocked': { kind: 'revoked', licence: facts(), reason: 'key-blocked' },
  'seat-limit': { kind: 'revoked', licence: facts(), reason: 'seat-limit' },
  'unknown-installation': { kind: 'revoked', licence: facts(), reason: 'unknown-installation' },
  invalid: { kind: 'invalid', reason: 'signature' },
};

const OK: LicenceOutcome = { ok: true };

/** A host as Settings reads it: the licence's controls (fakes) and its state, which the test changes. */
/** `null`: a build without a server. */
const fakeHost = (initial: SourceState, server: string | null = HOST) => {
  const host = server ?? undefined;
  let state = initial;
  const listeners = new Set<() => void>();
  const licence = {
    host,
    activate: vi.fn(async (): Promise<LicenceOutcome> => OK),
    check: vi.fn(async (): Promise<LicenceOutcome> => OK),
    deactivate: vi.fn(async (): Promise<LicenceOutcome> => OK),
    remove: vi.fn(async (): Promise<LicenceOutcome> => OK),
    state: () => state,
  } satisfies LicenceView;
  return {
    host: {
      licence,
      onEdition: (listener: () => void) => {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
    },
    licence,
    set: (next: SourceState) =>
      act(() => {
        state = next;
        for (const listener of [...listeners]) listener();
      }),
  };
};

const block = () => document.querySelector<HTMLElement>('[data-settings="pro"]')!;
const statusLine = () => block().querySelector<HTMLElement>('[data-licence-line]')!;
const field = () => screen.getByRole('textbox', { name: 'Licence key' }) as HTMLInputElement;
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const buttons = () => [...block().querySelectorAll('button')].map(b => b.textContent);

describe('the states of the block, in words (§6.7.2)', () => {
  it.each([
    ['unknown', 'Reading the licence…'],
    ['active', 'Pro is active in this browser.'],
    ['grace', `Couldn’t check your licence since ${date(CHECKED)}. Pro stays until ${date(VALID)}.`],
    [
      'expired',
      `Pro is paused: the licence couldn’t be checked since ${date(CHECKED)}. Connect to the internet, check that your computer’s clock is right, and press Check now.`,
    ],
    ['ended', `Your Pro subscription ended on ${date(PAID)}. If you renewed it, press Check now.`],
    ['refund', 'This licence was refunded, so Pro is off in this browser.'],
    [
      'deactivated',
      'This browser was deactivated from the licence, so Pro is off here. To use Pro here again, activate a key.',
    ],
    ['key-blocked', 'This licence key was blocked, so Pro is off in this browser.'],
    [
      'seat-limit',
      'This licence is active in as many browsers as it allows, so Pro is off here. Deactivate it in another browser, then activate here again.',
    ],
    [
      'unknown-installation',
      'The licence server no longer knows this browser, so Pro is off here. Activate your key again.',
    ],
    ['invalid', 'The licence stored in this browser couldn’t be verified, so Pro is off. Activate your key again.'],
  ])('%s', (name, text) => {
    render(<ProSettings host={fakeHost(STATES[name]).host} />);
    expect(screen.getByRole('heading', { name: 'Pro', level: 2 }).id).toBe('settings-pro');
    expect(statusLine().textContent).toBe(text);
    expect(statusLine().getAttribute('role')).toBe('status');
  });

  it('every reason of invalid has the same line', () => {
    for (const reason of ['unreadable', 'malformed', 'unsupported', 'unknown-key', 'claims', 'foreign'] as const) {
      render(<ProSettings host={fakeHost({ kind: 'invalid', reason }).host} />);
      expect(statusLine().textContent).toBe(
        'The licence stored in this browser couldn’t be verified, so Pro is off. Activate your key again.',
      );
      cleanup();
    }
  });

  it('free: the introduction, no line, the key field with its words and what activating sends', () => {
    render(<ProSettings host={fakeHost(STATES.free).host} />);
    expect(block().querySelector('.kit-settings-intro')!.textContent).toBe(
      'Every tool works in full in this version. Pro adds memory: the tool history and its archive, tools that remember your options, and copying automatically after generating.',
    );
    expect(statusLine().textContent).toBe('');
    expect(screen.getByText('Already bought Pro? Paste your licence key.')).toBeTruthy();
    expect(field().getAttribute('type')).toBe('text');
    expect(field().getAttribute('autocomplete')).toBe('off');
    expect(field().getAttribute('spellcheck')).toBe('false');
    expect(field().placeholder).toBe('Paste your licence key');
    const disclosure = document.getElementById(field().getAttribute('aria-describedby')!)!;
    expect(disclosure.textContent).toBe(
      'Activating sends this key to licence-fake.invalid to check it. After that, about once a week while you use the extension, it sends this installation’s random number and a secret issued for it — nothing about what you do in the tools.',
    );
    expect(buttons()).toEqual(['Activate']);
  });

  it('active: when it was checked and until when it is paid; without a paid date, no such words', () => {
    render(<ProSettings host={fakeHost(STATES.active).host} />);
    expect(screen.getByText(`Licence checked on ${date(CHECKED)}. Paid until ${date(PAID)}.`)).toBeTruthy();
    cleanup();
    render(<ProSettings host={fakeHost({ kind: 'active', licence: facts(null), due: false }).host} />);
    expect(screen.getByText(`Licence checked on ${date(CHECKED)}.`)).toBeTruthy();
    expect(screen.queryByText(/Paid until/)).toBeNull();
  });

  it.each([
    ['unknown', [], false],
    ['active', ['Check now', 'Deactivate in this browser'], false],
    ['grace', ['Check now', 'Deactivate in this browser'], false],
    ['expired', ['Check now', 'Deactivate in this browser'], false],
    ['ended', ['Check now', 'Activate', 'Remove from this browser'], true],
    ['refund', ['Activate', 'Remove from this browser'], true],
    ['seat-limit', ['Activate', 'Remove from this browser'], true],
    ['invalid', ['Activate', 'Remove from this browser'], true],
  ] as const)('%s: the buttons %j, the field %s', (name, names, hasField) => {
    render(<ProSettings host={fakeHost(STATES[name]).host} />);
    expect(buttons()).toEqual(names);
    expect(screen.queryByRole('textbox', { name: 'Licence key' }) !== null).toBe(hasField);
    // The introduction and the "already bought" words belong to the free state only.
    expect(screen.queryByText('Already bought Pro? Paste your licence key.')).toBeNull();
  });

  it('a build without a server: no field and no Activate, the words in their place', () => {
    render(<ProSettings host={fakeHost(STATES.free, null).host} />);
    expect(screen.getByText('Pro can’t be activated in this build.')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Activate' })).toBeNull();
  });

  it('a build whose edition is fixed (no licence on the host): no block at all', () => {
    const { container } = render(<ProSettings host={{ onEdition: () => () => undefined }} />);
    expect(container.innerHTML).toBe('');
  });

  it('follows the state on the open page', () => {
    const { host, set } = fakeHost(STATES.free);
    render(<ProSettings host={host} />);
    expect(buttons()).toEqual(['Activate']);
    set(STATES.active);
    expect(statusLine().textContent).toBe('Pro is active in this browser.');
    expect(buttons()).toEqual(['Check now', 'Deactivate in this browser']);
  });
});

describe('Activate, step by step (§6.7.3)', () => {
  it('disabled while the field is empty after trimming', () => {
    render(<ProSettings host={fakeHost(STATES.free).host} />);
    expect(button('Activate').disabled).toBe(true);
    fireEvent.change(field(), { target: { value: '   ' } });
    expect(button('Activate').disabled).toBe(true);
    fireEvent.change(field(), { target: { value: 'DTD-TEST-AAAA-BBBB-CCCC-DDDD' } });
    expect(button('Activate').disabled).toBe(false);
  });

  it('pressed: the field is read-only and the button says Activating…; ok → the field is cleared, the focus on the line', async () => {
    const { host, licence, set } = fakeHost(STATES.free);
    let answer!: (o: LicenceOutcome) => void;
    licence.activate.mockImplementation(() => new Promise(resolve => (answer = resolve)));
    render(<ProSettings host={host} />);
    fireEvent.change(field(), { target: { value: ' DTD-TEST-AAAA-BBBB-CCCC-DDDD ' } });
    fireEvent.click(button('Activate'));
    expect(licence.activate).toHaveBeenCalledWith(' DTD-TEST-AAAA-BBBB-CCCC-DDDD ');
    expect(field().readOnly).toBe(true);
    expect(button('Activating…').disabled).toBe(true);
    await act(async () => answer(OK));
    expect(field().value).toBe('');
    expect(document.activeElement).toBe(statusLine());
    // The new state comes through storage; the line keeps the focus.
    set(STATES.active);
    expect(statusLine().textContent).toBe('Pro is active in this browser.');
    expect(document.activeElement).toBe(statusLine());
  });

  it('an error: the field writable with the same value, the words under it as an alert, the focus on the field', async () => {
    const { host, licence } = fakeHost(STATES.free);
    licence.activate.mockResolvedValue({ ok: false, error: 'key-unknown' });
    render(<ProSettings host={host} />);
    fireEvent.change(field(), { target: { value: 'DTD-TEST-AAAA-BBBB-CCCC-DDDD' } });
    fireEvent.click(button('Activate'));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'This licence key isn’t known. Check that you copied all of it.',
      ),
    );
    expect(field().readOnly).toBe(false);
    expect(field().value).toBe('DTD-TEST-AAAA-BBBB-CCCC-DDDD');
    expect(field().getAttribute('aria-invalid')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(field()));
  });
});

describe('the errors, in words (§6.7.4)', () => {
  const RETRY = Date.UTC(2026, 10, 24, 15, 5);
  const ACTIVATING: Array<[LicenceError, string]> = [
    ['malformed-key', 'This doesn’t look like a licence key. Check that you copied all of it.'],
    ['key-unknown', 'This licence key isn’t known. Check that you copied all of it.'],
    [
      'seat-limit',
      'This licence is already active in as many browsers as it allows. Deactivate it in another browser first.',
    ],
    ['key-blocked', 'This licence key is blocked.'],
    ['licence-inactive', 'This licence isn’t active: the subscription ended or the purchase was refunded.'],
    ['offline', 'Couldn’t reach the licence server. Check your connection and try again.'],
    ['server', 'Couldn’t reach the licence server. Check your connection and try again.'],
    ['rate-limited', `Too many attempts. Try again after ${time(RETRY)}.`],
    ['server-busy', `The licence server is busy. Try again after ${time(RETRY)}.`],
    ['bad-answer', 'The licence server’s answer couldn’t be verified, so nothing was changed. Try again later.'],
    ['busy', 'Another tab is doing this right now. Try again in a moment.'],
    ['unavailable', 'Pro can’t be activated in this build.'],
    ['worker', 'The extension was just updated. Reload this page and try again.'],
    ['version', 'The extension was just updated. Reload this page and try again.'],
    ['refused', 'The extension was just updated. Reload this page and try again.'],
  ];

  it.each(ACTIVATING)('activating, %s', async (error, text) => {
    const { host, licence } = fakeHost(STATES.free);
    licence.activate.mockResolvedValue({ ok: false, error, retryAt: RETRY });
    render(<ProSettings host={host} />);
    fireEvent.change(field(), { target: { value: 'DTD-TEST-AAAA-BBBB-CCCC-DDDD' } });
    fireEvent.click(button('Activate'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(text));
  });

  it.each([
    ['offline', 'Couldn’t reach the licence server, so nothing was changed.'],
    ['server', 'Couldn’t reach the licence server, so nothing was changed.'],
    ['bad-answer', 'The licence server’s answer couldn’t be verified, so nothing was changed. Try again later.'],
    ['rate-limited', `Too many attempts. Try again after ${time(RETRY)}.`],
  ] as const)('Check now, %s', async (error, text) => {
    const { host, licence } = fakeHost(STATES.expired);
    licence.check.mockResolvedValue({ ok: false, error, retryAt: RETRY });
    render(<ProSettings host={host} />);
    fireEvent.click(button('Check now'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(text));
    expect(statusLine().textContent).toMatch(/^Pro is paused/);
  });
});

describe('Check now, Deactivate, Remove', () => {
  it('Check now: the controls ask the worker; a success says so', async () => {
    const { host, licence } = fakeHost(STATES.expired);
    render(<ProSettings host={host} />);
    fireEvent.click(button('Check now'));
    expect(licence.check).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Checked just now.')).toBeTruthy();
    expect(screen.getByText('Checked just now.').getAttribute('role')).toBe('status');
  });

  it('Deactivate is asked on the spot, without a window; Cancel puts the buttons back', async () => {
    const { host, licence, set } = fakeHost(STATES.active);
    render(<ProSettings host={host} />);
    fireEvent.click(button('Deactivate in this browser'));
    expect(
      screen.getByText('Deactivate Pro in this browser? Your history and saved options stay in this browser.'),
    ).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(buttons()).toEqual(['Deactivate', 'Cancel']);
    fireEvent.click(button('Cancel'));
    expect(buttons()).toEqual(['Check now', 'Deactivate in this browser']);
    fireEvent.click(button('Deactivate in this browser'));
    licence.deactivate.mockImplementation(async () => {
      set(STATES.free);
      return OK;
    });
    fireEvent.click(button('Deactivate'));
    expect(await screen.findByText('Deactivated in this browser.')).toBeTruthy();
    expect(licence.deactivate).toHaveBeenCalledTimes(1);
    expect(buttons()).toEqual(['Activate']);
  });

  it('Remove from this browser: without asking', async () => {
    const { host, licence } = fakeHost(STATES['seat-limit']);
    render(<ProSettings host={host} />);
    fireEvent.click(button('Remove from this browser'));
    await waitFor(() => expect(licence.remove).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('the plans part in the block (pro-plans-and-payment §5.1)', () => {
  it('between the state’s line and the key field; the order of Tab: See plans, then the field', async () => {
    const source = memoryPlans({}, () => Date.now(), SAMPLE_RULES);
    await source.ready;
    const choice: PlansChoice = {
      source,
      siteUrl: 'https://web.example.invalid/pro/',
      siteHost: 'web.example.invalid',
    };
    const loaded = settled(choice);
    render(<ProSettings host={fakeHost(STATES.free).host} plans={() => loaded} />);
    const seePlans = await screen.findByRole('button', { name: 'See plans' });
    const rows = [
      ...block().querySelectorAll('[data-setting="licence-state"], [data-plans], [data-setting="licence-key"]'),
    ];
    expect(rows.map(r => r.getAttribute('data-setting') ?? 'plans')).toEqual(['licence-state', 'plans', 'licence-key']);
    const focusable = [...block().querySelectorAll('button, input, a')];
    expect(focusable.indexOf(seePlans)).toBeLessThan(focusable.indexOf(field()));
    source.dispose();
  });

  it('no plans while the licence is still being read', () => {
    const source = memoryPlans({}, () => Date.now(), SAMPLE_RULES);
    const loaded = settled<PlansChoice>({ source, siteUrl: undefined, siteHost: undefined });
    render(<ProSettings host={fakeHost(STATES.unknown).host} plans={() => loaded} />);
    expect(document.querySelector('[data-plans]')).toBeNull();
    source.dispose();
  });
});
