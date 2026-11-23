/**
 * «Compare code» against a stand-in editor page and stand-in browser seams: what the page sends the editor (texts,
 * never hunks; one side; the language; edit mode; reads), what it takes back (only the answer to its latest request,
 * or the result of an edit), and the rules the owner set — the example when nothing is loaded, two files distributed,
 * one file on its side, read-only until Edit.
 */
import { ComparePage } from './ComparePage';
import { compareActions } from '@src/compare/actions';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiffShown } from '@extension/review-wasm';
import type { CompareBehaviors } from '@src/compare/behaviors';
import type { ExamplePair } from '@src/compare/examples';
import type { FrameKeys } from '@src/shared/keys';
import type { DroppedEntry, FromViewer, ToViewer } from '@src/shared/viewerProtocol';

const pairs: Record<string, ExamplePair> = {
  rust: {
    language: 'rust',
    before: { name: 'before.rs', text: 'fn a() {}\n' },
    after: { name: 'after.rs', text: 'fn a() { 1 }\n' },
  },
  python: {
    language: 'python',
    before: { name: 'before.py', text: 'a = 1\n' },
    after: { name: 'after.py', text: 'a = 2\n' },
  },
};

const shown = (changes: number, over: Partial<DiffShown> = {}): DiffShown => ({
  path: 'after.rs',
  changes,
  added: changes,
  removed: changes,
  lineDiffer: 'histogram',
  compareMs: 0.2,
  updateMs: 0.4,
  cause: 'request',
  sides: {
    old: { editable: false, modified: false, empty: false },
    new: { editable: false, modified: false, empty: false },
  },
  ...over,
});

const fakeBehaviors = () => {
  const behaviors: CompareBehaviors = {
    texts: {
      pick: vi.fn(() => Promise.resolve(null)),
      drop: vi.fn(async (entries: readonly DroppedEntry[]) => ({
        texts: await Promise.all(
          entries.map(async e => ({
            text: (await e.file?.text()) ?? e.text ?? '',
            fileName: e.file?.name ?? null,
            handle: null,
            bom: false,
          })),
        ),
        problems: [],
      })),
    },
    clipboard: { read: vi.fn(() => Promise.resolve({ text: 'pasted\n' })), write: vi.fn(() => Promise.resolve()) },
    examples: { load: vi.fn(language => Promise.resolve(pairs[language] ?? null)) },
    saver: {
      name: 'fake',
      save: vi.fn(() =>
        Promise.resolve({ status: 'saved' as const, fileName: 'x.rs', handle: null, how: 'file' as const }),
      ),
      saveAs: vi.fn(() => Promise.resolve({ status: 'cancelled' as const })),
    },
    confirmDiscard: vi.fn(() => Promise.resolve(true)),
    actions: compareActions,
  };
  return behaviors;
};

const setup = async (behaviors = fakeBehaviors(), frameKeys?: FrameKeys) => {
  render(<ComparePage behaviors={behaviors} frameKeys={frameKeys} />);
  const frame = screen.getByTitle('Side-by-side comparison') as HTMLIFrameElement;
  const viewer = frame.contentWindow!;
  // jsdom has no focus for windows; the page focuses the editor's frame when a side goes into edit mode.
  viewer.focus = () => undefined;
  const sent = vi.spyOn(viewer, 'postMessage').mockImplementation(() => undefined);
  const answer = async (data: FromViewer, source: Window = viewer) =>
    act(async () => {
      window.dispatchEvent(new MessageEvent('message', { data, origin: location.origin, source }));
    });
  const messages = () => sent.mock.calls.map(([message]) => message as ToViewer);
  const last = () => messages().at(-1)!;
  const counts = () => document.querySelector<HTMLElement>('.kit-compare-counts')!;
  const notice = () => screen.getByRole('status');
  const button = (side: 'old' | 'new' | null, action: string) =>
    document.querySelector<HTMLButtonElement>(
      `${side ? `[data-side="${side}"]` : '.kit-compare-tools'} [data-action="${action}"]`,
    )!;
  const ready = async () => {
    await waitFor(() => expect(behaviors.examples.load).toHaveBeenCalled());
    await answer({ type: 'viewer/ready' });
  };
  return { behaviors, answer, messages, last, counts, notice, button, ready, sent };
};

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('ComparePage', () => {
  it('opens on the example: the editor gets the pair once it is ready, the sides say what they show', async () => {
    const { messages, answer, counts, ready, sent } = await setup();
    expect(messages()).toEqual([]);
    await ready();
    expect(messages()).toEqual([
      {
        type: 'viewer/keys',
        keys: [
          { key: 's', mod: true, shift: false },
          { key: 's', mod: true, shift: true },
        ],
      },
      {
        type: 'viewer/compare',
        id: 1,
        request: { path: 'after.rs', language: 'rust', oldText: 'fn a() {}\n', newText: 'fn a() { 1 }\n' },
      },
    ]);
    expect(sent.mock.calls[0]![1]).toBe(location.origin);
    await answer({ type: 'viewer/shown', id: 1, shown: shown(3) });
    expect(counts().textContent).toBe('3 changes+3−3');
    expect(counts().dataset.shown).toBe('1');
    expect(screen.getByRole('group', { name: 'Original side' }).textContent).toContain('before.rs');
    expect(screen.getAllByText('Example')).toHaveLength(2);
    expect(screen.getByRole('status').textContent).toMatch(/This is an example/);
  });

  it('switches the example with the language while both sides show it', async () => {
    const { behaviors, ready, last } = await setup();
    await ready();
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Language'));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole('option', { name: 'Python' }));
    });
    await waitFor(() => expect(behaviors.examples.load).toHaveBeenCalledWith('python'));
    await waitFor(() =>
      expect(last()).toMatchObject({ type: 'viewer/compare', request: { language: 'python', oldText: 'a = 1\n' } }),
    );
  });

  it('takes only the answer to its latest request — and the result of an edit, which answers none', async () => {
    const { answer, counts, ready } = await setup();
    await ready();
    await answer({ type: 'viewer/shown', id: 99, shown: shown(9) });
    await answer({ type: 'viewer/shown', shown: shown(8) }); // no id, not an edit: ignored
    expect(counts().dataset.shown).toBe('0');
    await answer({ type: 'viewer/shown', id: 1, shown: shown(1) });
    expect(counts().textContent).toBe('1 change+1−1');
    await answer({
      type: 'viewer/shown',
      shown: shown(2, {
        cause: 'edit',
        sides: { old: shown(0).sides.old, new: { editable: true, modified: true, empty: false } },
      }),
    });
    expect(counts().textContent).toBe('2 changes+2−2');
    expect(screen.getByRole('group', { name: 'Changed side' }).textContent).toContain('Edited');
  });

  it('two dropped files: the first is the original, the second the changed text; the language follows the file', async () => {
    const { answer, last, ready } = await setup();
    await ready();
    await answer({ type: 'viewer/drag' });
    const target = document.querySelector('.kit-compare-drop-target[data-side="new"]')!;
    const files = [new File(['one\n'], 'one.go'), new File(['two\n'], 'two.go')];
    const items = files.map(() => ({ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) }));
    await act(async () => {
      fireEvent.drop(target, { dataTransfer: { files, items, types: ['Files'], getData: () => '' } });
    });
    await waitFor(() =>
      expect(last()).toEqual({
        type: 'viewer/compare',
        id: 2,
        request: { path: 'two.go', language: 'go', oldText: 'one\n', newText: 'two\n' },
      }),
    );
    expect(screen.getByRole('group', { name: 'Original side' }).textContent).toContain('one.go');
    expect(document.querySelector('.kit-compare-drop')).toBeNull();
  });

  it('one file goes on the side it is dropped on — also through the editor; beside both, nowhere', async () => {
    const { answer, last, messages, notice, ready } = await setup();
    await ready();
    await answer({
      type: 'viewer/drop',
      side: 'old',
      entries: [{ name: 'a.py', file: new File(['x = 1\n'], 'a.py'), handle: null, directory: false, text: null }],
    });
    // The other side showed the example: it goes too, so both sides change in one request.
    await waitFor(() =>
      expect(last()).toMatchObject({
        type: 'viewer/compare',
        request: { oldText: 'x = 1\n', newText: '', language: 'python' },
      }),
    );
    await answer({
      type: 'viewer/drop',
      side: 'new',
      entries: [{ name: 'b.py', file: new File(['x = 2\n'], 'b.py'), handle: null, directory: false, text: null }],
    });
    await waitFor(() =>
      expect(last()).toMatchObject({ type: 'viewer/set-side', request: { side: 'new', text: 'x = 2\n' } }),
    );
    const before = messages().length;
    await act(async () => {
      fireEvent.drop(window, {
        dataTransfer: {
          files: [new File(['z'], 'z.py')],
          items: [{ kind: 'file' }],
          types: ['Files'],
          getData: () => '',
        },
      });
    });
    await waitFor(() =>
      expect(notice().textContent).toMatch(/drop it on the left \(original\) or the right \(changed\)/),
    );
    expect(messages().length).toBe(before);
  });

  it('Paste replaces a side with the clipboard text; a refused read says what to do instead', async () => {
    const { behaviors, button, last, notice, ready } = await setup();
    await ready();
    await act(async () => fireEvent.click(button('new', 'paste')));
    await waitFor(() =>
      expect(last()).toMatchObject({ type: 'viewer/compare', request: { oldText: '', newText: 'pasted\n' } }),
    );
    expect(screen.getByRole('group', { name: 'Changed side' }).textContent).toContain('Pasted text');
    vi.mocked(behaviors.clipboard.read).mockResolvedValueOnce({ refused: 'Chrome did not allow it.' });
    await act(async () => fireEvent.click(button('old', 'paste')));
    await waitFor(() => expect(notice().textContent).toBe('Chrome did not allow it.'));
  });

  it('read-only until Edit; Copy and Save read the side from the editor', async () => {
    const { behaviors, answer, button, last, ready } = await setup();
    expect(button('new', 'edit').disabled).toBe(true);
    await ready();
    expect(button('new', 'edit').getAttribute('aria-pressed')).toBe('false');
    await act(async () => fireEvent.click(button('new', 'edit')));
    expect(last()).toEqual({ type: 'viewer/set-editable', side: 'new', editable: true, focus: true });
    expect(button('new', 'edit').getAttribute('aria-pressed')).toBe('true');

    await act(async () => fireEvent.click(button('new', 'copy')));
    const read = last() as Extract<ToViewer, { type: 'viewer/read' }>;
    expect(read).toMatchObject({ type: 'viewer/read', side: 'new' });
    await answer({ type: 'viewer/text', id: read.id, side: 'new', text: 'typed\nhere\n' });
    await waitFor(() => expect(behaviors.clipboard.write).toHaveBeenCalledWith('typed\nhere\n'));

    // ⌘S from inside the editor saves the side the editor says has the keyboard.
    await answer({ type: 'viewer/key', chord: { key: 's', mod: true, shift: false }, side: 'old' });
    const saveRead = last() as Extract<ToViewer, { type: 'viewer/read' }>;
    expect(saveRead).toMatchObject({ type: 'viewer/read', side: 'old' });
    await answer({ type: 'viewer/text', id: saveRead.id, side: 'old', text: 'fn a() {}\n' });
    await waitFor(() =>
      expect(behaviors.saver.save).toHaveBeenCalledWith({
        text: 'fn a() {}\n',
        bom: false,
        suggestedName: 'before.rs',
        handle: null,
      }),
    );
    await waitFor(() => expect(last()).toMatchObject({ type: 'viewer/mark-saved', side: 'old', text: 'fn a() {}\n' }));
  });

  it('asks before new text replaces unsaved edits, and keeps them on "no"', async () => {
    const behaviors = fakeBehaviors();
    vi.mocked(behaviors.confirmDiscard).mockResolvedValue(false);
    const { answer, button, messages, ready } = await setup(behaviors);
    await ready();
    await answer({
      type: 'viewer/shown',
      shown: shown(1, {
        cause: 'edit',
        sides: { old: shown(0).sides.old, new: { editable: true, modified: true, empty: false } },
      }),
    });
    const before = messages().length;
    await act(async () => fireEvent.click(button('new', 'paste')));
    await waitFor(() =>
      expect(behaviors.confirmDiscard).toHaveBeenCalledWith(expect.stringMatching(/the changed side/)),
    );
    expect(messages().length).toBe(before);
  });

  it('Clear on both sides leaves the empty state, with the example a click away', async () => {
    const { answer, button, ready } = await setup();
    await ready();
    await answer({ type: 'viewer/shown', id: 1, shown: shown(1) });
    await act(async () => fireEvent.click(button('old', 'clear')));
    expect(screen.getByText('Nothing to compare')).toBeTruthy();
    expect(button('new', 'clear').disabled).toBe(true);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Show the example' })));
    await waitFor(() => expect(screen.getAllByText('Example')).toHaveLength(2));
  });

  it('says so when the example cannot be loaded (its file is gone), instead of doing nothing', async () => {
    const behaviors = fakeBehaviors();
    behaviors.examples.load = vi.fn(() => Promise.reject(new Error('Failed to fetch dynamically imported module')));
    const { notice } = await setup(behaviors);
    await waitFor(() =>
      expect(notice().textContent).toBe('The example could not be loaded. Reload this page and try again.'),
    );
  });

  it('ignores messages from anywhere but its editor page, and says when the editor could not start', async () => {
    const { answer, counts, messages, notice } = await setup();
    await answer({ type: 'viewer/ready' }, window);
    expect(messages()).toEqual([]);
    expect(counts().dataset.viewerState).toBe('loading');
    await answer({ type: 'viewer/error', message: 'no WebGPU or WebGL2' });
    expect(counts().dataset.viewerState).toBe('error');
    expect(notice().textContent).toBe('The editor could not start. no WebGPU or WebGL2');
  });
  it('asks the editor to hand up the frame’s shortcuts too, and gives them back to the frame', async () => {
    const find = { key: 'k', mod: true, shift: false };
    const frameKeys: FrameKeys = { keys: [find], run: vi.fn(() => true) };
    const behaviors = fakeBehaviors();
    const { messages, answer, ready } = await setup(behaviors, frameKeys);
    await ready();
    expect(messages()[0]).toEqual({
      type: 'viewer/keys',
      keys: [{ key: 's', mod: true, shift: false }, { key: 's', mod: true, shift: true }, find],
    });
    // ⌘K pressed in the editor: no action of the page has it, so the frame takes it (the shell opens its palette).
    await answer({ type: 'viewer/key', chord: find, side: 'new' });
    expect(frameKeys.run).toHaveBeenCalledWith(find);
    // ⌘S stays the page's: the frame never sees it.
    await answer({ type: 'viewer/key', chord: { key: 's', mod: true, shift: false }, side: 'old' });
    expect(frameKeys.run).toHaveBeenCalledTimes(1);
  });
});
