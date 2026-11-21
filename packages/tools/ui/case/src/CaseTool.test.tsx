import CaseTool from './CaseTool';
import { definition } from './definition';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CASE_FORMS, LIVE_INPUT, MAX_INPUT, SETTLE_MS } from '@workspace/tool-logic-case';
import { memoryHost } from '@workspace/tools-host';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let writeText: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;

beforeEach(() => {
  writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const LABELS = CASE_FORMS.map(f => f.label);
const field = (label: string) => screen.getByLabelText(label) as HTMLTextAreaElement;
const type = (value: string) => fireEvent.change(field('Text'), { target: { value } });
const result = (label: string) => field(label).value;
const copy = (label: string) => screen.getByRole('button', { name: `Copy ${label}` }) as HTMLButtonElement;
const hint = () => document.querySelector('[data-part="hint"]')!;
const press = async (label: string) => {
  fireEvent.click(copy(label));
  await screen.findByRole('button', { name: `Copied ${label}` });
};

describe('the Case Converter’s definition', () => {
  it('describes the tool as data, with no detect and no shortcut, and loads its component', async () => {
    expect(definition).toMatchObject({
      id: 'case',
      title: 'Case Converter',
      summary: 'Convert text and identifiers to camelCase, snake_case, kebab-case and other cases.',
      order: 14,
      output: { origin: 'input' },
    });
    expect(definition.keywords).toEqual([
      'case',
      'camelcase',
      'pascalcase',
      'snake_case',
      'kebab-case',
      'constant',
      'title case',
      'sentence case',
      'upper',
      'lower',
      'identifier',
      'rename',
    ]);
    expect(definition.shortcut).toBeUndefined();
    expect('detect' in definition).toBe(false);
    expect(definition.history?.kinds).toEqual([{ id: 'convert', title: 'Converted' }]);
    expect((await definition.load()).default).toBe(CaseTool);
  });
});

describe('the Case Converter, rendered with no host', () => {
  it('starts empty: the text, the hint, 13 named empty fields, every Copy off (§8)', () => {
    render(<CaseTool />);
    const text = field('Text');
    expect(text.value).toBe('');
    expect(text.placeholder).toBe('Paste names or text, one per line');
    expect(text.getAttribute('spellcheck')).toBe('false');
    expect(hint().textContent).toBe(
      'Each line is converted on its own. Words split at spaces, punctuation, _ - . / and at case changes.',
    );
    expect(hint().getAttribute('role')).toBe('status');
    expect(hint().getAttribute('data-tone')).toBe('note');
    const rows = [...document.querySelectorAll('[data-form]')];
    expect(rows.map(r => r.querySelector('label')!.textContent)).toEqual(LABELS);
    for (const label of LABELS) {
      expect(result(label)).toBe('');
      expect(field(label).readOnly).toBe(true);
      expect(field(label).getAttribute('spellcheck')).toBe('false');
      expect(copy(label).disabled).toBe(true);
      expect(copy(label).textContent).toBe('Copy');
    }
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('Tab goes through the text, then each form’s field and its Copy, in the order of §4', () => {
    render(<CaseTool />);
    type('x');
    const focusable = [...document.querySelectorAll<HTMLElement>('textarea, button')].filter(e => e.tabIndex >= 0);
    expect(focusable.map(e => e.getAttribute('aria-label') ?? e.id)).toEqual([
      'case-input',
      ...CASE_FORMS.flatMap(f => [`case-${f.id}`, `Copy ${f.label}`]),
    ]);
  });

  it('§2.1: user_id in the code forms, and Copy at camelCase', async () => {
    render(<CaseTool />);
    type('user_id');
    expect(result('camelCase')).toBe('userId');
    expect(result('PascalCase')).toBe('UserId');
    expect(result('CONSTANT_CASE')).toBe('USER_ID');
    await press('camelCase');
    expect(writeText).toHaveBeenCalledWith('userId');
    expect(screen.getByRole('button', { name: 'Copied camelCase' }).textContent).toBe('Copied');
  });

  it('§2.2: a Java class name', () => {
    render(<CaseTool />);
    type('XMLHttpRequest');
    expect(result('snake_case')).toBe('xml_http_request');
    expect(result('kebab-case')).toBe('xml-http-request');
    expect(result('Title Case')).toBe('XML Http Request');
  });

  it('§2.3: three lines, each converted on its own; Copy takes them all with the line breaks of the result', async () => {
    render(<CaseTool />);
    type('firstName\nlast_name\ndate-of-birth');
    expect(result('snake_case')).toBe('first_name\nlast_name\ndate_of_birth');
    await press('snake_case');
    expect(writeText).toHaveBeenLastCalledWith('first_name\nlast_name\ndate_of_birth');
    type('firstName\nlast_name\n');
    await press('kebab-case');
    expect(writeText).toHaveBeenLastCalledWith('first-name\nlast-name\n');
  });

  it('§2.4: a task title as a branch name', () => {
    render(<CaseTool />);
    type('Fix the login page for iOS users');
    expect(result('kebab-case')).toBe('fix-the-login-page-for-i-os-users');
  });

  it('§2.5: an article title', () => {
    render(<CaseTool />);
    type('a tale of two cities');
    expect(result('Title Case')).toBe('A Tale of Two Cities');
    expect(result('Sentence case')).toBe('A tale of two cities');
  });

  it('§2.6: a digit stays with its word', () => {
    render(<CaseTool />);
    type('parseURL2');
    expect(result('camelCase')).toBe('parseUrl2');
    expect(result('snake_case')).toBe('parse_url2');
  });

  it('§2.7: no word characters — the word forms are empty with Copy off, lower and upper show the input', () => {
    render(<CaseTool />);
    type('---');
    for (const f of CASE_FORMS.slice(0, 11)) {
      expect(result(f.label)).toBe('');
      expect(copy(f.label).disabled).toBe(true);
    }
    expect(result('lower case')).toBe('---');
    expect(result('UPPER CASE')).toBe('---');
    expect(copy('UPPER CASE').disabled).toBe(false);
  });

  it('§6: only spaces — lower and upper keep them', () => {
    render(<CaseTool />);
    type('   ');
    expect(result('snake_case')).toBe('');
    expect(result('lower case')).toBe('   ');
  });

  it('every form at once, all 13 (§4, HTTPServer)', () => {
    render(<CaseTool />);
    type('HTTPServer');
    expect(LABELS.map(result)).toEqual([
      'httpServer',
      'HttpServer',
      'http_server',
      'HTTP_SERVER',
      'http-server',
      'HTTP-SERVER',
      'Http-Server',
      'http.server',
      'http/server',
      'HTTP Server',
      'HTTP server',
      'httpserver',
      'HTTPSERVER',
    ]);
  });

  it('"Copied" stays until the input changes or another Copy is pressed (§8)', async () => {
    render(<CaseTool />);
    type('fooBar');
    await press('camelCase');
    await press('snake_case');
    expect(copy('camelCase').textContent).toBe('Copy');
    expect(screen.getByRole('button', { name: 'Copied snake_case' }).textContent).toBe('Copied');
    type('fooBaz');
    expect(copy('snake_case').textContent).toBe('Copy');
    expect(screen.queryByRole('button', { name: /^Copied/ })).toBeNull();
  });

  it('a refused clipboard says "Not copied" on that button', async () => {
    writeText.mockImplementation(() => Promise.reject(new Error('denied')));
    render(<CaseTool />);
    type('fooBar');
    fireEvent.click(copy('dot.case'));
    await waitFor(() => expect(copy('dot.case').textContent).toBe('Not copied'));
  });

  it('text handed over by the host starts in the field', () => {
    render(<CaseTool input="some_name" />);
    expect(field('Text').value).toBe('some_name');
    expect(result('camelCase')).toBe('someName');
  });
});

describe('the Case Converter’s limits (§6, §12)', () => {
  const line = (n: number) => 'fooBar '.repeat(Math.ceil(n / 7)).slice(0, n);

  it('up to 64 Ki characters every edit recomputes at once', () => {
    render(<CaseTool />);
    type(line(LIVE_INPUT));
    expect(result('snake_case').startsWith('foo_bar_foo_bar')).toBe(true);
  });

  it('exactly 524,288 characters are converted 300 ms after the last edit', () => {
    vi.useFakeTimers();
    render(<CaseTool />);
    type('first');
    type(line(MAX_INPUT));
    expect(result('camelCase')).toBe('first');
    act(() => vi.advanceTimersByTime(SETTLE_MS - 1));
    expect(result('camelCase')).toBe('first');
    act(() => vi.advanceTimersByTime(1));
    // Fields of this size come one per frame, in the order of §4; one not there yet is empty with its Copy off.
    expect(screen.getByRole('group', { name: 'Cases' }).getAttribute('aria-busy')).toBe('true');
    expect(result('UPPER CASE')).toBe('');
    expect(copy('UPPER CASE').disabled).toBe(true);
    for (let i = 0; i < CASE_FORMS.length; i++) act(() => vi.advanceTimersByTime(20));
    expect(result('camelCase').startsWith('fooBarFooBar')).toBe(true);
    expect(result('UPPER CASE').startsWith('FOOBAR FOOBAR')).toBe(true);
    expect(result('UPPER CASE')).toHaveLength(MAX_INPUT);
    expect(copy('UPPER CASE').disabled).toBe(false);
    expect(screen.getByRole('group', { name: 'Cases' }).getAttribute('aria-busy')).toBeNull();
    expect(hint().getAttribute('data-tone')).toBe('note');
  });

  it('above 524,288 characters the forms are empty and the hint says why, politely (role status)', () => {
    render(<CaseTool />);
    type('fooBar');
    type(line(MAX_INPUT + 1));
    for (const label of LABELS) expect(result(label)).toBe('');
    expect(hint().textContent).toBe('Text is larger than 512 KB. Case Converter works with up to 512 KB.');
    expect(hint().getAttribute('data-tone')).toBe('error');
    expect(hint().getAttribute('role')).toBe('status');
    type('fooBar');
    expect(result('snake_case')).toBe('foo_bar');
    expect(hint().getAttribute('data-tone')).toBe('note');
  });
});

describe('the Case Converter’s history', () => {
  const entriesOf = async (host: ReturnType<typeof memoryHost>) =>
    (await host.history.forOwner('case', definition.history!).list()).entries;

  it('records an edit as a snapshot (change) when the page goes away, and nothing for an empty input', async () => {
    const host = memoryHost();
    const { unmount } = render(<CaseTool host={host} />);
    type('firstName\nlast_name');
    unmount();
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(1));
    const [entry] = await entriesOf(host);
    expect(entry!.kind).toBe('convert');
    expect(entry!.label).toBe('firstName · 2 lines');

    render(<CaseTool host={host} />).unmount();
    await act(async () => undefined);
    expect(await entriesOf(host)).toHaveLength(1);
  });

  it('commits a Copy at once, naming the form; the results themselves are not kept', async () => {
    const host = memoryHost();
    render(<CaseTool host={host} />);
    type('user_id');
    await press('camelCase');
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(1));
    const [entry] = await entriesOf(host);
    expect(entry!.label).toBe('user_id · copied camelCase');
    const opened = await host.history.forOwner('case', definition.history!).open(entry!.id);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.payload).toEqual({ lines: 1, copied: 'camel' });
    expect(Object.keys(opened.blobs)).toEqual(['input']);
    expect(await opened.blobs.input!.text()).toBe('user_id');
  });

  it('opens an entry back into the tool: the text and every form; opening records nothing', async () => {
    const host = memoryHost();
    const first = render(<CaseTool host={host} />);
    type('XMLHttpRequest\nparseURL2');
    await press('PascalCase');
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(1));
    first.unmount();
    await act(async () => undefined);
    const entries = await entriesOf(host);

    const second = render(<CaseTool host={host} restore={{ id: entries[0]!.id }} />);
    expect(await screen.findByText('Opened from History: XMLHttpRequest · 2 lines · copied PascalCase.')).toBeTruthy();
    expect(field('Text').value).toBe('XMLHttpRequest\nparseURL2');
    expect(result('PascalCase')).toBe('XmlHttpRequest\nParseUrl2');
    second.unmount();
    await act(async () => undefined);
    expect(await entriesOf(host)).toHaveLength(entries.length);
  });

  it('records text handed over by the host as the visit’s first edit', async () => {
    const host = memoryHost();
    render(<CaseTool host={host} input="some_name" />).unmount();
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(1));
    expect((await entriesOf(host))[0]!.label).toBe('some_name');
  });

  it('does not record a text it refuses', async () => {
    const host = memoryHost();
    const { unmount } = render(<CaseTool host={host} />);
    type('x'.repeat(MAX_INPUT + 1));
    unmount();
    await act(async () => undefined);
    expect(await entriesOf(host)).toHaveLength(0);
  });
});
