/**
 * «Compare code» against a stand-in editor page: the page sends the two texts (never hunks) with a request id, shows
 * the counts the module answers with, and takes only the answer to its latest request.
 */
import { ComparePage } from './ComparePage';
import newSample from '@src/compare/fixtures/new.rs?raw';
import oldSample from '@src/compare/fixtures/old.rs?raw';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiffShown } from '@extension/review-wasm';
import type { FromViewer, ToViewer } from '@src/shared/viewerProtocol';

const shown = (changes: number, added: number, removed: number): DiffShown => ({
  path: 'example/new.rs',
  changes,
  added,
  removed,
  lineDiffer: 'histogram',
  compareMs: 1.5,
});

const setup = () => {
  render(<ComparePage />);
  const frame = screen.getByTitle('Side-by-side comparison') as HTMLIFrameElement;
  const viewer = frame.contentWindow!;
  const sent = vi.spyOn(viewer, 'postMessage').mockImplementation(() => undefined);
  const answer = (data: FromViewer, source: Window = viewer) =>
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data, origin: location.origin, source }));
    });
  const requests = () => sent.mock.calls.map(([message]) => message as ToViewer);
  const status = () => screen.getByRole('status');
  return { answer, requests, status, sent };
};

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('ComparePage', () => {
  it('sends the two texts once the editor is ready and shows the counts the module answers with', () => {
    const { answer, requests, status, sent } = setup();
    expect(requests()).toEqual([]);
    answer({ type: 'viewer/ready' });
    expect(requests()).toEqual([
      {
        type: 'viewer/compare',
        id: 1,
        request: { path: 'example/new.rs', language: 'rust', oldText: oldSample, newText: newSample },
      },
    ]);
    expect(sent.mock.calls[0][1]).toBe(location.origin);
    expect(status().textContent).toBe('');
    answer({ type: 'viewer/shown', id: 1, shown: shown(3, 5, 2) });
    expect(status().textContent).toBe('3 changes · +5 −2 lines');
    expect(status().dataset.shown).toBe('1');
    answer({ type: 'viewer/shown', id: 1, shown: shown(0, 0, 0) });
    expect(status().textContent).toBe('No differences.');
  });

  it('takes only the answer to the latest request', () => {
    const { answer, requests, status } = setup();
    answer({ type: 'viewer/ready' });
    fireEvent.change(screen.getByLabelText(/^Before/), { target: { value: 'a\n' } });
    fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
    fireEvent.change(screen.getByLabelText(/^After/), { target: { value: 'b\n' } });
    fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
    expect(requests().map(r => [r.id, r.request.oldText, r.request.newText])).toEqual([
      [1, oldSample, newSample],
      [2, 'a\n', newSample],
      [3, 'a\n', 'b\n'],
    ]);
    answer({ type: 'viewer/shown', id: 2, shown: shown(9, 9, 9) });
    answer({ type: 'viewer/error', id: 1, message: 'stale' });
    expect(status().textContent).toBe('');
    answer({ type: 'viewer/shown', id: 3, shown: shown(1, 1, 1) });
    expect(status().textContent).toBe('1 change · +1 −1 lines');
  });

  it('shows what the module refused for the latest request', () => {
    const { answer, status } = setup();
    answer({ type: 'viewer/ready' });
    answer({ type: 'viewer/shown', id: 1, shown: shown(4, 17, 6) });
    answer({
      type: 'viewer/error',
      id: 1,
      message: 'compare_texts: unknown lineDiffer "nope"; built in: histogram, myers',
    });
    expect(status().textContent).toBe(
      '4 changes · +17 −6 lines · compare_texts: unknown lineDiffer "nope"; built in: histogram, myers',
    );
    // A new request clears it.
    fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
    expect(status().textContent).toBe('4 changes · +17 −6 lines');
  });

  it('ignores messages from anywhere but its editor page, and reports an editor that could not start', () => {
    const { answer, requests, status } = setup();
    answer({ type: 'viewer/ready' }, window);
    expect(requests()).toEqual([]);
    expect(status().dataset.viewerState).toBe('loading');
    answer({ type: 'viewer/error', message: 'no WebGPU or WebGL2' });
    expect(status().dataset.viewerState).toBe('error');
    expect(status().textContent).toBe('The editor could not start: no WebGPU or WebGL2');
  });
});
