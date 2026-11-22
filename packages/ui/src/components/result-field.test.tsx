import { MAX_SHOWN_CHARS, MAX_SHOWN_LINES, ResultField, shownPart, shownWords } from './result-field';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

const field = () => screen.getByRole('textbox') as HTMLTextAreaElement;
const line = () => document.querySelector('[data-part=result-limit]')?.textContent;

describe('shownPart', () => {
  it('whole up to both bounds', () => {
    expect(shownPart('abc', 3, 1)).toEqual({ text: 'abc', cut: null });
    expect(shownPart('a\nb', 3, 2)).toEqual({ text: 'a\nb', cut: null });
    expect(shownPart('', 3, 1)).toEqual({ text: '', cut: null });
  });

  it('by characters: the first ones, never half a surrogate pair', () => {
    expect(shownPart('abcd', 3, 5)).toEqual({ text: 'abc', cut: { by: 'characters', shown: 3, total: 4 } });
    expect(shownPart('ab😀d', 3, 5)).toEqual({ text: 'ab', cut: { by: 'characters', shown: 2, total: 5 } });
  });

  it('by lines: whole lines without the break after the last, all lines counted', () => {
    expect(shownPart('a\nb\nc\nd', 100, 2)).toEqual({ text: 'a\nb', cut: { by: 'lines', shown: 2, total: 4 } });
    // A text ending in a line break has an empty last line, as the json tool counts them.
    expect(shownPart('a\nb\n', 100, 2)).toEqual({ text: 'a\nb', cut: { by: 'lines', shown: 2, total: 3 } });
  });

  it('when the first lines are longer than the characters allow, the characters cut', () => {
    expect(shownPart('aaaa\nb\nc', 3, 2)).toEqual({ text: 'aaa', cut: { by: 'characters', shown: 3, total: 8 } });
    // The second line break is past the bound in characters.
    expect(shownPart('a\nbbbbb\nc', 4, 2)).toEqual({ text: 'a\nbb', cut: { by: 'characters', shown: 4, total: 9 } });
  });

  it('the words', () => {
    expect(shownWords({ by: 'characters', shown: 1_048_576, total: 5_242_880 })).toBe(
      'Showing the first 1,048,576 of 5,242,880 characters.',
    );
    expect(shownWords({ by: 'lines', shown: 10_000, total: 2_621_441 })).toBe(
      'Showing the first 10,000 of 2,621,441 lines.',
    );
  });
});

describe('ResultField', () => {
  it('below the bounds: the kit Textarea with the whole value and nothing else', () => {
    const value = `${'x'.repeat(20)}\n`.repeat(MAX_SHOWN_LINES - 1);
    const { container } = render(<ResultField id="r" className="h-90" spellCheck={false} wrap="off" value={value} />);
    expect(container.childElementCount).toBe(1);
    const shown = field();
    expect(shown.tagName).toBe('TEXTAREA');
    expect(shown.value).toBe(value);
    expect(shown.readOnly).toBe(true);
    expect(shown.id).toBe('r');
    expect(shown.getAttribute('wrap')).toBe('off');
    expect(shown.getAttribute('spellcheck')).toBe('false');
    expect(shown.getAttribute('data-slot')).toBe('textarea');
    expect(shown.className).toContain('h-90');
    expect(line()).toBeUndefined();
  });

  it('above the characters: the first 256 Ki and the line; Copy takes all', () => {
    const value = 'y'.repeat(MAX_SHOWN_CHARS + 5);
    render(<ResultField value={value} />);
    expect(field().value).toHaveLength(MAX_SHOWN_CHARS);
    expect(line()).toBe('Showing the first 262,144 of 262,149 characters. Copy copies all.');
  });

  it('above the lines: the first 10,000 lines; a tool with Save says so', () => {
    const value = Array.from({ length: MAX_SHOWN_LINES + 1 }, (_, i) => String(i)).join('\n');
    render(<ResultField value={value} saves />);
    expect(field().value.split('\n')).toHaveLength(MAX_SHOWN_LINES);
    expect(field().value.endsWith('9999')).toBe(true);
    expect(line()).toBe('Showing the first 10,000 of 10,001 lines. Copy and Save take all.');
  });

  it('a screen reader gets the line once: new numbers change the visible line only; then the region empties', async () => {
    vi.useFakeTimers();
    const { rerender } = render(<ResultField value={'z'.repeat(MAX_SHOWN_CHARS + 1)} />);
    await act(async () => undefined);
    const region = screen.getByRole('status');
    expect(region.textContent).toBe('Showing the first 262,144 of 262,145 characters. Copy copies all.');
    rerender(<ResultField value={'z'.repeat(MAX_SHOWN_CHARS + 2)} />);
    await act(async () => undefined);
    expect(screen.getByRole('status').textContent).toBe(region.textContent);
    expect(line()).toContain('of 262,146 characters');
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByRole('status').textContent).toBe('');
    vi.useRealTimers();
    rerender(<ResultField value="small" />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(field().value).toBe('small');
  });

  it('copying all that is shown copies the whole value; a part copies as the browser does', () => {
    const value = 'q'.repeat(MAX_SHOWN_CHARS + 3);
    render(<ResultField value={value} />);
    const setData = vi.fn();
    field().setSelectionRange(0, MAX_SHOWN_CHARS);
    fireEvent.copy(field(), { clipboardData: { setData } });
    expect(setData).toHaveBeenCalledWith('text/plain', value);
    setData.mockClear();
    field().setSelectionRange(0, 10);
    fireEvent.copy(field(), { clipboardData: { setData } });
    expect(setData).not.toHaveBeenCalled();
  });

  it('the same element across the bound', () => {
    const { rerender } = render(<ResultField value="a" />);
    const before = field();
    rerender(<ResultField value={'a'.repeat(MAX_SHOWN_CHARS + 1)} />);
    expect(field()).toBe(before);
  });
});
