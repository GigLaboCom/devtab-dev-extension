import { definition } from './definition';
import JsonTool from './JsonTool';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { memoryHost } from '@workspace/tools-host';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const output = () => (screen.getByLabelText('Result') as HTMLTextAreaElement).value;

describe('the JSON tool’s definition', () => {
  it('describes the tool and loads its component', async () => {
    expect(definition).toMatchObject({ id: 'json', title: 'JSON', order: 1 });
    expect(definition.detect?.('{"a": 1}')).toBe(true);
    expect(definition.detect?.('hello')).toBe(false);
    expect((await definition.load()).default).toBe(JsonTool);
  });
});

describe('the JSON tool, rendered with no host', () => {
  it('starts from the text it is handed, says where an error is, formats with sorted keys', () => {
    render(<JsonTool input='{"b": 1, "a": [1, 2,]}' />);
    expect(screen.getByText('Line 1, column 21: trailing comma')).toBeTruthy();
    type('Input', '{"b": 1, "a": {"d": 4, "c": 3}}');
    expect(screen.getByText('Valid JSON')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Sort keys'));
    fireEvent.click(screen.getByRole('button', { name: 'Format' }));
    expect(output()).toBe('{\n  "a": {\n    "c": 3,\n    "d": 4\n  },\n  "b": 1\n}');
    fireEvent.click(screen.getByRole('button', { name: 'Minify' }));
    expect(output()).toBe('{"a":{"c":3,"d":4},"b":1}');
  });

  it('an invalid input formats to nothing and says why, as an alert', () => {
    render(<JsonTool />);
    type('Input', '[1, 2');
    fireEvent.click(screen.getByRole('button', { name: 'Format' }));
    expect(output()).toBe('');
    expect(screen.getByRole('alert').textContent).toMatch(/^Line 1, column 6: /);
  });

  it('copies the result with one press', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<JsonTool input="[1,2]" />);
    const copy = screen.getByRole('button', { name: 'Copy' }) as HTMLButtonElement;
    expect(copy.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Format' }));
    fireEvent.click(copy);
    await act(async () => undefined);
    expect(writeText).toHaveBeenCalledWith('[\n  1,\n  2\n]');
    expect(copy.textContent).toBe('Copied');
  });
});

describe('the JSON tool’s history', () => {
  it('commits each Format with its result, and opens it again when the host asks', async () => {
    const host = memoryHost();
    const { unmount } = render(<JsonTool host={host} />);
    type('Input', '{"x": 1}');
    fireEvent.click(screen.getByRole('button', { name: 'Format' }));
    const history = host.history.forOwner('json', definition.history!);
    let entries: Awaited<ReturnType<typeof history.list>>['entries'] = [];
    await waitFor(async () => {
      entries = (await history.list({ kinds: ['result'] })).entries;
      expect(entries).toHaveLength(1);
    });
    expect(entries[0]!.label).toBe('Format · 2 spaces');
    unmount();

    render(<JsonTool host={host} restore={{ id: entries[0]!.id }} />);
    expect(await screen.findByText('Opened from History: Format · 2 spaces.')).toBeTruthy();
    expect((screen.getByLabelText('Input') as HTMLTextAreaElement).value).toBe('{"x": 1}');
    expect(output()).toBe('{\n  "x": 1\n}');
  });
});
