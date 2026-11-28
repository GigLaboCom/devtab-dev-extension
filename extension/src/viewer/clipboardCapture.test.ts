import { captureClipboardWrites } from './clipboardCapture';
import { describe, expect, it, vi } from 'vitest';

class FakeClipboard {
  written: string[] = [];
  writeText(text: string): Promise<void> {
    this.written.push(text);
    return Promise.resolve();
  }
}

describe('captureClipboardWrites', () => {
  it('takes what the call writes instead of writing it, and puts the clipboard back as it was', async () => {
    const clipboard = new FakeClipboard();
    const copied = captureClipboardWrites(clipboard, () => void clipboard.writeText('selected text'));
    expect(copied).toBe('selected text');
    expect(clipboard.written).toEqual([]);
    expect(Object.getOwnPropertyDescriptor(clipboard, 'writeText')).toBeUndefined();
    await clipboard.writeText('later, by a key');
    expect(clipboard.written).toEqual(['later, by a key']);
  });

  it('a call that writes nothing takes nothing; a throwing call still puts the clipboard back', () => {
    const clipboard = new FakeClipboard();
    expect(captureClipboardWrites(clipboard, () => undefined)).toBeUndefined();
    expect(() =>
      captureClipboardWrites(clipboard, () => {
        throw new Error('cut: the new side is read-only');
      }),
    ).toThrow('read-only');
    expect(Object.getOwnPropertyDescriptor(clipboard, 'writeText')).toBeUndefined();
    const run = vi.fn();
    expect(captureClipboardWrites(undefined, run)).toBeUndefined();
    expect(run).toHaveBeenCalledOnce();
  });
});
