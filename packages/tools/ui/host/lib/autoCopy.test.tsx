// @vitest-environment jsdom
import { AUTO_COPY, announceGenerated, autoCopyApplies, useAutoCopy } from './autoCopy';
import { memoryHost } from './host';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AutoCopy } from './autoCopy';
import type { ToolHost } from './host';
import type { ReactElement } from 'react';

afterEach(cleanup);

let api: AutoCopy | undefined;
const Probe = ({ host, write }: { host?: ToolHost; write?: (text: string) => Promise<void> }): ReactElement => {
  api = useAutoCopy(host, 'password', write);
  return <p>{api.on ? 'on' : 'off'}</p>;
};

describe('useAutoCopy', () => {
  it('is off with no host at all, and writes nothing then', async () => {
    const written: string[] = [];
    render(<Probe write={async t => void written.push(t)} />);
    expect(api!.on).toBe(false);
    expect(await act(() => api!.afterGenerate('abc'))).toBeNull();
    expect(written).toEqual([]);
    expect(api!.outcome).toBeNull();
  });

  it('follows the tool’s entry live, and writes what it is given once on', async () => {
    const host = memoryHost();
    const written: string[] = [];
    const view = render(<Probe host={host} write={async t => void written.push(t)} />);
    expect(view.container.textContent).toBe('off');
    await act(() => host.settings.forTool('password').set({ [AUTO_COPY]: true }));
    expect(view.container.textContent).toBe('on');
    const outcome = await act(() => api!.afterGenerate('one\ntwo'));
    expect(outcome).toEqual({ text: 'one\ntwo', ok: true });
    expect(written).toEqual(['one\ntwo']);
    expect(api!.outcome).toEqual({ text: 'one\ntwo', ok: true });
    // Another tool's entry is not this one's.
    await act(() => host.settings.forTool('uuid').set({ [AUTO_COPY]: false }));
    expect(api!.on).toBe(true);
  });

  it('reports the browser’s refusal word for word and keeps nothing else', async () => {
    const host = memoryHost();
    await host.settings.setForAll(['password'], { [AUTO_COPY]: true });
    const refuse = async () => {
      throw new DOMException(
        "Failed to execute 'writeText' on 'Clipboard': Document is not focused.",
        'NotAllowedError',
      );
    };
    render(<Probe host={host} write={refuse} />);
    const outcome = await act(() => api!.afterGenerate('x'));
    expect(outcome).toEqual({
      text: 'x',
      ok: false,
      error: "NotAllowedError: Failed to execute 'writeText' on 'Clipboard': Document is not focused.",
    });
  });
});

describe('the applicability mark and the announcement', () => {
  it('applies to a tool that makes values on request, not to one that derives its result', () => {
    expect(autoCopyApplies({ output: { origin: 'generated', copies: 'lines' } })).toBe(true);
    expect(autoCopyApplies({ output: { origin: 'input' } })).toBe(false);
  });

  it('says what was generated and what the automatic copy did, in one sentence', () => {
    expect(announceGenerated('5 new passwords generated', null)).toBe('5 new passwords generated');
    expect(announceGenerated('5 new passwords generated', { text: 'a', ok: true })).toBe(
      '5 new passwords generated and copied',
    );
    expect(announceGenerated('New identifier generated', { text: 'a', ok: false, error: 'e' })).toBe(
      'New identifier generated, not copied automatically',
    );
  });
});
