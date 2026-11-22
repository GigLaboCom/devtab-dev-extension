import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JobReply } from './runner';

/** The worker's scope, as the module sees `self`. */
const scope = { onmessage: null as ((event: { data: unknown }) => void) | null, postMessage: vi.fn() };

afterEach(() => vi.unstubAllGlobals());

describe('the worker', () => {
  it('keeps the schema and the document it read, generates, and says what went wrong as an answer', async () => {
    vi.stubGlobal('self', scope);
    await import('./json-schema.worker');
    expect(scope.onmessage).toBeTypeOf('function');
    const reply = (k: number) => scope.postMessage.mock.calls[k]![0] as JobReply;
    const base = { fallback: '2020-12', formats: false };

    scope.onmessage!({
      data: {
        id: 1,
        kind: 'validate',
        request: { ...base, schemaKey: 1, schema: '{"type":"string"}', referenced: [], documentKey: 1, document: '1' },
      },
    });
    expect(reply(0)).toMatchObject({
      id: 1,
      result: { kind: 'validate', reply: { outcome: { kind: 'checked', count: 1 } } },
    });

    // The same schema: only the document comes.
    scope.onmessage!({
      data: { id: 2, kind: 'validate', request: { ...base, schemaKey: 1, documentKey: 2, document: '"a"' } },
    });
    expect(reply(1)).toMatchObject({ id: 2, result: { kind: 'validate', reply: { outcome: { valid: true } } } });

    // A schema the worker has not seen, without its text.
    scope.onmessage!({ data: { id: 3, kind: 'validate', request: { ...base, schemaKey: 9, documentKey: 2 } } });
    expect(reply(2)).toEqual({ id: 3, error: 'Error: the schema did not reach the worker' });

    scope.onmessage!({
      data: {
        id: 4,
        kind: 'infer',
        samples: '{"a":1}',
        options: { draft: '2020-12', enums: false, formats: false, closed: false },
      },
    });
    expect(reply(3)).toMatchObject({ id: 4, result: { kind: 'infer', reply: { state: 'ok', samples: 1 } } });

    scope.onmessage!({ data: { id: 5, kind: 'validate', request: null } });
    expect(reply(4)).toMatchObject({ id: 5, error: expect.stringMatching(/^TypeError: /) });
  });
});
