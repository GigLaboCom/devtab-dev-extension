import { definition } from './definition';
import { detect } from './detect';
import { urlHistory } from './history';
import { carriesCredentials } from './record';
import { urlSettings } from './settings';
import UrlTool from './UrlTool';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { memoryHost } from '@workspace/tools-host';
import { MAX_SHOWN_CHARS } from '@workspace/ui/result-field';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolHost } from '@workspace/tools-host';

afterEach(cleanup);

let writeText: ReturnType<typeof vi.fn>;
beforeEach(() => {
  writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});

const field = (label: string) => screen.getByLabelText(label) as HTMLTextAreaElement;
const type = (label: string, value: string) => fireEvent.change(field(label), { target: { value } });
const output = () => field('Result').value;
const mode = (name: 'Encode' | 'Decode' | 'Parse') => fireEvent.click(screen.getByRole('radio', { name }));
const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
const press = async (name: string | RegExp) => {
  fireEvent.click(button(name));
  await act(async () => undefined);
};
const pickStyle = (name: string) => {
  fireEvent.keyDown(screen.getByLabelText('Encode as'), { key: 'Enter' });
  fireEvent.click(screen.getByRole('option', { name }));
};
const statuses = () =>
  screen
    .getAllByRole('status')
    .map(s => s.textContent?.trim())
    .filter(Boolean);
const partValue = (label: string) => screen.getByRole('status', { name: label }).textContent;

describe('the URL tool’s definition', () => {
  it('describes the tool and loads its component', async () => {
    expect(definition).toMatchObject({ id: 'url', title: 'URL', order: 3 });
    expect(definition.summary).toBe('Percent-encode and decode text, split a URL into parts and list its query.');
    expect(definition.keywords).toContain('encodeURIComponent');
    expect(detect('https://example.com/path?q=1')).toBe(true);
    expect(detect('hello%20world')).toBe(true);
    expect(detect('mailto:dev@example.com')).toBe(false);
    expect((await definition.load()).default).toBe(UrlTool);
  });
});

describe('the URL tool, rendered with no host', () => {
  it('starts empty in Encode, Component: nothing to copy or swap, no messages', () => {
    render(<UrlTool />);
    expect(screen.getByRole('radio', { name: 'Encode' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByLabelText('Encode as').textContent).toBe('Component');
    expect(field('Input').placeholder).toBe('Text to encode');
    expect(field('Input').getAttribute('spellcheck')).toBe('false');
    expect(field('Result').getAttribute('spellcheck')).toBe('false');
    expect(field('Result').readOnly).toBe(true);
    expect(button('Copy').disabled).toBe(true);
    expect(button('Swap').disabled).toBe(true);
    expect(statuses()).toEqual([]);
  });

  it('§2.2: a return address encoded as a Component, copied', async () => {
    render(<UrlTool />);
    type('Input', 'https://example.com/a?b=1');
    expect(output()).toBe('https%3A%2F%2Fexample.com%2Fa%3Fb%3D1');
    await press('Copy');
    expect(writeText).toHaveBeenCalledWith('https%3A%2F%2Fexample.com%2Fa%3Fb%3D1');
    expect(button('Copied')).toBeTruthy();
    type('Input', 'x y');
    expect(button('Copy')).toBeTruthy();
  });

  it('§2.4: a typed address encoded as a Whole URL keeps its colon and slashes; Form gives + for spaces', () => {
    render(<UrlTool />);
    type('Input', 'https://example.com/мой файл.pdf');
    pickStyle('Whole URL');
    expect(output()).toBe('https://example.com/%D0%BC%D0%BE%D0%B9%20%D1%84%D0%B0%D0%B9%D0%BB.pdf');
    pickStyle('Form (+ for spaces)');
    type('Input', '   ');
    expect(output()).toBe('+++');
  });

  it('§2.3: a form body decoded with + as a space', () => {
    render(<UrlTool />);
    mode('Decode');
    expect(field('Input').placeholder).toBe('Text with %XX to decode');
    type('Input', 'name=John+Smith%21');
    expect(output()).toBe('name=John+Smith!');
    fireEvent.click(screen.getByLabelText('Decode + as space'));
    expect(output()).toBe('name=John Smith!');
  });

  it('§2.7 and §6: invalid UTF-8 and malformed escapes are notes under the result, one per line', () => {
    render(<UrlTool />);
    mode('Decode');
    type('Input', '%E9t%E9');
    expect(output()).toBe('�t�');
    expect(statuses()).toEqual(['Invalid UTF-8 replaced with U+FFFD.']);
    type('Input', '100%');
    expect(output()).toBe('100%');
    expect(statuses()).toEqual(['1 malformed % sequence left as is.']);
    type('Input', '%zz%4%E9');
    expect(statuses()).toEqual(['2 malformed % sequences left as is.', 'Invalid UTF-8 replaced with U+FFFD.']);
    type('Input', 'a%00b');
    expect(output()).toBe('a\u0000b');
    expect(statuses()).toEqual([]);
  });

  it('keeps the text when the mode changes; Swap moves the result into the input and leaves the options alone', () => {
    render(<UrlTool />);
    pickStyle('Form (+ for spaces)');
    type('Input', 'a b+c');
    expect(output()).toBe('a+b%2Bc');
    fireEvent.click(button('Swap'));
    expect(screen.getByRole('radio', { name: 'Decode' }).getAttribute('aria-checked')).toBe('true');
    expect(field('Input').value).toBe('a+b%2Bc');
    // §4: + as space is not switched on by itself after encoding in Form.
    expect((screen.getByLabelText('Decode + as space') as HTMLButtonElement).getAttribute('aria-checked')).toBe(
      'false',
    );
    expect(output()).toBe('a+b+c');
    fireEvent.click(button('Swap'));
    expect(field('Input').value).toBe('a+b+c');
    expect(screen.getByLabelText('Encode as').textContent).toBe('Form (+ for spaces)');
    mode('Parse');
    expect(field('URL').value).toBe('a+b+c');
    expect(screen.queryByRole('button', { name: 'Swap' })).toBeNull();
  });

  it('§2.1: Parse shows the host, the path and four parameters, and copies their JSON', async () => {
    render(<UrlTool />);
    mode('Parse');
    expect(field('URL').placeholder).toBe('https://example.com/path?query=value#fragment');
    expect(field('URL').rows).toBe(4);
    type('URL', 'https://api.example.com/search?q=%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82&page=2&tag=a&tag=b');
    expect(partValue('Normalized URL')).toBe(
      'https://api.example.com/search?q=%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82&page=2&tag=a&tag=b',
    );
    expect(partValue('Host')).toBe('api.example.com');
    expect(partValue('Path')).toBe('/search');
    expect(screen.getByText('Query parameters (4)')).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Query parameters' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map(h => h.textContent),
    ).toEqual(['#', 'Name', 'Value']);
    const rows = within(table)
      .getAllByRole('row')
      .slice(1)
      .map(r =>
        within(r)
          .getAllByRole('cell')
          .map(c => c.textContent),
      );
    expect(rows).toEqual([
      ['1', 'q', 'Привет'],
      ['2', 'page', '2'],
      ['3', 'tag', 'a'],
      ['4', 'tag', 'b'],
    ]);
    await press('Copy JSON');
    expect(writeText).toHaveBeenLastCalledWith(
      '{\n  "q": "Привет",\n  "page": "2",\n  "tag": [\n    "a",\n    "b"\n  ]\n}',
    );
    await press('Copy value of q');
    expect(writeText).toHaveBeenLastCalledWith('Привет');
  });

  it('§2.5: a connection string — user, password, host, port, path, a parameter; nine parts in order', async () => {
    render(<UrlTool />);
    mode('Parse');
    type('URL', 'postgres://admin:secret@db.internal:5432/app?sslmode=require');
    const labels = screen.getByLabelText('Parts').querySelectorAll('.kit-result-row-label');
    expect([...labels].map(l => l.textContent)).toEqual([
      'Scheme',
      'Username',
      'Password',
      'Host',
      'Port',
      'Origin',
      'Path',
      'Query',
      'Fragment',
    ]);
    expect(['Username', 'Password', 'Host', 'Port', 'Path', 'Origin'].map(partValue)).toEqual([
      'admin',
      'secret',
      'db.internal',
      '5432',
      '/app',
      'null',
    ]);
    // An empty part: the muted word, no copy button.
    expect(partValue('Fragment')).toBe('empty');
    expect(screen.queryByRole('button', { name: 'Copy Fragment' })).toBeNull();
    // The icon button copies the value and says so for 1.5 s.
    vi.useFakeTimers();
    try {
      fireEvent.click(button('Copy Host'));
      await act(async () => undefined);
      expect(writeText).toHaveBeenLastCalledWith('db.internal');
      expect(button('Copied')).toBeTruthy();
      act(() => vi.advanceTimersByTime(1500));
      expect(button('Copy Host')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a default port is marked, copied without the mark; a decoded value is a second line', async () => {
    render(<UrlTool />);
    mode('Parse');
    type('URL', 'HTTPS://user:p%40ss@EXAMPLE.COM:443/c%20d?=v&k=');
    expect(partValue('Port')).toBe('443');
    expect(screen.getByText('default')).toBeTruthy();
    await press('Copy Port');
    expect(writeText).toHaveBeenLastCalledWith('443');
    expect(screen.getByText('p@ss').parentElement?.textContent).toBe('Decoded: p@ss');
    expect(screen.getByText('/c d').parentElement?.textContent).toBe('Decoded: /c d');
    const table = screen.getByRole('table', { name: 'Query parameters' });
    const cells = within(table)
      .getAllByRole('cell')
      .map(c => c.textContent);
    expect(cells).toEqual(['1', 'empty', 'v', '2', 'k', 'empty']);
    expect(button('Copy value of empty')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Copy value of k' })).toBeNull();
    await press('Copy');
    expect(writeText).toHaveBeenLastCalledWith('https://user:p%40ss@example.com/c%20d?=v&k=');
  });

  it('§2.6 and §6: errors under the field; blank input shows nothing; no parameters says so', () => {
    render(<UrlTool />);
    mode('Parse');
    type('URL', 'example.com/path');
    expect(screen.getByText('Not an absolute URL: add a scheme such as https://')).toBeTruthy();
    expect(screen.queryByLabelText('Parts')).toBeNull();
    type('URL', 'https://example.com:99999/');
    expect(screen.getByText('Not a valid URL.')).toBeTruthy();
    type('URL', ' \n ');
    expect(statuses()).toEqual([]);
    expect(screen.queryByLabelText('Parts')).toBeNull();
    type('URL', 'https://example.com');
    expect(screen.getByText('Query parameters (0)')).toBeTruthy();
    expect(screen.getByText('No query parameters.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy JSON' })).toBeNull();
  });

  it('§6: a URL in several lines is parsed whole, with a note; javascript: is text, never a link', () => {
    const { container } = render(<UrlTool />);
    mode('Parse');
    type('URL', 'https://example.com/a\n/b?x=\t1');
    expect(partValue('Normalized URL')).toBe('https://example.com/a/b?x=1');
    expect(screen.getByText('Tabs and line breaks inside the URL were removed.')).toBeTruthy();
    type('URL', 'javascript:alert(1)');
    expect(partValue('Scheme')).toBe('javascript:');
    expect(partValue('Path')).toBe('alert(1)');
    expect(container.querySelector('a, [href], iframe, img')).toBeNull();
  });

  // A thousand table rows in jsdom take about 3 s alone and more beside the workspace's other test tasks: the default
  // 5 s limit of a test is not a budget of the tool (its speed in the browser is measured in e2e).
  it('§6: more than 1,000 parameters — 1,000 rows, a note, and Copy JSON copies all', async () => {
    render(<UrlTool />);
    mode('Parse');
    type('URL', `https://example.com/?${Array.from({ length: 1001 }, (_, i) => `p${i}=${i}`).join('&')}`);
    expect(screen.getByText('Query parameters (1,001)')).toBeTruthy();
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(1001);
    expect(screen.getByText('Showing the first 1,000 of 1,001 parameters. Copy JSON copies all.')).toBeTruthy();
    await press('Copy JSON');
    expect(Object.keys(JSON.parse(writeText.mock.lastCall![0] as string) as object)).toHaveLength(1001);
  }, 30_000);

  it('§6, §12: size limits — Encode refuses above 5 Mi characters, Parse above 1 Mi; the limits themselves work', () => {
    const { container } = render(<UrlTool />);
    mode('Decode');
    type('Input', 'a'.repeat(5 * 1024 * 1024 + 1));
    expect(screen.getByText('Input is larger than 5 MB. This tool works with up to 5 MB.')).toBeTruthy();
    expect(output()).toBe('');
    mode('Parse');
    type('URL', `https://example.com/?q=${'a'.repeat(1024 * 1024)}`);
    expect(screen.getByText('URL is longer than 1 MB. Parse works with up to 1 MB.')).toBeTruthy();
    const exact = `https://example.com/?q=${'a'.repeat(1024 * 1024 - 23)}`;
    expect(exact.length).toBe(1024 * 1024);
    type('URL', exact);
    // One read of the page's text: a query over every element of a page holding 1 MB values three times is slow.
    const page = container.textContent ?? '';
    expect(page.includes('Query parameters (1)')).toBe(true);
    expect(page.includes('URL is longer than 1 MB.')).toBe(false);
  });

  it('§12: above 256 Ki characters Encode waits 300 ms after the last change', () => {
    vi.useFakeTimers();
    try {
      render(<UrlTool />);
      type('Input', 'x');
      type('Input', ' '.repeat(256 * 1024 + 1));
      expect(output()).toBe('x');
      act(() => vi.advanceTimersByTime(299));
      expect(output()).toBe('x');
      act(() => vi.advanceTimersByTime(1));
      // 768 Ki characters: the field shows the first 256 Ki (docs/tools/limits.md), the result is all there.
      expect(output()).toBe('%20'.repeat(256 * 1024 + 1).slice(0, MAX_SHOWN_CHARS));
      expect(field('Result').dataset.totalLength).toBe(String(3 * (256 * 1024 + 1)));
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens handed text in the mode that recognised it: a URL in Parse, %XX in Decode', () => {
    const { unmount } = render(<UrlTool input="https://example.com/?a=1" />);
    expect(screen.getByRole('radio', { name: 'Parse' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Query parameters (1)')).toBeTruthy();
    unmount();
    render(<UrlTool input="hello%20world" />);
    expect(screen.getByRole('radio', { name: 'Decode' }).getAttribute('aria-checked')).toBe('true');
    expect(output()).toBe('hello world');
  });
});

describe('the URL tool’s history', () => {
  const entries = async (host: ToolHost, kinds?: string[]) =>
    (await host.history.forOwner('url', urlHistory).list(kinds ? { kinds } : {})).entries;

  it('declares open kinds per mode and a secret one for credentials', () => {
    expect(urlHistory.kinds).toEqual([
      { id: 'encode', title: 'Encoded' },
      { id: 'decode', title: 'Decoded' },
      { id: 'parse', title: 'Parsed' },
      { id: 'credentials', title: 'With credentials', secret: true },
    ]);
    expect(carriesCredentials('https://user:token@example.com/')).toBe(true);
    expect(carriesCredentials('https://token@example.com/')).toBe(true);
    expect(carriesCredentials('x', 'postgres://admin:secret@db/app')).toBe(true);
    expect(carriesCredentials('https://example.com/@user', 'mailto:dev@example.com', 'a@b')).toBe(false);
    // Linear on a long input: a URL of 1 Mi letters is read at once.
    const started = Date.now();
    expect(carriesCredentials(`https://example.com/?q=${'a'.repeat(1024 * 1024)}`)).toBe(false);
    expect(carriesCredentials(`${'a'.repeat(1024 * 1024)}://u@h`)).toBe(true);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('commits on Swap and on copying the result, and opens an entry again when the host asks', async () => {
    const host = memoryHost();
    const { unmount } = render(<UrlTool host={host} />);
    pickStyle('Whole URL');
    type('Input', 'a b');
    fireEvent.click(button('Swap'));
    let list: Awaited<ReturnType<typeof entries>> = [];
    await waitFor(async () => {
      list = await entries(host, ['encode']);
      expect(list).toHaveLength(1);
    });
    expect(list[0]!.label).toBe('Encode · Whole URL · 3 characters');
    await press('Copy');
    await waitFor(async () => expect(await entries(host, ['decode'])).toHaveLength(1));
    expect((await entries(host, ['decode']))[0]!.label).toBe('Decode · 5 characters');
    unmount();

    render(<UrlTool host={host} restore={{ id: list[0]!.id }} />);
    expect(await screen.findByText('Opened from History: Encode · Whole URL · 3 characters.')).toBeTruthy();
    expect(field('Input').value).toBe('a b');
    expect(screen.getByLabelText('Encode as').textContent).toBe('Whole URL');
    expect(output()).toBe('a%20b');
  });

  it('a person’s edit is a change snapshot (written when the page is left); opening an entry is not', async () => {
    const host = memoryHost();
    const { unmount } = render(<UrlTool host={host} />);
    mode('Parse');
    type('URL', 'https://example.com/?a=1');
    unmount();
    await waitFor(async () => expect(await entries(host)).toHaveLength(1));
    const [entry] = await entries(host, ['parse']);
    expect(entry!.label).toBe('Parse · example.com');
    const opened = await host.history.forOwner('url', urlHistory).open(entry!.id);
    expect(opened.ok && opened.payload).toEqual({ mode: 'parse', style: 'component', plusAsSpace: false });
    expect(opened.ok && (await opened.blobs.output!.text())).toBe('https://example.com/?a=1');

    const view = render(<UrlTool host={host} restore={{ id: entry!.id }} />);
    expect(await screen.findByText('Opened from History: Parse · example.com.')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Parse' }).getAttribute('aria-checked')).toBe('true');
    view.unmount();
    expect(await entries(host)).toHaveLength(1);
  });

  it('a URL with credentials goes to the secret kind: without a master password it is not kept', async () => {
    const host = memoryHost();
    const { unmount } = render(<UrlTool host={host} />);
    mode('Parse');
    type('URL', 'postgres://admin:secret@db.internal:5432/app');
    await press('Copy');
    mode('Decode');
    type('Input', 'https%3A%2F%2Fadmin%3Asecret%40db.example%2F');
    await press('Copy');
    unmount();
    await act(async () => undefined);
    expect(await entries(host)).toEqual([]);
  });
});

describe('the URL tool’s saved parameters (D21, docs/tools/settings.md)', () => {
  const entries = async (host: ToolHost) => (await host.history.forOwner('url', urlHistory).list({})).entries;
  const savedOf = (host: ToolHost) => host.settings!.forTool('url').saved();
  const seed = async (host: ToolHost, values: Record<string, unknown>) => {
    host.settings!.forTool('url').save(urlSettings.schema, values as never);
    await host.settings!.forTool('url').flush();
  };
  const checked = (name: string) => screen.getByRole('radio', { name }).getAttribute('aria-checked') === 'true';
  const current = () => (['Encode', 'Decode', 'Parse'] as const).find(checked);
  const plus = () => screen.getByLabelText('Decode + as space').getAttribute('aria-checked');

  it('saves the mode and options the person chose; reopened, it is as left; Swap is saved too', async () => {
    const host = memoryHost();
    const first = render(<UrlTool host={host} />);
    pickStyle('Whole URL');
    mode('Decode');
    fireEvent.click(screen.getByLabelText('Decode + as space'));
    first.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: { mode: 'decode', style: 'whole', plusAsSpace: true } });
    const second = render(<UrlTool host={host} />);
    expect(current()).toBe('Decode');
    expect(plus()).toBe('true');
    type('Input', 'a+b');
    expect(output()).toBe('a b');
    fireEvent.click(button('Swap'));
    expect(current()).toBe('Encode');
    expect(screen.getByLabelText('Encode as').textContent).toBe('Whole URL');
    second.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: { style: 'whole', plusAsSpace: true } });
  });

  it('a saved record it cannot show falls back field by field', async () => {
    const host = memoryHost();
    await seed(host, { mode: 'sideways', style: 'form', plusAsSpace: 'yes' });
    render(<UrlTool host={host} />);
    expect(current()).toBe('Encode');
    expect(screen.getByLabelText('Encode as').textContent).toBe('Form (+ for spaces)');
    mode('Decode');
    expect(plus()).toBe('false');
  });

  it('a paste opens its mode and an opened entry shows its own — for the visit; what is saved stays', async () => {
    const host = memoryHost();
    await seed(host, { mode: 'decode', style: 'form', plusAsSpace: true });
    const pasted = render(<UrlTool host={host} input="https://example.com/?a=1" />);
    expect(current()).toBe('Parse');
    pasted.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: { mode: 'decode', style: 'form', plusAsSpace: true } });

    const recorder = host.history.forOwner('url', urlHistory).session();
    await recorder.commit({
      kind: 'encode',
      label: 'Encode · 3 characters',
      payload: { mode: 'encode', style: 'component', plusAsSpace: false },
      blobs: { input: new Blob(['a b']), output: new Blob(['a%20b']) },
    });
    const [entry] = await entries(host);
    const opened = render(<UrlTool host={host} restore={{ id: entry!.id }} />);
    expect(await screen.findByText('Opened from History: Encode · 3 characters.')).toBeTruthy();
    expect(current()).toBe('Encode');
    expect(screen.getByLabelText('Encode as').textContent).toBe('Component');
    expect(output()).toBe('a%20b');
    opened.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: { mode: 'decode', style: 'form', plusAsSpace: true } });
    render(<UrlTool host={host} />);
    expect(current()).toBe('Decode');
    expect(plus()).toBe('true');
  });

  it('reset puts the mode and options back to the defaults and keeps the input; the result follows', async () => {
    const host = memoryHost();
    await seed(host, { mode: 'decode', plusAsSpace: true });
    render(<UrlTool host={host} />);
    type('Input', 'a+b%20c');
    expect(output()).toBe('a b c');
    await act(async () => host.settings!.forTool('url').reset());
    expect(current()).toBe('Encode');
    expect(screen.getByLabelText('Encode as').textContent).toBe('Component');
    expect(field('Input').value).toBe('a+b%20c');
    expect(output()).toBe('a%2Bb%2520c');
    expect(savedOf(host)).toBeUndefined();
  });
});
