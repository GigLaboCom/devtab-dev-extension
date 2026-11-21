import { memoryKeyHolder, noCipher, passwordCipher } from './cipher';
import { createHistoryFactory, IDLE_MS, MIN_GAP_MS, SESSION_IDLE_MS } from './factory';
import { memoryStore } from './memoryStore';
import { describe, expect, it } from 'vitest';
import type { HistoryDeclaration, HistoryGate, Timers } from './factory';

const DECLARATION: HistoryDeclaration = {
  kinds: [
    { id: 'edit', title: 'Edit' },
    { id: 'result', title: 'Result' },
    { id: 'secret', title: 'Secret', secret: true },
  ],
  schema: 2,
  records: 'test',
  never: 'test',
};

/** Timers a test moves by hand. */
const manualTimers = () => {
  let now = Date.UTC(2026, 10, 21, 9, 0, 0);
  let tasks: Array<{ at: number; fn: () => void; id: number }> = [];
  let seq = 0;
  const timers: Timers = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = ++seq;
      tasks.push({ at: now + ms, fn, id });
      return id;
    },
    clearTimeout: id => {
      tasks = tasks.filter(t => t.id !== id);
    },
  };
  const advance = async (ms: number) => {
    now += ms;
    const due = tasks.filter(t => t.at <= now);
    tasks = tasks.filter(t => t.at > now);
    for (const t of due) t.fn();
    for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 0));
  };
  return { timers, advance };
};

const draft = (kind: string, text: string) => ({
  kind,
  payload: { indent: 2 },
  label: `${kind} ${text}`,
  text,
  blobs: { input: new Blob([text], { type: 'application/json' }) },
});

describe('the history factory', () => {
  it('records a commit at once, with its blobs; lists and opens it for its own owner only', async () => {
    const store = memoryStore();
    const factory = createHistoryFactory({ store, cipher: noCipher });
    const history = factory.forOwner('json', DECLARATION);
    const recorder = history.session();
    const outcome = await recorder.commit(draft('result', '{"a":1}'));
    expect(outcome.recorded).toBe(true);
    const { entries } = await history.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      owner: 'json',
      kind: 'result',
      schema: 2,
      encrypted: false,
      label: 'result {"a":1}',
    });
    const opened = await history.open(entries[0].id);
    expect(opened.ok && (await opened.blobs.input.text())).toBe('{"a":1}');
    expect(opened.ok && opened.payload).toEqual({ indent: 2 });
    expect(await factory.forOwner('base64', DECLARATION).open(entries[0].id)).toEqual({ ok: false, reason: 'missing' });
    const line = JSON.parse((await store.get(entries[0].id))!.line);
    expect(line.blobs[0]).toMatchObject({ name: 'input', type: 'application/json', size: 7 });
    expect(line.blobs[0].hash).toMatch(/^sha256-/);
  });

  it('takes a change snapshot only after the input is still, at most once per gap, and on flush', async () => {
    const store = memoryStore();
    const { timers, advance } = manualTimers();
    const recorder = createHistoryFactory({ store, cipher: noCipher, timers }).forOwner('json', DECLARATION).session();
    for (const text of ['{', '{"', '{"a', '{"a":', '{"a":1}']) {
      recorder.change(draft('edit', text));
      await advance(500);
    }
    expect((await store.stats()).records).toBe(0);
    await advance(IDLE_MS);
    expect((await store.stats()).records).toBe(1);
    recorder.change(draft('edit', '{"a":12}'));
    await advance(IDLE_MS + 10);
    expect((await store.stats()).records).toBe(1); // within MIN_GAP_MS of the last change snapshot
    await advance(MIN_GAP_MS);
    expect((await store.stats()).records).toBe(2);
    recorder.change(draft('edit', '{"a":123}'));
    await recorder.flush(); // the page is left
    expect((await store.stats()).records).toBe(3);
  });

  it('a commit drops the pending change; an equal draft is not recorded twice; one session until idle', async () => {
    const store = memoryStore();
    const { timers, advance } = manualTimers();
    const recorder = createHistoryFactory({ store, cipher: noCipher, timers }).forOwner('json', DECLARATION).session();
    recorder.change(draft('edit', 'x'));
    await recorder.commit(draft('result', 'x'));
    await advance(MIN_GAP_MS * 2);
    expect((await store.stats()).records).toBe(1);
    expect(await recorder.commit(draft('result', 'x'))).toEqual({ recorded: false, reason: 'duplicate' });
    await recorder.commit(draft('result', 'y'));
    const first = recorder.session;
    await advance(SESSION_IDLE_MS + 1);
    await recorder.commit(draft('result', 'z'));
    expect(recorder.session).not.toBe(first);
    const sessions = new Set((await store.page({}, { limit: 10 })).rows.map(r => r.session));
    expect(sessions.size).toBe(2);
  });

  it('records nothing when the gate is off, for an undeclared kind, or for a declaration with no kinds', async () => {
    const store = memoryStore();
    let state: ReturnType<HistoryGate['state']> = 'incognito';
    const gate: HistoryGate = { state: () => state, subscribe: () => () => {} };
    const factory = createHistoryFactory({ store, cipher: noCipher, gate });
    const recorder = factory.forOwner('json', DECLARATION).session();
    expect(await recorder.commit(draft('result', 'a'))).toEqual({ recorded: false, reason: 'off' });
    recorder.change(draft('edit', 'b'));
    await recorder.flush();
    state = 'on';
    expect(await recorder.commit(draft('nope', 'a'))).toEqual({ recorded: false, reason: 'undeclared' });
    const silent = factory.forOwner('password', { kinds: [], schema: 1, records: '', never: '' });
    expect(silent.status().declared).toBe(false);
    expect(await silent.session().commit(draft('result', 'a'))).toEqual({ recorded: false, reason: 'undeclared' });
    expect((await store.stats()).records).toBe(0);
  });

  it('refuses a blob over the limit', async () => {
    const store = memoryStore();
    const recorder = createHistoryFactory({ store, cipher: noCipher, maxBlobBytes: 4 })
      .forOwner('json', DECLARATION)
      .session();
    expect(await recorder.commit(draft('result', 'too long'))).toEqual({ recorded: false, reason: 'too-large' });
  });

  it('secret kinds: dropped without a password and while locked; sealed — content, text and blobs — when unlocked', async () => {
    const store = memoryStore();
    const holder = memoryKeyHolder();
    const cipher = passwordCipher({ keyrings: store, holder, iterations: 1000 });
    await cipher.refresh();
    const history = createHistoryFactory({ store, cipher }).forOwner('password', DECLARATION);
    const recorder = history.session();
    expect(await recorder.commit(draft('secret', 's3cret-value'))).toEqual({
      recorded: false,
      reason: 'secret-no-password',
    });
    expect(history.status().secrets).toBe('no-password');
    await cipher.setPassword('test passphrase one');
    const outcome = await recorder.commit(draft('secret', 's3cret-value'));
    expect(outcome.recorded).toBe(true);
    // A clear kind stays clear under a password.
    await recorder.commit(draft('result', 'plain-value'));
    const id = outcome.recorded ? outcome.id : '';
    const row = (await store.get(id))!;
    expect(row.kid).toBe(cipher.activeKid());
    expect(row.line).not.toMatch(/s3cret|label|"text"|payload|application\/json|"name"/);
    const blobHash = row.blobs[0];
    expect(blobHash).toMatch(/^hmac256-/);
    const stored = await store.blob(blobHash);
    expect(await stored!.data.text()).not.toContain('s3cret');
    expect(await history.list()).toMatchObject({
      entries: [
        { kind: 'result', encrypted: false },
        { kind: 'secret', encrypted: true },
      ],
    });
    const opened = await history.open(id);
    expect(opened.ok && opened.label).toBe('secret s3cret-value');
    expect(opened.ok && (await opened.blobs.input.text())).toBe('s3cret-value');
    expect(opened.ok && opened.blobs.input.type).toBe('application/json');

    await cipher.lock();
    expect(history.status().secrets).toBe('locked');
    expect(await history.open(id)).toEqual({ ok: false, reason: 'locked' });
    expect(await recorder.commit(draft('secret', 'other'))).toEqual({ recorded: false, reason: 'secret-locked' });
    expect((await recorder.commit(draft('result', 'still recorded'))).recorded).toBe(true);
    // Text search never sees inside a sealed record.
    expect((await store.page({ text: 's3cret' }, { limit: 5 })).rows).toHaveLength(0);
  });

  it('an entry of a newer payload schema than the owner knows is not opened', async () => {
    const store = memoryStore();
    const factory = createHistoryFactory({ store, cipher: noCipher });
    const outcome = await factory
      .forOwner('json', { ...DECLARATION, schema: 3 })
      .session()
      .commit(draft('result', 'a'));
    const id = outcome.recorded ? outcome.id : '';
    expect(await factory.forOwner('json', DECLARATION).open(id)).toEqual({ ok: false, reason: 'newer-schema' });
  });
});
