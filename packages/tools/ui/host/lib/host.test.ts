/** The hosts for a tool's tests: in memory, and in memory with a master password, unlocked (the real factory and cipher). */
import { memoryHost, unlockedHost } from './host';
import { describe, expect, it } from 'vitest';
import type { HistoryDeclaration } from '@workspace/tools-shared/history';

const SECRET: HistoryDeclaration = {
  kinds: [
    { id: 'open', title: 'Open' },
    { id: 'secret', title: 'Secret', secret: true },
  ],
  schema: 1,
  records: 'test',
  never: 'test',
};

describe('the test hosts', () => {
  it('in memory: a secret kind is not recorded — there is no master password', async () => {
    const history = memoryHost().history.forOwner('probe', SECRET);
    expect(history.status().secrets).toBe('no-password');
    expect(await history.session().commit({ kind: 'secret', payload: { v: 1 } })).toEqual({
      recorded: false,
      reason: 'secret-no-password',
    });
  });

  it('unlocked: a secret kind is sealed, recorded and opened; locked, it is refused and an entry says so', async () => {
    const host = await unlockedHost();
    const history = host.history.forOwner('probe', SECRET);
    expect(history.status().secrets).toBe('unlocked');
    const outcome = await history.session().commit({ kind: 'secret', label: 'hidden', payload: { v: 42 } });
    expect(outcome.recorded).toBe(true);
    const id = outcome.recorded ? outcome.id : '';
    const opened = await history.open(id);
    expect(opened.ok && opened.payload).toEqual({ v: 42 });
    // The stored line carries no clear text of the secret.
    const [line] = (await host.store.page({}, { limit: 10 })).rows.map(r => JSON.stringify(r));
    expect(line).not.toContain('hidden');
    await host.vault.lock();
    expect(history.status().secrets).toBe('locked');
    expect(await history.session().commit({ kind: 'secret', payload: { v: 1 } })).toEqual({
      recorded: false,
      reason: 'secret-locked',
    });
    expect(await history.open(id)).toMatchObject({ ok: false, reason: 'locked' });
  });
});
