import { HELD_WORDS, InputField, isHeld, MAX_FIELD_CHARS, MAX_FIELD_LINES } from './input-field';
import { MAX_SHOWN_CHARS, MAX_SHOWN_LINES } from './result-field';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

const field = () => screen.getByRole('textbox') as HTMLTextAreaElement;

/** The tool's side: it owns the text. */
const Tool = ({ initial = '', onValue }: { initial?: string; onValue?: (next: string) => void }) => {
  const [value, setValue] = useState(initial);
  return (
    <InputField
      id="in"
      className="h-90"
      spellCheck={false}
      placeholder="One item per line"
      value={value}
      onValueChange={next => {
        onValue?.(next);
        setValue(next);
      }}
    />
  );
};

const paste = (text: string) => {
  const event = { clipboardData: { getData: () => text } };
  return fireEvent.paste(field(), event);
};

describe('isHeld', () => {
  it('above either bound, reading no further than it has to', () => {
    expect(isHeld('abc', 3, 1)).toBe(false);
    expect(isHeld('abcd', 3, 5)).toBe(true);
    expect(isHeld('a\nb', 10, 2)).toBe(false);
    expect(isHeld('a\nb\nc', 10, 2)).toBe(true);
    expect(isHeld('x'.repeat(MAX_FIELD_CHARS))).toBe(false);
    expect(isHeld('\n'.repeat(MAX_FIELD_LINES - 1))).toBe(false);
    expect(isHeld('\n'.repeat(MAX_FIELD_LINES))).toBe(true);
  });
});

describe('InputField', () => {
  it('below the bounds: the kit Textarea, editable, nothing else', () => {
    const onValue = vi.fn();
    const { container } = render(<Tool initial="abc" onValue={onValue} />);
    expect(container.childElementCount).toBe(1);
    expect(field().value).toBe('abc');
    expect(field().readOnly).toBe(false);
    expect(field().getAttribute('placeholder')).toBe('One item per line');
    fireEvent.change(field(), { target: { value: 'abcd' } });
    expect(onValue).toHaveBeenLastCalledWith('abcd');
    expect(field().value).toBe('abcd');
  });

  it('a paste that stays below the bounds is left to the browser', () => {
    const onValue = vi.fn();
    render(<Tool initial="abc" onValue={onValue} />);
    expect(paste('xyz')).toBe(true);
    expect(onValue).not.toHaveBeenCalled();
  });

  it('a paste past a bound never reaches the field: put in at the selection, held, the line says so', async () => {
    const onValue = vi.fn();
    render(<Tool initial="head-tail" onValue={onValue} />);
    field().setSelectionRange(5, 5);
    const big = 'b'.repeat(MAX_FIELD_CHARS);
    expect(paste(big)).toBe(false);
    expect(onValue).toHaveBeenCalledWith(`head-${big}tail`);
    expect(field().readOnly).toBe(true);
    expect(field().value).toHaveLength(MAX_SHOWN_CHARS);
    expect(field().value.startsWith('head-bbb')).toBe(true);
    await act(async () => undefined);
    expect(screen.getByRole('status').textContent).toBe(
      `Showing the first 262,144 of 1,048,585 characters. ${HELD_WORDS}`,
    );
  });

  it('many lines are held by their count: the first 10,000 shown', () => {
    render(<Tool initial={Array.from({ length: MAX_FIELD_LINES + 1 }, (_, i) => `line ${i}`).join('\n')} />);
    expect(field().readOnly).toBe(true);
    expect(field().value.split('\n')).toHaveLength(MAX_SHOWN_LINES);
    expect(document.querySelector('[data-part=input-limit]')?.textContent).toBe(
      'Showing the first 10,000 of 50,001 lines. Too large to edit here: paste to replace it, or clear the input.',
    );
  });

  it('held: a paste replaces the whole input; "clear the input" empties it, keeps the same field and focuses it', () => {
    const onValue = vi.fn();
    render(<Tool initial={'h'.repeat(MAX_FIELD_CHARS + 1)} onValue={onValue} />);
    const before = field();
    expect(paste('small')).toBe(false);
    expect(onValue).toHaveBeenLastCalledWith('small');
    expect(field()).toBe(before);
    expect(field().readOnly).toBe(false);
    expect(field().value).toBe('small');

    fireEvent.change(field(), { target: { value: 'g'.repeat(MAX_FIELD_CHARS + 1) } });
    expect(field().readOnly).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'clear the input' }));
    expect(onValue).toHaveBeenLastCalledWith('');
    expect(field()).toBe(before);
    expect(field().value).toBe('');
    expect(field().readOnly).toBe(false);
    expect(document.activeElement).toBe(before);
    expect(screen.queryByText(/Too large to edit here/)).toBeNull();
  });

  it("forwards the tool's ref and its own paste handler first", () => {
    const ref = createRef<HTMLTextAreaElement>();
    const onPaste = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    const onValueChange = vi.fn();
    render(<InputField ref={ref} value="" onValueChange={onValueChange} onPaste={onPaste} />);
    expect(ref.current).toBe(field());
    paste('x'.repeat(MAX_FIELD_CHARS + 1));
    expect(onPaste).toHaveBeenCalled();
    expect(onValueChange).not.toHaveBeenCalled();
  });
});
