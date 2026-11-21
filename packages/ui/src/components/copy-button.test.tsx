import { CopyButton } from './copy-button';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const flush = () => act(async () => undefined);

describe('CopyButton', () => {
  it('copies the value, says "Copied" until the value changes', async () => {
    const write = vi.fn(() => Promise.resolve());
    const { rerender } = render(<CopyButton value="abc" write={write} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await flush();
    expect(write).toHaveBeenCalledWith('abc');
    expect(screen.getByRole('button').textContent).toBe('Copied');
    rerender(<CopyButton value="abc" write={write} />);
    expect(screen.getByRole('button').textContent).toBe('Copied');
    rerender(<CopyButton value="abd" write={write} />);
    expect(screen.getByRole('button').textContent).toBe('Copy');
  });

  it('"Copied" goes the moment the value changes — also when the write answers after the change', async () => {
    let answer!: () => void;
    const write = vi.fn(() => new Promise<void>(r => (answer = r)));
    const { rerender } = render(<CopyButton value="first" write={write} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    rerender(<CopyButton value="second" write={write} />);
    await act(async () => answer());
    expect(screen.getByRole('button').textContent).toBe('Copy');
    // Back to the copied value: it is the one in the clipboard again.
    rerender(<CopyButton value="first" write={write} />);
    expect(screen.getByRole('button').textContent).toBe('Copied');
  });

  it('a function value says "Copied" until its resetKey changes', async () => {
    const write = vi.fn(() => Promise.resolve());
    const { rerender } = render(<CopyButton value={() => 'v1'} resetKey={1} write={write} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await flush();
    expect(screen.getByRole('button').textContent).toBe('Copied');
    rerender(<CopyButton value={() => 'v1'} resetKey={1} write={write} />);
    expect(screen.getByRole('button').textContent).toBe('Copied');
    rerender(<CopyButton value={() => 'v2'} resetKey={2} write={write} />);
    expect(screen.getByRole('button').textContent).toBe('Copy');
  });

  it('as an icon: the label is its name, "Copied" for resetAfterMs', async () => {
    vi.useFakeTimers();
    const write = vi.fn(() => Promise.resolve());
    render(<CopyButton icon value="ff" label="Copy SHA-256" resetAfterMs={1500} write={write} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy SHA-256' }));
    await flush();
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
    act(() => vi.advanceTimersByTime(1500));
    expect(screen.getByRole('button', { name: 'Copy SHA-256' })).toBeTruthy();
  });

  it('reads a function when pressed, is disabled with nothing to copy, says when the write is refused', async () => {
    const write = vi.fn((text: string) => (text === 'late' ? Promise.reject(new Error('denied')) : Promise.resolve()));
    const onError = vi.fn();
    const { rerender } = render(<CopyButton value="" write={write} />);
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
    rerender(<CopyButton value={() => 'late'} write={write} onError={onError} />);
    fireEvent.click(screen.getByRole('button'));
    await flush();
    expect(write).toHaveBeenCalledWith('late');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button').textContent).toBe('Not copied');
  });
  it('shows a copy made elsewhere (an automatic copy) as "Copied" while it is the value; a refusal leaves it ready', () => {
    const write = vi.fn(() => Promise.resolve());
    const { rerender } = render(<CopyButton value="one" write={write} outcome={null} />);
    expect(screen.getByRole('button').textContent).toBe('Copy');
    rerender(<CopyButton value="two" write={write} outcome={{ text: 'two', ok: false }} />);
    expect(screen.getByRole('button').textContent).toBe('Copy');
    rerender(<CopyButton value="two" write={write} outcome={{ text: 'two', ok: true }} />);
    expect(screen.getByRole('button').textContent).toBe('Copied');
    // A new value: the old copy no longer is this one.
    rerender(<CopyButton value="three" write={write} outcome={{ text: 'two', ok: true }} />);
    expect(screen.getByRole('button').textContent).toBe('Copy');
    expect(write).not.toHaveBeenCalled();
  });
});
