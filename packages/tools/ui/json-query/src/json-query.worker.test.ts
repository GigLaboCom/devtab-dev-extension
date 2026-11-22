import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JobReply } from './runner';

/** The worker's scope, as the module sees `self`. */
const scope = { onmessage: null as ((event: { data: unknown }) => void) | null, postMessage: vi.fn() };

afterEach(() => vi.unstubAllGlobals());

describe('the worker', () => {
  it('reads a document once, runs queries over it, says what went wrong as an answer', async () => {
    vi.stubGlobal('self', scope);
    await import('./json-query.worker');
    expect(scope.onmessage).toBeTypeOf('function');
    const reply = (k: number) => scope.postMessage.mock.calls[k]![0] as JobReply;

    scope.onmessage!({ data: { id: 1, request: { docId: 7, document: '{"a":[1,2],"a":3}', query: '$.a' } } });
    expect(reply(0)).toMatchObject({ id: 1, result: { ok: true, count: 2, paths: "$['a']\n$['a']" } });
    const first = reply(0).result;
    expect(first.ok && first.notes[0]).toMatch(/^Duplicate key "a"/);

    // The same document: only the query comes.
    scope.onmessage!({ data: { id: 2, request: { docId: 7, query: '$.a[*]' } } });
    expect(reply(1)).toMatchObject({ id: 2, result: { ok: true, count: 2 } });

    scope.onmessage!({ data: { id: 3, request: { docId: 8, query: '$' } } });
    expect(reply(2).result).toEqual({ ok: false, where: 'query', message: 'the document did not reach the worker' });

    scope.onmessage!({ data: { id: 4, request: { docId: 9, document: '{"a":', query: '$' } } });
    expect(reply(3).result).toMatchObject({ ok: false, where: 'document', error: { line: 1, column: 6 } });

    scope.onmessage!({ data: { id: 5, request: null } });
    expect(reply(4).result).toMatchObject({
      ok: false,
      where: 'query',
      message: expect.stringMatching(/^TypeError: /),
    });
  });
});
