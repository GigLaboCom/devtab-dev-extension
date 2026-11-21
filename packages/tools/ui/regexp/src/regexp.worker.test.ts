import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JobReply } from './runner';

/** The worker's scope, as the module sees `self`. */
const scope = { onmessage: null as ((event: { data: unknown }) => void) | null, postMessage: vi.fn() };

afterEach(() => vi.unstubAllGlobals());

describe('the worker', () => {
  it('runs a job and answers with its id; an exception in a job is an answer, not a crash', async () => {
    vi.stubGlobal('self', scope);
    await import('./regexp.worker');
    expect(scope.onmessage).toBeTypeOf('function');

    scope.onmessage!({ data: { id: 3, request: { pattern: '\\d', flags: 'g', text: 'a1b2', replacement: '#' } } });
    const reply = scope.postMessage.mock.calls[0]![0] as JobReply;
    expect(reply.id).toBe(3);
    expect(reply.result).toMatchObject({ ok: true, replaced: 'a#b#' });
    expect(reply.result.ok && reply.result.matches.map(m => m.text)).toEqual(['1', '2']);

    scope.onmessage!({ data: { id: 4, request: null } });
    const failed = scope.postMessage.mock.calls[1]![0] as JobReply;
    expect(failed.id).toBe(4);
    expect(failed.result).toMatchObject({ ok: false, message: expect.stringMatching(/^TypeError: /) });
  });
});
