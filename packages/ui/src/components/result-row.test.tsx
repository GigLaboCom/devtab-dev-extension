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

  it('is not a live region: a value derived from what is typed is not read again on every keystroke', () => {
    render(<ResultRow label="SHA-256" value="e3b0c442" />);
    expect(screen.getByRole('status', { name: 'SHA-256' }).getAttribute('aria-live')).toBe('off');
  });

  it('the extra slot in its second-line form: a line of its own under the value', () => {
    const { container } = render(<ResultRow label="Port" value="443" extra="The scheme’s default port." extraBelow />);
    const below = container.querySelector('.kit-result-row-extra');
    expect(below?.textContent).toBe('The scheme’s default port.');
    expect(container.querySelector('.kit-result-row')?.lastElementChild).toBe(below);
    expect(screen.getByRole('status', { name: 'Port' }).parentElement?.textContent).toBe('443');
  });
});
