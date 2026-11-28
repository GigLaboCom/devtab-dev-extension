/**
 * What every error code of the contract says on the page (./errors.ts): the page's own words by the code and its data,
 * never the companion's message; commands verbatim; a hook's output and every other string from the companion made
 * printable (S17).
 */
import { errorText } from './errors';
import { TEXT } from './text';
import { CONTRACT_ERRORS } from '@src/projects/api/types.gen';
import { CompanionError } from '@src/projects/types';
import { describe, expect, it } from 'vitest';
import type { ErrorCode } from '@src/projects/types';

const MESSAGE = 'THE COMPANION’S OWN ENGLISH <b>message</b>';
const said = (code: string, data?: Record<string, unknown>, context: Parameters<typeof errorText>[1] = 'write') =>
  errorText(new CompanionError(code as ErrorCode, MESSAGE, data), context, 'p_abcdefgh23');

describe('errorText', () => {
  it.each(Object.keys(CONTRACT_ERRORS))('%s: a sentence of the page’s own, not the companion’s message', code => {
    const { text } = said(code);
    expect(text.trim().length).toBeGreaterThan(5);
    expect(text).not.toContain(MESSAGE);
    expect(text).not.toMatch(/<b>/);
    // Not the catch-all: every code of the contract has words of its own.
    expect(text).not.toBe(TEXT.errors.other(code));
  });

  it('confirmation-unavailable: the command the companion sent, verbatim, with one sentence; requests-off its own', () => {
    expect(
      said('confirmation-unavailable', { reason: 'no-window', command: "cd '/a b' && devtab add" }, 'add'),
    ).toEqual({
      text: TEXT.errors.noWindow,
      command: "cd '/a b' && devtab add",
    });
    expect(said('confirmation-unavailable', { reason: 'requests-off', command: 'devtab resume-requests' })).toEqual({
      text: TEXT.errors.requestsOff,
      command: 'devtab resume-requests',
    });
    // A hostile command is shown, never acted: its control characters become visible symbols.
    expect(said('confirmation-unavailable', { command: 'devtab add\u001b[2J' }).command).toBe('devtab add␛[2J');
  });

  it('the write policy: each rule its own sentence', () => {
    const rules = ['git-dir', 'symlink', 'read-only-file', 'git-filter', 'submodule', 'something-new'];
    const texts = rules.map(rule => said('protected-path', { rule }).text);
    expect(new Set(texts).size).toBe(rules.length);
    expect(said('not-encodable', { encoding: 'windows-1252' }).text).toContain('windows-1252');
    expect(said('disk-low', { freeBytes: 1024, floorBytes: 2 * 1024 * 1024 * 1024 }).text).toContain('2048.0 MB');
    expect(said('too-many-files', { size: 2500, limit: 2000 }).text).toContain('2,500');
    expect(said('not-found', {}, 'add').text).toBe(TEXT.errors.addNotFound);
  });

  it('a hook’s failure: the output without a terminal’s escape sequences; what to do; the commands for Terminal', () => {
    const failed = said(
      'hook-failed',
      { hook: 'pre-commit', exitCode: 1, output: '\u001b[31merror\u001b[0m <x>' },
      'commit',
    );
    expect(failed.text).toContain('pre-commit failed');
    expect(failed.text).toContain('Run Git hooks');
    expect(failed.output).toBe('error <x>');
    const missing = said(
      'hook-tool-missing',
      { hook: 'pre-commit', tool: 'npx', output: 'npx: not found', pathCapturedAt: null },
      'commit',
    );
    expect(missing.text).toContain('did not find npx');
    expect(missing.commands).toEqual([
      'devtab env path-add --project p_abcdefgh23 <folder>',
      'devtab doctor --commit p_abcdefgh23',
    ]);
    expect(said('hook-timeout', { afterMs: 300_000 }, 'commit').text).toContain('5 minutes');
    expect(said('signing-failed', { output: 'gpg failed' }, 'commit').output).toBe('gpg failed');
    expect(said('operation-in-progress', { operation: 'rebase' }, 'commit').text).toContain('rebase is in progress');
    expect(said('identity-missing', {}, 'commit').command).toBe(TEXT.noIdentityCommand);
  });

  it('a commit’s other refusals: stale (files or HEAD), whole files only, nothing to commit, undo, busy', () => {
    expect(said('stale-selection', { paths: ['a'] }, 'commit').text).toBe(TEXT.staleSelection);
    expect(said('stale-selection', { paths: [] }, 'commit').text).toBe(TEXT.errors.staleHead);
    expect(said('hunks-unsupported', { reason: 'new-file', path: 'n.txt' }, 'commit').text).toBe(
      TEXT.errors.hunksUnsupported('n.txt', 'it is a new file'),
    );
    expect(said('nothing-selected', {}, 'commit').text).toBe(TEXT.errors.nothingSelected);
    for (const reason of ['moved', 'pushed', 'merge', 'root', 'detached'])
      expect(said('undo-unavailable', { reason }, 'undo').text).toBe(TEXT.errors.undoUnavailable[reason]);
    expect(said('rate-limited', { retryAfterMs: 2500 }, 'commit').text).toBe(TEXT.errors.gitBusy(3));
    expect(said('rate-limited', { retryAfterMs: 2500 }, 'save').text).toBe(TEXT.errors.rateLimited(3));
    expect(said('cancelled', {}, 'commit').text).toBe(TEXT.commitCancelled);
  });

  it('restoring a version and clearing the history (row 7.5): their own words where the code reads differently', () => {
    expect(said('conflict', { currentHash: 'f'.repeat(64) }, 'restore').text).toBe(TEXT.history.restoreConflict);
    expect(said('not-found', {}, 'restore').text).toBe(TEXT.history.pointGone);
    expect(said('not-encodable', { encoding: 'utf-16le' }, 'restore').text).toBe(
      TEXT.history.restoreNotEncodable('utf-16le'),
    );
    for (const code of ['secret-file', 'not-mine', 'disk-low', 'rate-limited', 'outside-project'])
      expect(said(code, {}, 'restore').text).toBe(said(code, {}, 'save').text);
    expect(said('protected-path', { rule: 'symlink' }, 'restore').text).toBe(TEXT.errors.protectedSymlink);
    expect(
      said('confirmation-unavailable', { reason: 'no-window', command: 'devtab history purge ~/fx/repo' }, 'purge'),
    ).toEqual({ text: TEXT.history.purgeNoWindow, command: 'devtab history purge ~/fx/repo' });
    expect(said('confirmation-unavailable', { reason: 'requests-off', command: 'x' }, 'purge').text).toBe(
      TEXT.errors.requestsOff,
    );
    expect(said('confirmation-declined', {}, 'purge').text).toBe(TEXT.errors.confirmationDeclined);
  });

  it('an error of the page itself, and a code no contract has yet', () => {
    expect(errorText(new Error('boom'), 'read').text).toBe(TEXT.failed('boom'));
    expect(said('brand-new-code').text).toBe(TEXT.errors.other('brand-new-code'));
  });
});
