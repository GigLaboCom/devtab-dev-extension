/**
 * The Code Formatter's page (docs/tools/specs/code-format.md §2, §6, §8) in jsdom. jsdom has no workers, so the module
 * that starts them (formatter.ts) is replaced by one that formats on the page with the same libraries and the same
 * logic the workers run — Prettier 3.9.10's modules and saxes, imported here — and that announces the first use of a
 * language as the worker does. The saved parameters (D21, docs/tools/settings.md) run on an in-memory host.
 */
import CodeFormatTool from './CodeFormatTool';
import { definition } from './definition';
import { detect } from './detect';
import { codeFormatSettings } from './settings';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  DEFAULT_SETTINGS,
  LIVE_INPUT,
  MAX_INPUT,
  PRETTIER_PLUGINS,
  formatWithPrettier,
  formatXml,
} from '@workspace/tool-logic-code-format';
import { memoryHost } from '@workspace/tools-host';
import * as babel from 'prettier/plugins/babel';
import * as estree from 'prettier/plugins/estree';
import * as html from 'prettier/plugins/html';
import * as markdown from 'prettier/plugins/markdown';
import * as postcss from 'prettier/plugins/postcss';
import * as yaml from 'prettier/plugins/yaml';
import * as prettier from 'prettier/standalone';
import { SaxesParser } from 'saxes';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as FormatterModule from './formatter';
import type { FormatJob, FormatOutcome, Formatter } from './formatter';
import type { CodeLanguage, SaxParserClass } from '@workspace/tool-logic-code-format';

const MODULES = { babel, estree, postcss, html, markdown, yaml };

/** What the stand-in did: the jobs it was given, the languages it "loaded", and a way to hold a job (Cancel). */
const fake = vi.hoisted(() => ({
  jobs: [] as Array<{ language: string; length: number }>,
  loaded: new Set<string>(),
  hold: false,
  cancelled: 0,
  timedOut: false,
}));

vi.mock('./formatter', async importOriginal => {
  const original = await importOriginal<typeof FormatterModule>();
  const createFormatter = (): Formatter => {
    let latest = 0;
    const settleWith: Array<(o: FormatOutcome | null) => void> = [];
    return {
      run: async (job: FormatJob, onLoading?: (language: CodeLanguage) => void) => {
        const id = ++latest;
        fake.jobs.push({ language: job.language, length: job.text.length });
        while (settleWith.length) settleWith.shift()!(null);
        if (!fake.loaded.has(job.language)) {
          fake.loaded.add(job.language);
          onLoading?.(job.language);
        }
        if (fake.timedOut) return { timedOut: true };
        if (fake.hold) return new Promise(resolve => settleWith.push(resolve));
        await new Promise(resolve => setTimeout(resolve, 0));
        if (id !== latest) return null;
        const result =
          job.language === 'xml'
            ? formatXml(SaxesParser as unknown as SaxParserClass, job.text, job.settings.indent)
            : await formatWithPrettier(
                prettier,
                PRETTIER_PLUGINS[job.language].map(name => MODULES[name]),
                job.language,
                job.text,
                job.settings,
              );
        return id === latest ? { result, ms: 1 } : null;
      },
      cancel: () => {
        fake.cancelled++;
        latest++;
        while (settleWith.length) settleWith.shift()!(null);
      },
      dispose: () => void latest++,
    };
  };
  return { ...original, createFormatter };
});

beforeEach(() => {
  fake.jobs = [];
  fake.loaded = new Set();
  fake.hold = false;
  fake.cancelled = 0;
  fake.timedOut = false;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const input = () => document.getElementById('code-format-input') as HTMLTextAreaElement;
const output = () => (document.getElementById('code-format-output') as HTMLTextAreaElement | null)?.value ?? null;
const type = (value: string) => fireEvent.change(input(), { target: { value } });
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const status = () => document.querySelector('[data-part="status"]')!.textContent!.trim();
const note = () => document.querySelector('[data-part="note"]')!.textContent!.trim();
const choose = async (label: string, option: string) => {
  const trigger = screen.getByLabelText(label);
  fireEvent.keyDown(trigger, { key: 'Enter' });
  const item = await screen.findByRole('option', { name: option });
  fireEvent.keyDown(item, { key: 'Enter' });
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
};
const optionsOf = async (label: string) => {
  fireEvent.keyDown(screen.getByLabelText(label), { key: 'Enter' });
  const options = (await screen.findAllByRole('option')).map(o => o.textContent);
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  return options;
};
const WAIT = { timeout: 10_000 };
const result = async (expected: string) => waitFor(() => expect(output()).toBe(expected), WAIT);
const said = async (expected: string) => waitFor(() => expect(status()).toBe(expected), WAIT);

describe('the Code Formatter’s definition', () => {
  it('describes the tool: no shortcut, output from the input, one history kind; recognises code, not YAML', async () => {
    expect(definition).toMatchObject({
      id: 'code-format',
      title: 'Code Formatter',
      summary: 'Format JavaScript, TypeScript, CSS, SCSS, LESS, HTML, XML, Markdown and YAML.',
      order: 20,
      output: { origin: 'input' },
    });
    expect(definition.keywords).toEqual([
      'format',
      'prettier',
      'beautify',
      'pretty print',
      'javascript',
      'typescript',
      'css',
      'scss',
      'less',
      'html',
      'xml',
      'markdown',
      'yaml',
    ]);
    expect(definition.shortcut).toBeUndefined();
    expect(definition.history?.kinds).toEqual([{ id: 'format', title: 'Formatted' }]);
    expect(detect('a{color:red}')).toBe(true);
    expect(detect('a: 1\nb: 2')).toBe(false);
    expect(detect('{"a": 1}')).toBe(false);
    expect((await definition.load()).default).toBe(CodeFormatTool);
  });
});

describe('the Code Formatter, rendered with no host', () => {
  it('starts empty: Auto, 2 spaces, 80; no second row, no messages; Copy and Save off (§3, §8)', () => {
    render(<CodeFormatTool />);
    expect(screen.getByLabelText('Language').textContent).toBe('Auto');
    expect(screen.getByLabelText('Indent').textContent).toBe('2 spaces');
    expect(screen.getByLabelText('Line width').textContent).toBe('80');
    expect(screen.getByLabelText('Code')).toBe(input());
    expect(input().placeholder).toBe('Paste code: JavaScript, CSS, HTML, XML…');
    expect(input().getAttribute('spellcheck')).toBe('false');
    const out = screen.getByLabelText('Formatted') as HTMLTextAreaElement;
    expect(out.readOnly).toBe(true);
    expect(out.getAttribute('spellcheck')).toBe('false');
    expect(status()).toBe('');
    expect(document.querySelector('[data-part="language-options"]')).toBeNull();
    expect(button('Copy').disabled).toBe(true);
    expect(button('Save').disabled).toBe(true);
    expect(button('Open file')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Run' })).toBeNull();
  });

  it('§2.1 minified CSS: Auto (CSS), the loading line on first use, then the result', async () => {
    fake.hold = true;
    render(<CodeFormatTool />);
    type('a{color:red;background:BLUE}b,c{margin:0 0 0 0}');
    await said('Loading the CSS formatter…');
    expect(screen.getByLabelText('Language').textContent).toBe('Auto (CSS)');
    fake.hold = false;
    // An option change formats at once; the second row is CSS's: Quotes only.
    fireEvent.click(screen.getByRole('radio', { name: 'Single' }));
    await result('a {\n  color: red;\n  background: BLUE;\n}\nb,\nc {\n  margin: 0 0 0 0;\n}\n');
    expect(status()).toBe('');
    const row = document.querySelector('[data-part="language-options"]')!;
    expect(row.textContent).toBe('QuotesDoubleSingle');
    expect(button('Copy').disabled).toBe(false);
  });

  it('§2.2 a JavaScript function in the person’s style: single quotes, no semicolons, 4 spaces', async () => {
    render(<CodeFormatTool />);
    type('function greet(name){return "Hello, "+name}');
    await result('function greet(name) {\n  return "Hello, " + name;\n}\n');
    fireEvent.click(screen.getByRole('radio', { name: 'Single' }));
    fireEvent.click(screen.getByLabelText('Semicolons'));
    await choose('Indent', '4 spaces');
    await result("function greet(name) {\n    return 'Hello, ' + name\n}\n");
    expect(screen.getByLabelText('Trailing commas').textContent).toBe('All');
    expect(await optionsOf('Trailing commas')).toEqual(['All', 'ES5', 'None']);
  });

  it('§2.3 a typo: the error with its place is a link that puts the cursor there; never an alert', async () => {
    render(<CodeFormatTool />);
    await choose('Language', 'JavaScript');
    type('const a = {\n  b: 1,,\n};');
    await said('Line 2, column 8: Unexpected token');
    expect(output()).toBe('');
    expect(button('Copy').disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /^Line 2, column 8/ }));
    expect(document.activeElement).toBe(input());
    expect(input().selectionStart).toBe(19);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('§2.4 a SOAP answer: every element on its own line, mixed content on one; no Line width, no second row', async () => {
    render(<CodeFormatTool />);
    type('<?xml version="1.0"?><note id="1"><to>Ann</to><body>Hi <b>there</b></body></note>');
    await result('<?xml version="1.0"?>\n<note id="1">\n  <to>Ann</to>\n  <body>Hi <b>there</b></body>\n</note>\n');
    expect(screen.getByLabelText('Language').textContent).toBe('Auto (XML)');
    expect(screen.queryByLabelText('Line width')).toBeNull();
    expect(document.querySelector('[data-part="language-options"]')).toBeNull();
    expect(await optionsOf('Indent')).toEqual(['2 spaces', '4 spaces', 'Tab']);
  });

  it('§2.5 an XML error just after the construct', async () => {
    render(<CodeFormatTool />);
    await choose('Language', 'XML');
    type('<a>\n  <b></a>');
    await said('Line 2, column 10: unexpected close tag');
  });

  it('§2.6 Markdown: aligned columns, - for list markers; Prose wrap in the second row', async () => {
    render(<CodeFormatTool />);
    await choose('Language', 'Markdown');
    type('# Title\n*  one\n*  two\n\n| a | b |\n|-|-|\n| long cell | x |');
    await result('# Title\n\n- one\n- two\n\n| a         | b   |\n| --------- | --- |\n| long cell | x   |\n');
    expect(screen.getByLabelText('Prose wrap').textContent).toBe('Preserve');
    expect(await optionsOf('Prose wrap')).toEqual(['Preserve', 'Always', 'Never']);
  });

  it('§2.7 YAML keeps comments; there is no Tab for YAML', async () => {
    render(<CodeFormatTool />);
    await choose('Indent', 'Tab');
    await choose('Language', 'YAML');
    expect(screen.getByLabelText('Indent').textContent).toBe('2 spaces');
    expect(await optionsOf('Indent')).toEqual(['2 spaces', '4 spaces']);
    type('kind:   Pod\n# the name\nmetadata:\n    name: web');
    await result('kind: Pod\n# the name\nmetadata:\n  name: web\n');
  });

  it('HTML: Whitespace in the second row and the note about <script> and <style> under the result', async () => {
    render(<CodeFormatTool />);
    type('<!doctype html><div><script>let a = {;</script></div>');
    await result('<!doctype html>\n<div>\n  <script>\n    let a = {;\n  </script>\n</div>\n');
    expect(screen.getByLabelText('Language').textContent).toBe('Auto (HTML)');
    expect(note()).toBe("Code inside <script> and <style> that doesn't parse is left as it is.");
    expect(await optionsOf('Whitespace')).toEqual(['CSS', 'Strict', 'Ignore']);
  });

  it('text that looks like none of them: no result, the line asks for a language (§5 п. 7)', async () => {
    render(<CodeFormatTool />);
    type('hello world');
    await said("Choose a language: this text doesn't look like any of them.");
    expect(output()).toBe('');
    expect(fake.jobs).toEqual([]);
    await choose('Language', 'Markdown');
    await result('hello world\n');
  });

  it('blank input: blank result, no message (§6)', async () => {
    render(<CodeFormatTool />);
    await choose('Language', 'JavaScript');
    type('   \n  ');
    await new Promise(resolve => setTimeout(resolve, 400));
    expect(status()).toBe('');
    expect(output()).toBe('');
  });

  it('copies and saves the result as formatted.<extension>', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const created: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      created.push(blob);
      return 'blob:formatted';
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<CodeFormatTool />);
    type('const a={b:1}');
    await result('const a = { b: 1 };\n');
    fireEvent.click(button('Copy'));
    await act(async () => undefined);
    expect(writeText).toHaveBeenCalledWith('const a = { b: 1 };\n');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
    fireEvent.click(button('Save'));
    const link = click.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(link.download).toBe('formatted.js');
    expect(await created[0]!.text()).toBe('const a = { b: 1 };\n');
    await choose('Language', 'Markdown');
    type('*  a');
    await result('- a\n');
    fireEvent.click(button('Save'));
    expect((click.mock.instances[1] as unknown as HTMLAnchorElement).download).toBe('formatted.md');
  });

  it('opens a file: the extension chooses the language; another extension is Auto; not UTF-8 is refused', async () => {
    render(<CodeFormatTool />);
    const picker = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(picker.accept.split(',')).toEqual(expect.arrayContaining(['.tsx', '.plist', '.markdown', '.yml']));
    fireEvent.change(picker, { target: { files: [new File(['let a:number=1'], 'a.ts')] } });
    await result('let a: number = 1;\n');
    expect(screen.getByLabelText('Language').textContent).toBe('TypeScript');
    fireEvent.change(picker, { target: { files: [new File(['a{b:c}'], 'notes.txt')] } });
    await result('a {\n  b: c;\n}\n');
    expect(screen.getByLabelText('Language').textContent).toBe('Auto (CSS)');
    fireEvent.change(picker, { target: { files: [new File([new Uint8Array([0xff, 0xfe])], 'bad.css')] } });
    await said('The file is not valid UTF-8 text.');
  });

  it('a large input waits for Run (or Ctrl+Enter), Cancel stops it; over the limit is refused (§6, §12)', async () => {
    render(<CodeFormatTool />);
    await choose('Language', 'CSS');
    const big = 'a{color:red}\n'.repeat(Math.ceil(LIVE_INPUT / 13) + 1);
    type(big);
    await said('Large input: press Run (Ctrl+Enter) to format it.');
    expect(fake.jobs).toEqual([]);
    expect(output()).toBe('');
    fake.hold = true;
    // While a language's modules load for the first time, the line says that; after — Formatting….
    fireEvent.click(button('Run'));
    await said('Loading the CSS formatter…');
    fireEvent.click(button('Cancel'));
    fireEvent.click(button('Run'));
    await said('Formatting…');
    expect(document.activeElement).toBe(button('Cancel'));
    fireEvent.click(button('Cancel'));
    await said('Large input: press Run (Ctrl+Enter) to format it.');
    expect(fake.cancelled).toBeGreaterThan(0);
    fake.hold = false;
    fireEvent.keyDown(input(), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(output()!.startsWith('a {\n  color: red;\n}\n')).toBe(true), WAIT);
    type('a{}'.repeat(MAX_INPUT.css / 3 + 1));
    expect(status()).toBe('Input is larger than 2 MB. Formatting works with up to 2 MB of CSS.');
    expect(screen.queryByRole('button', { name: 'Run' })).toBeNull();
    await choose('Language', 'Markdown');
    type('x'.repeat(MAX_INPUT.markdown + 1));
    expect(status()).toBe('Input is larger than 256 KB. Formatting works with up to 256 KB of Markdown.');
  }, 60_000);

  it('a formatting that outruns the time limit is stopped and said so', async () => {
    fake.timedOut = true;
    render(<CodeFormatTool />);
    type('const a = 1;');
    await said('Formatting took longer than 15 seconds and was stopped.');
    expect(output()).toBe('');
  });

  it('a result too large to show is a summary; Copy still has it', async () => {
    render(<CodeFormatTool />);
    await choose('Language', 'YAML');
    type(`- 1\n`.repeat(200_001));
    fireEvent.click(button('Run'));
    await waitFor(() => expect(document.querySelector('[data-part="summary"]')).toBeTruthy(), WAIT);
    expect(document.querySelector('[data-part="summary"]')!.textContent).toBe(
      'Result: 781.3 KB, 200,002 lines. Too large to show here.',
    );
    expect(output()).toBeNull();
    expect(button('Copy').disabled).toBe(false);
  }, 60_000);
});

describe('the Code Formatter’s history', () => {
  const entriesOf = async (host: ReturnType<typeof memoryHost>) =>
    (await host.history.forOwner('code-format', definition.history!).list({})).entries;
  /** The entries once the history has stopped changing (two equal counts 60 ms apart). */
  const settled = async (host: ReturnType<typeof memoryHost>) => {
    let before = -1;
    for (;;) {
      const now = await entriesOf(host);
      if (now.length === before) return now;
      before = now.length;
      await new Promise(resolve => setTimeout(resolve, 60));
    }
  };

  it('records an edit as a snapshot when the page goes away, with the language as recognised', async () => {
    const host = memoryHost();
    const { unmount } = render(<CodeFormatTool host={host} />);
    type('a{color:red}');
    await result('a {\n  color: red;\n}\n');
    unmount();
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(1), WAIT);
    expect((await entriesOf(host))[0]!.label).toBe('CSS (Auto) · 2 spaces · 12 characters');
  });

  it('commits Copy and Save at once, with the code, the options and the result; an error is recorded with its place', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.resolve() },
    });
    URL.createObjectURL = vi.fn(() => 'blob:x') as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const host = memoryHost();
    const { unmount } = render(<CodeFormatTool host={host} />);
    await choose('Language', 'TypeScript');
    type('let a:number=1');
    await result('let a: number = 1;\n');
    fireEvent.click(button('Copy'));
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(1), WAIT);
    fireEvent.click(button('Save'));
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(2), WAIT);
    const labels = (await entriesOf(host)).map(e => e.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        'TypeScript · 2 spaces · 14 characters · copied',
        'TypeScript · 2 spaces · 14 characters · saved',
      ]),
    );
    const history = host.history.forOwner('code-format', definition.history!);
    const copied = (await entriesOf(host)).find(e => e.label?.endsWith('copied'))!;
    const opened = await history.open(copied.id);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.payload).toMatchObject({
      choice: 'typescript',
      language: 'typescript',
      outcome: 'ok',
      action: 'copy',
    });
    expect(await opened.blobs.input!.text()).toBe('let a:number=1');
    expect(await opened.blobs.output!.text()).toBe('let a: number = 1;\n');
    type('let a: = 1');
    await said('Line 1, column 8: Unexpected token');
    unmount();
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(3), WAIT);
    expect((await entriesOf(host)).map(e => e.label)).toContain(
      'TypeScript · 2 spaces · error at line 1, column 8 · 10 characters',
    );
  });

  it('commits a Run’s result (an explicit action)', async () => {
    const host = memoryHost();
    render(<CodeFormatTool host={host} />);
    await choose('Language', 'CSS');
    type('a{b:c}\n'.repeat(Math.ceil(LIVE_INPUT / 7) + 1));
    fireEvent.click(button('Run'));
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(1), WAIT);
    expect((await entriesOf(host))[0]!.label).toMatch(/^CSS · 2 spaces · [\d,]+ characters · run$/);
  });

  it('opens an entry back into the tool: code, language, options; opening records nothing', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.resolve() },
    });
    const host = memoryHost();
    const first = render(<CodeFormatTool host={host} />);
    await choose('Language', 'JavaScript');
    await choose('Indent', 'Tab');
    await choose('Line width', '120');
    await choose('Trailing commas', 'None');
    type('if(a){b()}');
    await result('if (a) {\n\tb();\n}\n');
    fireEvent.click(button('Copy'));
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(1), WAIT);
    first.unmount();
    await act(async () => undefined);
    const entries = await settled(host);
    const copied = entries.find(e => e.label?.endsWith('copied'))!;
    expect(copied.label).toBe('JavaScript · Tab · 10 characters · copied');

    const second = render(<CodeFormatTool host={host} restore={{ id: copied.id }} />);
    expect(await screen.findByText(`Opened from History: ${copied.label}.`)).toBeTruthy();
    expect(input().value).toBe('if(a){b()}');
    expect(screen.getByLabelText('Language').textContent).toBe('JavaScript');
    expect(screen.getByLabelText('Indent').textContent).toBe('Tab');
    expect(screen.getByLabelText('Line width').textContent).toBe('120');
    expect(screen.getByLabelText('Trailing commas').textContent).toBe('None');
    await result('if (a) {\n\tb();\n}\n');
    second.unmount();
    await act(async () => undefined);
    expect(await settled(host)).toHaveLength(entries.length);
  });

  it('records text handed over from the start page as the visit’s first edit', async () => {
    const host = memoryHost();
    const { unmount } = render(<CodeFormatTool host={host} input="const a=1" />);
    await result('const a = 1;\n');
    unmount();
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(1), WAIT);
    expect((await entriesOf(host))[0]!.label).toBe('JavaScript (Auto) · 2 spaces · 9 characters');
  });
});

describe('the Code Formatter’s saved parameters (D21, docs/tools/settings.md)', () => {
  const entriesOf = async (host: ReturnType<typeof memoryHost>) =>
    (await host.history.forOwner('code-format', definition.history!).list({})).entries;
  const savedOf = (host: ReturnType<typeof memoryHost>) => host.settings.forTool('code-format').saved();
  const seeded = async (values: Record<string, unknown>) => {
    const host = memoryHost();
    host.settings.forTool('code-format').save(codeFormatSettings.schema, values as never);
    await host.settings.forTool('code-format').flush();
    return host;
  };
  const shown = (label: string) => screen.getByLabelText(label).textContent;
  const ticked = (label: string) => screen.getByLabelText(label).getAttribute('aria-checked');
  const quotes = () =>
    screen.getByRole('radio', { name: 'Single' }).getAttribute('aria-checked') === 'true' ? 'single' : 'double';

  it('saves the language and every option the person chose; reopened, it is as left', async () => {
    const host = memoryHost();
    const first = render(<CodeFormatTool host={host} />);
    await choose('Language', 'HTML');
    await choose('Whitespace', 'Strict');
    await choose('Language', 'Markdown');
    await choose('Prose wrap', 'Always');
    await choose('Language', 'JavaScript');
    await choose('Indent', '4 spaces');
    await choose('Line width', '100');
    fireEvent.click(screen.getByLabelText('Semicolons'));
    fireEvent.click(screen.getByRole('radio', { name: 'Single' }));
    await choose('Trailing commas', 'ES5');
    first.unmount();
    expect(savedOf(host)).toEqual({
      schema: 1,
      values: {
        language: 'javascript',
        indent: 4,
        lineWidth: 100,
        semi: false,
        singleQuote: true,
        trailingComma: 'es5',
        whitespace: 'strict',
        proseWrap: 'always',
      },
    });
    render(<CodeFormatTool host={host} />);
    expect(shown('Language')).toBe('JavaScript');
    expect(shown('Indent')).toBe('4 spaces');
    expect(shown('Line width')).toBe('100');
    expect(ticked('Semicolons')).toBe('false');
    expect(quotes()).toBe('single');
    expect(shown('Trailing commas')).toBe('ES5');
    type('function f(a,b){return [a,"x"+b,]}');
    await result("function f(a, b) {\n    return [a, 'x' + b]\n}\n");
    await choose('Language', 'HTML');
    expect(shown('Whitespace')).toBe('Strict');
    await choose('Language', 'Markdown');
    expect(shown('Prose wrap')).toBe('Always');
  });

  it('a saved record it cannot show falls back field by field; a value a list no longer has is its default', async () => {
    render(
      <CodeFormatTool
        host={await seeded({
          language: 'javascript',
          indent: 3,
          lineWidth: 90,
          semi: 'no',
          singleQuote: true,
          trailingComma: 'some',
        })}
      />,
    );
    expect(shown('Language')).toBe('JavaScript');
    expect(shown('Indent')).toBe('2 spaces');
    expect(shown('Line width')).toBe('80');
    expect(ticked('Semicolons')).toBe('true');
    expect(quotes()).toBe('single');
    expect(shown('Trailing commas')).toBe('All');
    cleanup();
    render(<CodeFormatTool host={await seeded({ language: 'html', whitespace: 'tight' })} />);
    expect(shown('Whitespace')).toBe('CSS');
    cleanup();
    render(<CodeFormatTool host={await seeded({ language: 'markdown', proseWrap: 'sometimes', lineWidth: 120 })} />);
    expect(shown('Prose wrap')).toBe('Preserve');
    expect(shown('Line width')).toBe('120');
    cleanup();
    render(<CodeFormatTool host={await seeded({ language: 'cobol', indent: 'tab' })} />);
    expect(shown('Language')).toBe('Auto');
    expect(shown('Indent')).toBe('Tab');
  });

  it('YAML shows 2 spaces for a saved Tab and keeps the Tab; a saved language loads nothing until there is code', async () => {
    const host = await seeded({ language: 'yaml', indent: 'tab' });
    const first = render(<CodeFormatTool host={host} />);
    expect(shown('Language')).toBe('YAML');
    expect(shown('Indent')).toBe('2 spaces');
    await new Promise(resolve => setTimeout(resolve, 400));
    expect(fake.jobs).toEqual([]);
    expect([...fake.loaded]).toEqual([]);
    expect(status()).toBe('');
    type('a:   1');
    await result('a: 1\n');
    expect(fake.jobs.map(j => j.language)).toEqual(['yaml']);
    await choose('Language', 'JavaScript');
    expect(shown('Indent')).toBe('Tab');
    first.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: { language: 'javascript', indent: 'tab' } });
  });

  it('a paste opens Auto, a file its language and an entry its own — for the visit; what is saved stays', async () => {
    const host = await seeded({ language: 'css', indent: 4 });
    const pasted = render(<CodeFormatTool host={host} input="const a={b:1}" />);
    expect(shown('Indent')).toBe('4 spaces');
    await result('const a = { b: 1 };\n');
    expect(shown('Language')).toBe('Auto (JavaScript)');
    pasted.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: { language: 'css', indent: 4 } });

    const filed = render(<CodeFormatTool host={host} />);
    expect(shown('Language')).toBe('CSS');
    const picker = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(picker, { target: { files: [new File(['*  a'], 'notes.md')] } });
    await result('- a\n');
    expect(shown('Language')).toBe('Markdown');
    filed.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: { language: 'css', indent: 4 } });

    const recorder = host.history.forOwner('code-format', definition.history!).session();
    await recorder.commit({
      kind: 'format',
      label: 'TypeScript · 2 spaces · 14 characters',
      payload: {
        choice: 'typescript',
        language: 'typescript',
        settings: { ...DEFAULT_SETTINGS },
        outcome: 'ok',
        lines: 1,
      },
      blobs: { input: new Blob(['let a:number=1']), output: new Blob(['let a: number = 1;\n']) },
    });
    const entry = (await entriesOf(host)).find(e => e.label === 'TypeScript · 2 spaces · 14 characters')!;
    const opened = render(<CodeFormatTool host={host} restore={{ id: entry.id }} />);
    expect(await screen.findByText('Opened from History: TypeScript · 2 spaces · 14 characters.')).toBeTruthy();
    expect(shown('Language')).toBe('TypeScript');
    expect(shown('Indent')).toBe('2 spaces');
    await result('let a: number = 1;\n');
    opened.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: { language: 'css', indent: 4 } });
    render(<CodeFormatTool host={host} />);
    expect(shown('Language')).toBe('CSS');
    expect(shown('Indent')).toBe('4 spaces');
  });

  it('reset puts the language and the options back to the defaults and keeps the code; the result follows', async () => {
    const host = await seeded({ language: 'javascript', indent: 4, semi: false, singleQuote: true });
    render(<CodeFormatTool host={host} />);
    type('let a="b"');
    await result("let a = 'b'\n");
    await act(async () => host.settings.forTool('code-format').reset());
    expect(shown('Language')).toBe('Auto (JavaScript)');
    expect(shown('Indent')).toBe('2 spaces');
    expect(input().value).toBe('let a="b"');
    await result('let a = "b";\n');
    expect(savedOf(host)).toBeUndefined();
  });
});
