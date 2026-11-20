import { isFromViewer, isToViewer } from './viewerProtocol';
import { describe, expect, it } from 'vitest';

const texts = { path: 'a.rs', language: 'rust', oldText: 'a\n', newText: 'b\n' };

describe('viewer protocol', () => {
  it('the editor page takes two texts with a request id, and nothing else', () => {
    expect(isToViewer({ type: 'viewer/compare', id: 1, request: texts })).toBe(true);
    expect(isToViewer({ type: 'viewer/compare', id: 2, request: { ...texts, options: { lineDiffer: 'myers' } } })).toBe(
      true,
    );
    expect(isToViewer({ type: 'viewer/compare', request: texts })).toBe(false);
    expect(isToViewer({ type: 'viewer/compare', id: 1, request: { path: 'a.rs' } })).toBe(false);
    // The former message with ready hunks is not part of the protocol any more.
    expect(isToViewer({ type: 'viewer/show-diff', payload: { ...texts, hunks: [] } })).toBe(false);
    expect(isToViewer(null)).toBe(false);
  });

  it('the main page takes ready, results and errors tied to a request', () => {
    const shown = { path: 'a.rs', changes: 1, added: 1, removed: 1, lineDiffer: 'histogram', compareMs: 0.1 };
    expect(isFromViewer({ type: 'viewer/ready' })).toBe(true);
    expect(isFromViewer({ type: 'viewer/shown', id: 3, shown })).toBe(true);
    expect(isFromViewer({ type: 'viewer/shown', path: 'a.rs' })).toBe(false);
    expect(isFromViewer({ type: 'viewer/error', id: 3, message: 'unknown lineDiffer' })).toBe(true);
    expect(isFromViewer({ type: 'viewer/error', message: 'could not start' })).toBe(true);
    expect(isFromViewer({ type: 'viewer/error', id: '3', message: 'x' })).toBe(false);
  });
});
