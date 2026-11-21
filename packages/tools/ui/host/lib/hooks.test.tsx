// @vitest-environment jsdom
import { useRestore, useToolHistory } from './hooks';
import { memoryHost } from './host';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { RestoreRequest, ToolHost } from './host';
import type { HistoryDeclaration, OpenedEntry } from '@workspace/tools-shared/history';
import type { ReactElement } from 'react';

const DECLARATION: HistoryDeclaration = {
  kinds: [
    { id: 'edit', title: 'Edit' },
    { id: 'result', title: 'Result' },
  ],
  schema: 1,
  records: 'test',
  never: 'test',
};

afterEach(cleanup);

let api: ReturnType<typeof useToolHistory> | undefined;
let restored: OpenedEntry | undefined;

const Probe = ({ host, restore }: { host?: ToolHost; restore?: RestoreRequest }): ReactElement => {
  api = useToolHistory(host, 'probe', DECLARATION);
  useRestore(api.history, restore, opened => {
    restored = opened;
  });
  return <p>{api.status.gate}</p>;
};

const settle = () => act(() => new Promise(r => setTimeout(r, 10)));

describe('useToolHistory', () => {
  it('works with no host at all (an in-memory history)', async () => {
    render(<Probe />);
    expect(api!.status).toEqual({ gate: 'on', secrets: 'no-password', declared: true });
    const outcome = await api!.recorder.commit({ kind: 'result', payload: { n: 1 } });
    expect(outcome.recorded).toBe(true);
    expect((await api!.history.list()).entries).toHaveLength(1);
  });

  it('writes a pending change when the page is hidden, and when the tool goes away', async () => {
    const host = memoryHost();
    const view = render(<Probe host={host} />);
    api!.recorder.change({ kind: 'edit', payload: { text: 'a' } });
    await act(async () => {
      dispatchEvent(new Event('pagehide'));
    });
    await settle();
    expect((await api!.history.list()).entries).toHaveLength(1);
    api!.recorder.change({ kind: 'edit', payload: { text: 'ab' } });
    const history = api!.history;
    view.unmount();
    await settle();
    expect((await history.list()).entries.map(e => e.kind)).toEqual(['edit', 'edit']);
  });

  it('opens the entry the host asks for', async () => {
    const host = memoryHost();
    const first = render(<Probe host={host} />);
    const outcome = await api!.recorder.commit({ kind: 'result', payload: { n: 42 }, label: 'forty-two' });
    first.unmount();
    restored = undefined;
    render(<Probe host={host} restore={{ id: outcome.recorded ? outcome.id : '' }} />);
    await settle();
    expect(restored).toMatchObject({ ok: true, payload: { n: 42 }, label: 'forty-two' });
  });
});
