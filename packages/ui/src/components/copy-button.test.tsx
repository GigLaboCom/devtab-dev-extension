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
});
