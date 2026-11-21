import { ResultRow, ResultRows } from './result-row';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

describe('ResultRow', () => {
  it('shows the value in an output named after the label, with a copy button', async () => {
    const write = vi.fn(() => Promise.resolve());
    render(
      <ResultRows>
        <ResultRow label="SHA-256" value="e3b0c442" copy={{ write }} extra={<span>Matches</span>} />
      </ResultRows>,
    );
    const output = screen.getByRole('status', { name: 'SHA-256' });
    expect(output.tagName).toBe('OUTPUT');
    expect(output.textContent).toBe('e3b0c442');
    expect(screen.getByText('Matches')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy SHA-256' }));
    await act(async () => undefined);
    expect(write).toHaveBeenCalledWith('e3b0c442');
  });

  it('an empty value: the muted word, no button', () => {
    render(<ResultRow label="Port" value="" empty="empty" />);
    const output = screen.getByRole('status', { name: 'Port' });
    expect(output.textContent).toBe('empty');
    expect(output.hasAttribute('data-empty')).toBe(true);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
