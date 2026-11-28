/** The autosave schedule (Р22, §8.6а) on the test's clock: the pause, leaving, one write at a time, a conflict. */
import { createAutosave } from './autosave';
import { CompanionError } from './types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SaveState } from './autosave';

const flushPromises = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

const setup = (answers: Array<'ok' | 'conflict' | 'away' | 'refused' | 'encoding' | 'busy'> = []) => {
  let text = 'opened\n';
  const writes: { text: string; baseHash: string; reason: string }[] = [];
  const states: SaveState['kind'][] = [];
  let release: (() => void) | null = null;
  let hold = false;
  const autosave = createAutosave({
    delayMs: 1000,
    baseHash: 'h0',
    savedText: text,
    read: () => Promise.resolve(text),
    save: async (written, baseHash, reason) => {
      writes.push({ text: written, baseHash, reason });
      if (hold) await new Promise<void>(resolve => (release = resolve));
      const answer = answers.shift() ?? 'ok';
      if (answer === 'conflict') throw new CompanionError('conflict', 'changed on disk', { currentHash: 'disk' });
      if (answer === 'away') throw new CompanionError('server-restarting', 'restarting', { retryAfterMs: 100 });
      if (answer === 'refused') throw new CompanionError('secret-file', 'holds secrets');
      if (answer === 'encoding') throw new CompanionError('not-encodable', 'no', { encoding: 'windows-1252' });
      if (answer === 'busy') throw new CompanionError('rate-limited', 'too soon', { retryAfterMs: 300 });
      return { hash: `h${writes.length}`, protected: written.includes('hook') ? 'hooks' : null };
    },
    onState: state => states.push(state.kind),
  });
  return {
    autosave,
    writes,
    states,
    type: (next: string) => {
      text = next;
      autosave.edited();
    },
    holdWrites: () => (hold = true),
    releaseWrite: () => {
      hold = false;
      release?.();
    },
  };
};

describe('autosave', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('writes once the typing pauses for the delay, the latest text, from the hash it read', async () => {
    const { type, writes, autosave } = setup();
    type('a\n');
    vi.advanceTimersByTime(600);
    type('ab\n');
    vi.advanceTimersByTime(999);
    expect(writes).toEqual([]);
    vi.advanceTimersByTime(1);
    await flushPromises();
    expect(writes).toEqual([{ text: 'ab\n', baseHash: 'h0', reason: 'auto' }]);
    expect(autosave.state.kind).toBe('saved');
    // The next write starts from the hash the last one answered.
    type('abc\n');
    vi.advanceTimersByTime(1000);
    await flushPromises();
    expect(writes[1]).toEqual({ text: 'abc\n', baseHash: 'h1', reason: 'auto' });
  });

  it('writes at once on leaving or ⌘S, and nothing when the text is back to what was written', async () => {
    const { type, writes, autosave } = setup();
    type('left\n');
    await autosave.flush('explicit');
    expect(writes).toEqual([{ text: 'left\n', baseHash: 'h0', reason: 'explicit' }]);
    vi.advanceTimersByTime(5000);
    await flushPromises();
    expect(writes).toHaveLength(1);
    type('again\n');
    type('left\n');
    await autosave.flush();
    expect(writes).toHaveLength(1);
    expect(autosave.state.kind).toBe('saved');
  });

  it('one write at a time: an edit during a write follows it with the newest text', async () => {
    const { type, writes, holdWrites, releaseWrite, autosave } = setup();
    holdWrites();
    type('one\n');
    const first = autosave.flush();
    await flushPromises();
    expect(autosave.state.kind).toBe('saving');
    type('two\n');
    type('three\n');
    const second = autosave.flush();
    expect(writes).toHaveLength(1);
    releaseWrite();
    await first;
    await second;
    expect(writes.map(w => [w.text, w.baseHash])).toEqual([
      ['one\n', 'h0'],
      ['three\n', 'h1'],
    ]);
  });

  it('a conflict stops the writes until the person keeps theirs (from the disk’s hash) or takes the disk’s text', async () => {
    const { type, writes, autosave, states } = setup(['conflict']);
    type('mine\n');
    await autosave.flush();
    expect(autosave.state).toEqual({ kind: 'conflict', currentHash: 'disk' });
    type('mine, more\n');
    vi.advanceTimersByTime(5000);
    await autosave.flush();
    expect(writes).toHaveLength(1);
    await autosave.keepMine();
    expect(writes[1]).toEqual({ text: 'mine, more\n', baseHash: 'disk', reason: 'explicit' });
    expect(autosave.state.kind).toBe('saved');
    expect(states).toContain('conflict');

    const other = setup(['conflict']);
    other.type('mine\n');
    await other.autosave.flush();
    other.autosave.takeDisk('theirs\n', 'disk2');
    expect(other.autosave.state.kind).toBe('saved');
    expect(other.autosave.baseHash).toBe('disk2');
    other.type('theirs, edited\n');
    await other.autosave.flush();
    expect(other.writes[1]).toMatchObject({ baseHash: 'disk2' });
  });

  it('without the companion the edit is kept and tried again by itself; a refusal is said and stops', async () => {
    const { type, writes, autosave } = setup(['away']);
    type('kept\n');
    await autosave.flush();
    expect(autosave.state.kind).toBe('offline');
    vi.advanceTimersByTime(5000);
    await flushPromises();
    expect(writes.map(w => w.text)).toEqual(['kept\n', 'kept\n']);
    expect(autosave.state.kind).toBe('saved');

    const refused = setup(['refused']);
    refused.type('x\n');
    await refused.autosave.flush();
    expect(refused.autosave.state).toMatchObject({ kind: 'refused', error: { code: 'secret-file' } });
    refused.type('y\n');
    vi.advanceTimersByTime(5000);
    await refused.autosave.flush();
    expect(refused.writes).toHaveLength(1);
  });

  it('a refusal of the text (an encoding that cannot hold it) is tried again with the next edit', async () => {
    const { type, writes, autosave } = setup(['encoding']);
    type('snowman ☃\n');
    await autosave.flush();
    expect(autosave.state).toMatchObject({ kind: 'refused', error: { code: 'not-encodable' } });
    type('snowman\n');
    vi.advanceTimersByTime(1000);
    await flushPromises();
    expect(writes.map(w => w.text)).toEqual(['snowman ☃\n', 'snowman\n']);
    expect(autosave.state.kind).toBe('saved');
  });

  it('`rate-limited` waits what the companion asked, then writes the newest text', async () => {
    const { type, writes, autosave } = setup(['busy']);
    type('one\n');
    await autosave.flush();
    expect(autosave.state.kind).toBe('offline');
    vi.advanceTimersByTime(299);
    await flushPromises();
    expect(writes).toHaveLength(1);
    vi.advanceTimersByTime(1);
    await flushPromises();
    expect(writes.map(w => w.text)).toEqual(['one\n', 'one\n']);
  });

  it('tells which rule marks a saved file as running code', async () => {
    const marks: Array<string | null> = [];
    const autosave = createAutosave({
      baseHash: 'h0',
      savedText: '',
      read: () => Promise.resolve('#!/bin/sh hook\n'),
      save: async () => ({ hash: 'h1', protected: 'hooks' }),
      onSaved: (_text, _hash, marked) => marks.push(marked),
    });
    autosave.edited();
    await autosave.flush();
    expect(marks).toEqual(['hooks']);
  });

  it('after dispose nothing is written', async () => {
    const { type, writes, autosave } = setup();
    type('late\n');
    autosave.dispose();
    vi.advanceTimersByTime(5000);
    await autosave.flush();
    expect(writes).toEqual([]);
  });
});
