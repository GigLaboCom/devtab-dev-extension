import { definition } from './definition';
import TextDiffTool, { UNAVAILABLE } from './TextDiffTool';
import { act, cleanup, render, screen } from '@testing-library/react';
import { memoryHost } from '@workspace/tools-host';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolHost, ToolNavigation } from '@workspace/tools-host';

afterEach(cleanup);

/** A host whose navigation answers `went` and records where it was asked to go. */
const hostGoing = (went: boolean | Error) => {
  const go = vi.fn<ToolNavigation['go']>(() => (went instanceof Error ? Promise.reject(went) : Promise.resolve(went)));
  const host: ToolHost = { ...memoryHost(), navigation: { go } };
  return { host, go };
};

const settle = () => act(() => new Promise(r => setTimeout(r, 0)));

describe('the Text Diff tool’s definition', () => {
  it('is described by its definition, which loads it', async () => {
    expect(definition.id).toBe('text-diff');
    expect((await definition.load()).default).toBe(TextDiffTool);
  });

  it('is the registry’s number 10, found by the specification’s keywords, with no detect and no shortcut', () => {
    expect(definition).toMatchObject({
      title: 'Text Diff',
      summary: 'Compare two texts side by side. Opens Compare code.',
      order: 10,
      output: { origin: 'input' },
    });
    expect(definition.keywords).toEqual([
      'diff',
      'text diff',
      'compare',
      'difference',
      'changes',
      'side by side',
      'merge',
    ]);
    expect(definition.shortcut).toBeUndefined();
  });

  it('declares that it keeps nothing (docs/tools/history.md §10)', () => {
    expect(definition.history?.kinds).toEqual([]);
  });
});

describe('the Text Diff tool', () => {
  // §2 scenarios 1–2, §4, §10 rows 4–5: opened, the tool goes to «Compare code» in place of its own address.
  it('asks the host to go to Compare code, replacing its own address, and hands nothing over', async () => {
    const { host, go } = hostGoing(true);
    const { container } = render(<TextDiffTool host={host} />);
    await settle();
    expect(go).toHaveBeenCalledWith({ part: 'compare' }, { replace: true });
    expect(go.mock.calls.every(([, options]) => options?.payload === undefined)).toBe(true);
    // §5.2: an empty area while the host goes — nothing of a page of its own.
    expect(container.textContent).toBe('');
  });

  it('ignores a text a host hands it: it has no input of its own (§3, §7)', async () => {
    const { host, go } = hostGoing(true);
    const { container } = render(<TextDiffTool host={host} input="a\nb\n" />);
    await settle();
    expect(go).toHaveBeenCalledWith({ part: 'compare' }, { replace: true });
    expect(container.textContent).toBe('');
  });

  it('renders with no host at all and says where it leads and that it is not here', async () => {
    render(<TextDiffTool />);
    expect(await screen.findByRole('status')).toHaveProperty('textContent', UNAVAILABLE);
  });

  it('says the same when its host has no comparison, or fails to go', async () => {
    render(<TextDiffTool host={hostGoing(false).host} />);
    expect((await screen.findByRole('status')).textContent).toBe(UNAVAILABLE);
    cleanup();
    render(<TextDiffTool host={hostGoing(new Error('router gone')).host} />);
    expect((await screen.findByRole('status')).textContent).toBe(UNAVAILABLE);
  });

  it('records nothing in the history', async () => {
    const { host } = hostGoing(true);
    render(<TextDiffTool host={host} />);
    await settle();
    const history = host.history.forOwner('text-diff', definition.history!);
    expect((await history.list({})).entries).toEqual([]);
  });

  it('does not answer after it is gone (the host went and unmounted it)', async () => {
    let answer: (went: boolean) => void = () => undefined;
    const go = vi.fn<ToolNavigation['go']>(() => new Promise<boolean>(r => (answer = r)));
    const { unmount } = render(<TextDiffTool host={{ ...memoryHost(), navigation: { go } }} />);
    unmount();
    answer(false);
    await settle();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
