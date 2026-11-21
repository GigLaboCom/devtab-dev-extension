/**
 * «Compare code» taking texts another part of the page handed over — a tool sending the person here through
 * `ToolHost.navigation` (src/tools/navigation.ts → compare/handoff.ts → the default TextSource's `handed`). They come
 * instead of the example: two are the original and the changed text, one is the original; marked as pasted text, in
 * plain text unless a name tells the language. Without a hand-off the page opens as it always did.
 */
import { ComparePage } from './ComparePage';
import { compareActions } from '@src/compare/actions';
import { takeHandedTexts } from '@src/compare/handoff';
import { browserTextSource } from '@src/compare/textSource';
import { pageNavigation } from '@src/tools/navigation';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompareBehaviors } from '@src/compare/behaviors';
import type { SideText } from '@src/compare/files';
import type { FromViewer, ToViewer } from '@src/shared/viewerProtocol';

const behaviorsWith = (texts: CompareBehaviors['texts']): CompareBehaviors => ({
  texts,
  clipboard: { read: vi.fn(() => Promise.resolve({ text: '' })), write: vi.fn(() => Promise.resolve()) },
  examples: {
    load: vi.fn(() =>
      Promise.resolve({
        language: 'rust',
        before: { name: 'before.rs', text: 'fn a() {}\n' },
        after: { name: 'after.rs', text: 'fn a() { 1 }\n' },
      }),
    ),
  },
  saver: {
    name: 'fake',
    save: vi.fn(() => Promise.resolve({ status: 'cancelled' as const })),
    saveAs: vi.fn(() => Promise.resolve({ status: 'cancelled' as const })),
  },
  confirmDiscard: vi.fn(() => Promise.resolve(true)),
  actions: compareActions,
});

const handing = (texts: SideText[]) =>
  behaviorsWith({
    pick: vi.fn(() => Promise.resolve(null)),
    drop: vi.fn(() => Promise.resolve({ texts: [], problems: [] })),
    handed: vi.fn(() => texts),
  });

const plain = (text: string, fileName: string | null = null): SideText => ({
  text,
  fileName,
  handle: null,
  bom: false,
});

const open = async (behaviors: CompareBehaviors) => {
  render(<ComparePage behaviors={behaviors} />);
  const viewer = (screen.getByTitle('Side-by-side comparison') as HTMLIFrameElement).contentWindow!;
  viewer.focus = () => undefined;
  const sent = vi.spyOn(viewer, 'postMessage').mockImplementation(() => undefined);
  const answer = (data: FromViewer) =>
    act(async () => {
      window.dispatchEvent(new MessageEvent('message', { data, origin: location.origin, source: viewer }));
    });
  await act(() => new Promise(r => setTimeout(r, 0)));
  await answer({ type: 'viewer/ready' });
  const compares = () =>
    sent.mock.calls
      .map(([m]) => m as ToViewer)
      .filter(m => m.type === 'viewer/compare' || m.type === 'viewer/set-side');
  const side = (name: string) => screen.getByRole('group', { name }).textContent ?? '';
  return { compares, side, answer };
};

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  takeHandedTexts();
});

describe('ComparePage with texts handed over', () => {
  it('two texts: the original and the changed text, as pasted text in plain text, instead of the example', async () => {
    const behaviors = handing([plain('a\nb\n'), plain('a\nb')]);
    const { compares, side } = await open(behaviors);
    expect(compares()).toEqual([
      {
        type: 'viewer/compare',
        id: expect.any(Number),
        request: { path: 'untitled', language: 'text', oldText: 'a\nb\n', newText: 'a\nb' },
      },
    ]);
    expect(behaviors.examples.load).not.toHaveBeenCalled();
    expect(side('Original side')).toContain('Pasted text');
    expect(side('Changed side')).toContain('Pasted text');
    expect(screen.queryByText('Example')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe(
      'Comparing the pasted texts: the original on the left, the changed text on the right.',
    );
    expect(screen.getByLabelText('Language').textContent).toBe('Plain text');
  });

  it('names tell the side’s name and the language', async () => {
    const { compares, side } = await open(handing([plain('{"a":1}\n', 'old.json'), plain('{"a":2}\n', 'new.json')]));
    expect(compares()).toEqual([
      expect.objectContaining({ request: expect.objectContaining({ path: 'new.json', language: 'json' }) }),
    ]);
    expect(side('Original side')).toContain('old.json');
  });

  it('one text is the original; the changed side is empty to bring the other text to', async () => {
    const { compares, side } = await open(handing([plain('only\n')]));
    expect(compares()).toEqual([
      expect.objectContaining({
        type: 'viewer/compare',
        request: expect.objectContaining({ oldText: 'only\n', newText: '' }),
      }),
    ]);
    expect(side('Changed side')).toContain('Empty');
  });

  it('nothing handed over: the example, as before', async () => {
    const behaviors = handing([]);
    const { compares } = await open(behaviors);
    await waitFor(() => expect(behaviors.examples.load).toHaveBeenCalledWith('rust'));
    expect(compares()).toEqual([
      expect.objectContaining({ request: expect.objectContaining({ path: 'after.rs', language: 'rust' }) }),
    ]);
  });

  it('end to end in this page: a tool’s navigation hands two texts in memory, the default TextSource gives them once', async () => {
    window.location.hash = '#/tools/text-diff';
    const went = await pageNavigation(window).go(
      { part: 'compare' },
      { replace: true, payload: { texts: [{ text: 'a\r\nb\r\n' }, { text: 'a\nb\n' }] } },
    );
    expect(went).toBe(true);
    expect(window.location.href).not.toContain('a%0D');
    expect(window.location.hash).toBe('#/compare');
    const texts = browserTextSource(window);
    const { compares, side } = await open(behaviorsWith(texts));
    expect(compares()).toEqual([
      expect.objectContaining({ request: expect.objectContaining({ oldText: 'a\r\nb\r\n', newText: 'a\nb\n' }) }),
    ]);
    expect(side('Original side')).toContain('Pasted text');
    // Taken: a second visit opens on the example.
    expect(texts.handed!()).toEqual([]);
  });
});
