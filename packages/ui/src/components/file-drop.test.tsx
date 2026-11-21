import { FileDrop } from './file-drop';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

const file = (name: string) => new File(['abc'], name, { type: 'text/plain' });
const transfer = (files: File[]) => ({ types: ['Files'], files, dropEffect: 'none' });

describe('FileDrop', () => {
  it('"Drop a file here or" and a Choose file button that opens the file input', () => {
    const onFiles = vi.fn();
    const { container } = render(<FileDrop onFiles={onFiles} />);
    expect(screen.getByText('Drop a file here or')).toBeTruthy();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const click = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByRole('button', { name: 'Choose file' }));
    expect(click).toHaveBeenCalled();
    fireEvent.change(input, { target: { files: [file('a.txt')] } });
    expect(onFiles).toHaveBeenCalledWith([expect.objectContaining({ name: 'a.txt' })]);
  });

  it('marks a file over it and hands over a dropped one (the first, unless multiple)', () => {
    const onFiles = vi.fn();
    const { container } = render(<FileDrop onFiles={onFiles} />);
    const zone = container.firstElementChild as HTMLElement;
    fireEvent.dragEnter(zone, { dataTransfer: transfer([]) });
    expect(zone.dataset.dragging).toBe('true');
    fireEvent.drop(zone, { dataTransfer: transfer([file('a.txt'), file('b.txt')]) });
    expect(zone.dataset.dragging).toBe('false');
    expect(onFiles).toHaveBeenCalledWith([expect.objectContaining({ name: 'a.txt' })]);
  });

  it('ignores a drag of text, and everything while disabled', () => {
    const onFiles = vi.fn();
    const { container, rerender } = render(<FileDrop onFiles={onFiles} />);
    const zone = container.firstElementChild as HTMLElement;
    fireEvent.dragEnter(zone, { dataTransfer: { types: ['text/plain'], files: [] } });
    expect(zone.dataset.dragging).toBe('false');
    rerender(<FileDrop onFiles={onFiles} disabled />);
    fireEvent.drop(zone, { dataTransfer: transfer([file('a.txt')]) });
    expect(onFiles).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Choose file' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
