import { definition } from './definition';
import HtmlToJsxTool from './HtmlToJsxTool';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LIVE_INPUT, MAX_INPUT, loadAttributeNames } from '@workspace/tool-logic-html-to-jsx';
import { memoryHost } from '@workspace/tools-host';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// docs/tools/specs/html-to-jsx.md §2 (scenarios), §6, §8 (the page, its words), §12 (limits) and the tool's history
// (D17, docs/tools/history.md §10, row 33).

beforeAll(async () => {
  await loadAttributeNames(); // the table's module, once: later loads resolve at once
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const field = (label: string) => screen.getByLabelText(label) as HTMLTextAreaElement;
const type = (value: string) => fireEvent.change(field('HTML'), { target: { value } });
const output = () => field('JSX').value;
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const statusLine = () => document.querySelector('[data-part="status"]')!.textContent!.trim();
const notes = () =>
  [...document.querySelectorAll('[data-part="note"]')].map(n => n.textContent!.trim()).filter(Boolean);
/** The table of names loads on first need; let its promise settle. */
const settle = () => act(async () => undefined);
const stubClipboard = () => {
  const writeText = vi.fn((text: string) => Promise.resolve(void text));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  return writeText;
};
/** Convert runs after a frame and a task, so "Working…" paints first. */
const runConvert = async (press: () => void) => {
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => {
    cb(0);
    return 0;
  });
  press();
  await act(async () => {
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
  });
};

describe('the HTML to JSX tool’s definition', () => {
  it('describes the tool, recognises nothing on paste (§7) and loads its component', async () => {
    expect(definition).toMatchObject({
      id: 'html-to-jsx',
      title: 'HTML to JSX',
      summary: 'Convert HTML or SVG markup to JSX for React.',
      order: 33,
      output: { origin: 'input' },
    });
    expect(definition).not.toHaveProperty('shortcut');
    expect(definition).not.toHaveProperty('detect');
    expect(definition.keywords).toEqual([
      'html',
      'jsx',
      'tsx',
      'react',
      'svg',
      'classname',
      'component',
      'convert',
      'markup',
    ]);
    expect(definition.history?.kinds).toEqual([{ id: 'convert', title: 'Converted' }]);
    expect((await definition.load()).default).toBe(HtmlToJsxTool);
  });
});

describe('the HTML to JSX tool, rendered with no host', () => {
  it('starts empty: Wrap off, no Convert, Copy off, no lines (§8)', () => {
    render(<HtmlToJsxTool />);
    expect(screen.getByRole('checkbox', { name: 'Wrap in a component' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Convert' })).toBeNull();
    expect(field('HTML').value).toBe('');
    expect(field('HTML').placeholder).toBe('<div class="card">Hello</div>');
    expect(field('HTML').getAttribute('spellcheck')).toBe('false');
    expect(field('JSX').getAttribute('spellcheck')).toBe('false');
    expect(field('JSX').readOnly).toBe(true);
    expect(button('Copy').disabled).toBe(true);
    expect(statusLine()).toBe('');
    expect(notes()).toEqual([]);
  });

  it('§2.1: class and for, at once; Copy copies the result, then Copied until the next change', async () => {
    const writeText = stubClipboard();
    render(<HtmlToJsxTool />);
    type('<label class="field" for="email">Email</label>');
    await settle();
    expect(output()).toBe('<label className="field" htmlFor="email">Email</label>\n');
    fireEvent.click(button('Copy'));
    await settle();
    expect(writeText).toHaveBeenCalledWith('<label className="field" htmlFor="email">Email</label>\n');
    expect(button('Copied')).toBeTruthy();
    type('<b>x</b>');
    await settle();
    expect(button('Copy')).toBeTruthy();
  });

  it('§2.2: an SVG icon', async () => {
    render(<HtmlToJsxTool />);
    type('<svg viewBox="0 0 24 24"><path stroke-width="2" fill-rule="evenodd" d="M0 0"/></svg>');
    await settle();
    expect(output()).toBe(
      '<svg viewBox="0 0 24 24">\n  <path strokeWidth="2" fillRule="evenodd" d="M0 0" />\n</svg>\n',
    );
  });

  it('§2.3: a checkbox becomes uncontrolled', async () => {
    render(<HtmlToJsxTool />);
    type('<input type="checkbox" checked disabled="disabled" tabindex="0">');
    await settle();
    expect(output()).toBe('<input type="checkbox" defaultChecked disabled tabIndex={0} />\n');
  });

  it('§2.4: an inline handler, with its note', async () => {
    render(<HtmlToJsxTool />);
    type('<a onclick="save(event); return false;">Save</a>');
    await settle();
    expect(output()).toBe('<a onClick={(event) => { save(event); return false }}>Save</a>\n');
    expect(notes()).toEqual(['1 inline event handler became an arrow function with the same code: check it.']);
  });

  it('§2.5: two paragraphs make a fragment; Wrap in a component wraps it, and back', async () => {
    render(<HtmlToJsxTool />);
    type('<p>a</p><p>b</p>');
    await settle();
    expect(output()).toBe('<>\n  <p>a</p>\n  <p>b</p>\n</>\n');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Wrap in a component' }));
    expect(output()).toBe(
      'export default function Component() {\n  return (\n    <>\n      <p>a</p>\n      <p>b</p>\n    </>\n  );\n}\n',
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Wrap in a component' }));
    expect(output()).toBe('<>\n  <p>a</p>\n  <p>b</p>\n</>\n');
  });

  it('§2.6: a whole page: its body, with the note', async () => {
    render(<HtmlToJsxTool />);
    type('<!DOCTYPE html><html><head><title>T</title></head><body><main>Hi</main></body></html>');
    await settle();
    expect(output()).toBe('<main>Hi</main>\n');
    expect(notes()).toEqual(['Converted the contents of <body>; <head> and the doctype were left out.']);
  });

  it('§6: blank input — an empty result and Copy off; notes in their order', async () => {
    render(<HtmlToJsxTool />);
    type('   \n  ');
    await settle();
    expect(output()).toBe('');
    expect(button('Copy').disabled).toBe(true);
    type(
      '<select><option selected>a</option></select><script>x()</script><p style="color:red!important" onfoo="x" onclick="y()">t</p>',
    );
    await settle();
    expect(notes()).toEqual([
      '1 inline event handler became an arrow function with the same code: check it.',
      'Unknown event attributes left out: onfoo.',
      '!important was dropped from inline styles: React style objects cannot carry it.',
      'selected on <option> became defaultValue on its <select>.',
      'A <script> rendered by React on the client does not run.',
    ]);
  });

  it('§12: up to 256 Ki characters live; one more needs Convert (Ctrl+Enter), Working… while it runs', async () => {
    render(<HtmlToJsxTool />);
    const cell = '<b>x</b>';
    const atLimit = cell.repeat(LIVE_INPUT / cell.length);
    expect(atLimit).toHaveLength(LIVE_INPUT);
    type(atLimit);
    await settle();
    expect(output().startsWith('<>\n  <b>x</b>\n')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Convert' })).toBeNull();

    type(`${atLimit} `);
    await settle();
    expect(output()).toBe('');
    expect(statusLine()).toBe('Large input: press Convert (Ctrl+Enter).');
    let rafCalls = 0;
    await runConvert(() => {
      fireEvent.click(button('Convert'));
      rafCalls = (window.requestAnimationFrame as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    });
    expect(rafCalls).toBe(1);
    expect(output().startsWith('<>\n  <b>x</b>\n')).toBe(true);
    expect(button('Convert').disabled).toBe(false);

    // A change makes the result out of date; Ctrl+Enter in the field converts again.
    type(`${atLimit}  `);
    await settle();
    expect(output()).toBe('');
    await runConvert(() => fireEvent.keyDown(field('HTML'), { key: 'Enter', ctrlKey: true }));
    expect(output().startsWith('<>\n')).toBe(true);
  }, 30_000);

  it('§12: Working… and disabled while Convert waits for its frame', async () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
    render(<HtmlToJsxTool />);
    type('x'.repeat(LIVE_INPUT + 1));
    fireEvent.click(button('Convert'));
    expect(button('Working…').disabled).toBe(true);
  });

  it('§12: more than 4 Mi characters is refused at once', async () => {
    render(<HtmlToJsxTool />);
    type('x'.repeat(MAX_INPUT + 1));
    await settle();
    expect(statusLine()).toBe('Input is larger than 4 MB.');
    expect(screen.queryByRole('button', { name: 'Convert' })).toBeNull();
    expect(output()).toBe('');
    expect(button('Copy').disabled).toBe(true);
  });
});

describe('the HTML to JSX tool’s history', () => {
  const entriesOf = async (host: ReturnType<typeof memoryHost>) =>
    (await host.history.forOwner('html-to-jsx', definition.history!).list({})).entries;

  it('records an edit as a snapshot when the page goes away, and nothing for an empty input', async () => {
    const host = memoryHost();
    const { unmount } = render(<HtmlToJsxTool host={host} />);
    type('<b>x</b>');
    await settle();
    unmount();
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(1));
    expect((await entriesOf(host))[0]!.label).toBe('HTML → JSX · 8 characters');

    const again = render(<HtmlToJsxTool host={host} />);
    type('   ');
    await settle();
    again.unmount();
    await settle();
    expect(await entriesOf(host)).toHaveLength(1);
  });

  it('commits Copy at once, in clear, with the input, the option, the notes and the result', async () => {
    stubClipboard();
    const host = memoryHost();
    render(<HtmlToJsxTool host={host} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Wrap in a component' }));
    type('<p onclick="go()">Hi</p>');
    await settle();
    fireEvent.click(button('Copy'));
    await waitFor(async () => expect((await entriesOf(host)).some(e => e.label?.endsWith('copied'))).toBe(true));
    const entry = (await entriesOf(host)).find(e => e.label?.endsWith('copied'))!;
    expect(entry.label).toBe('HTML → JSX · 24 characters · in a component · copied');
    const opened = await host.history.forOwner('html-to-jsx', definition.history!).open(entry.id);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.payload).toEqual({ component: true, notes: [{ kind: 'handlers', count: 1 }], action: 'copy' });
    expect(await opened.blobs.input!.text()).toBe('<p onclick="go()">Hi</p>');
    expect(await opened.blobs.output!.text()).toContain('<p onClick={() => { go() }}>Hi</p>');
  });

  it('commits Convert of a large input', async () => {
    const host = memoryHost();
    render(<HtmlToJsxTool host={host} />);
    type(`<p>${'x'.repeat(LIVE_INPUT)}</p>`);
    await runConvert(() => fireEvent.click(button('Convert')));
    await waitFor(async () => expect((await entriesOf(host)).length).toBe(1));
    expect((await entriesOf(host))[0]!.label).toBe(
      `HTML → JSX · ${(LIVE_INPUT + 7).toLocaleString('en-US')} characters · converted`,
    );
  });

  it('opens an entry back into the tool: the input and the option; opening records nothing', async () => {
    stubClipboard();
    const host = memoryHost();
    const first = render(<HtmlToJsxTool host={host} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Wrap in a component' }));
    type('<i>hi</i>');
    await settle();
    fireEvent.click(button('Copy'));
    await waitFor(async () => expect((await entriesOf(host)).some(e => e.label?.endsWith('copied'))).toBe(true));
    first.unmount();
    await settle();
    const entries = await entriesOf(host);
    const copied = entries.find(e => e.label?.endsWith('copied'))!;

    const second = render(<HtmlToJsxTool host={host} restore={{ id: copied.id }} />);
    expect(
      await screen.findByText('Opened from History: HTML → JSX · 9 characters · in a component · copied.'),
    ).toBeTruthy();
    expect(field('HTML').value).toBe('<i>hi</i>');
    expect(screen.getByRole('checkbox', { name: 'Wrap in a component' }).getAttribute('aria-checked')).toBe('true');
    await settle();
    expect(output()).toBe('export default function Component() {\n  return (\n    <i>hi</i>\n  );\n}\n');
    second.unmount();
    await settle();
    expect(await entriesOf(host)).toHaveLength(entries.length);
  });

  it('opens a large entry with the result it kept, without Convert', async () => {
    const host = memoryHost();
    const first = render(<HtmlToJsxTool host={host} />);
    const big = `<p>${'y'.repeat(LIVE_INPUT)}</p>`;
    type(big);
    await runConvert(() => fireEvent.click(button('Convert')));
    await waitFor(async () => expect((await entriesOf(host)).length).toBe(1));
    first.unmount();
    const [entry] = await entriesOf(host);
    render(<HtmlToJsxTool host={host} restore={{ id: entry!.id }} />);
    await screen.findByText(/^Opened from History/);
    expect(field('HTML').value).toBe(big);
    expect(output().startsWith('<p>\n  yyy')).toBe(true);
  });

  it('records text handed over by the host as the visit’s first edit', async () => {
    const host = memoryHost();
    const { unmount } = render(<HtmlToJsxTool host={host} input="<br>" />);
    await settle();
    expect(output()).toBe('<br />\n');
    unmount();
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(1));
  });
});
