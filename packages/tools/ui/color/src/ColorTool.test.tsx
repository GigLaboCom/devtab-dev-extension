import ColorTool from './ColorTool';
import { definition } from './definition';
import { detect } from './detect';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { memoryHost } from '@workspace/tools-host';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  cleanup();
  delete (window as { EyeDropper?: unknown }).EyeDropper;
});

const field = (label: string) =>
  screen.getByLabelText(label, { selector: 'input:not([type=color])' }) as HTMLInputElement;
const type = (label: string, value: string) => fireEvent.change(field(label), { target: { value } });
const cell = (key: string) => document.querySelector(`[data-format="${key}"]`)!.textContent;
const fills = () => [...document.querySelectorAll('[data-swatch] [data-fill]')].map(r => r.getAttribute('fill'));
const check = (key: string) => document.querySelector(`[data-check="${key}"]`)!.textContent;
const stubClipboard = () => {
  const writeText = vi.fn((text: string) => Promise.resolve(text).then(() => undefined));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  return writeText;
};

describe('the Color tool’s definition', () => {
  it('describes the tool, recognises its input from a module of its own, loads its component', async () => {
    expect(definition).toMatchObject({ id: 'color', title: 'Color', order: 13, output: { origin: 'input' } });
    expect(definition.shortcut).toBeUndefined();
    expect(definition.history?.kinds.map(k => k.id)).toEqual(['convert']);
    expect(detect('#ff8800')).toBe(true);
    expect(detect('red')).toBe(false);
    expect((await definition.load()).default).toBe(ColorTool);
  });
});

describe('the Color tool, rendered with no host', () => {
  it('opens empty: an empty frame, empty formats, the background #ffffff, no contrast (§8)', () => {
    render(<ColorTool />);
    expect(field('Color').value).toBe('');
    expect(field('Color').placeholder).toBe('#ff8800, rgb(…), oklch(…)');
    expect(field('Background').value).toBe('#ffffff');
    expect(fills()).toEqual([]);
    expect(screen.getByRole('img', { name: 'No colour' })).toBeTruthy();
    expect(cell('hex')).toBe('');
    expect((screen.getByRole('button', { name: 'Copy HEX' }) as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector('[data-contrast]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pick from screen' })).toBeNull();
    expect(screen.getByLabelText('Pick a colour')).toHaveProperty('value', '#000000');
  });

  it('§2.1: #ff8800 in every notation, an orange swatch, the nearest name', () => {
    render(<ColorTool />);
    type('Color', '#ff8800');
    expect(
      ['hex', 'rgb', 'hsl', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'p3', 'name'].map(k => cell(k)).join(' | '),
    ).toBe(
      '#ff8800 | rgb(255 136 0) | hsl(32 100% 50%) | hwb(32 0% 0%) | lab(69.4 41.7 75.66) | lch(69.4 86.39 61.14) | ' +
        'oklab(74.42% 0.1001 0.151) | oklch(74.42% 0.1812 56.46) | color(display-p3 0.9387 0.5575 0.2057) | ' +
        '≈ darkorange(ΔE 0.009)',
    );
    expect(fills()).toEqual(['#ff8800']);
    expect(screen.getByLabelText('Pick a colour')).toHaveProperty('value', '#ff8800');
    expect(document.querySelector('[data-gamut]')!.textContent?.trim()).toBe('');
    for (const label of ['HEX', 'RGB', 'HSL', 'HWB', 'LAB', 'LCH', 'OKLAB', 'OKLCH', 'Display P3', 'Name'])
      expect(screen.getByRole('button', { name: `Copy ${label}` })).toBeTruthy();
  });

  it('§2.2: oklch(70% 0.4 150) — two halves and the gamut line', () => {
    render(<ColorTool />);
    type('Color', 'oklch(70% 0.4 150)');
    expect(fills()).toEqual(['oklch(0.7 0.4 150)', '#00c248']);
    expect(screen.getByText('As written')).toBeTruthy();
    expect(screen.getByText('sRGB')).toBeTruthy();
    expect(document.querySelector('[data-gamut]')!.textContent).toBe(
      'Outside sRGB and Display P3. The sRGB formats show the closest colour by CSS Color 4 gamut mapping: #00c248. Browsers clip it instead: #00d600.',
    );
    type('Color', 'color(display-p3 0 1 0)');
    expect(document.querySelector('[data-gamut]')!.textContent).toBe(
      'Outside sRGB, inside Display P3. The sRGB formats show the closest colour by CSS Color 4 gamut mapping: #00fb29. Browsers clip it instead: #00ff00.',
    );
    expect(document.querySelector('[data-gamut]')!.getAttribute('role')).toBe('status');
  });

  it('§2.3: #777777 on white fails AA normal, #767676 passes', () => {
    render(<ColorTool />);
    type('Color', '#777777');
    expect(document.querySelector('[data-ratio]')!.textContent).toBe('4.47:1');
    expect(check('aaNormal')).toBe('AA · normal text4.5:1Fail');
    expect(check('aaLarge')).toBe('AA · large text3:1Pass');
    type('Color', '#767676');
    expect(document.querySelector('[data-ratio]')!.textContent).toBe('4.54:1');
    expect(check('aaNormal')).toBe('AA · normal text4.5:1Pass');
    expect(check('aaaNormal')).toBe('AAA · normal text7:1Fail');
    expect(check('nonText')).toBe('UI components and graphics3:1Pass');
    const sample = document.querySelector('[data-contrast-sample]')!;
    expect(sample.querySelector('[data-fill="background"]')!.getAttribute('fill')).toBe('#ffffff');
    expect(sample.querySelector('[data-fill="text"]')!.getAttribute('fill')).toBe('#767676');
  });

  it('§2.4: ff8800 without # is read as #ff8800, said politely', () => {
    render(<ColorTool />);
    type('Color', 'ff8800');
    const note = screen.getByText('Read as #ff8800');
    expect(note.getAttribute('role')).toBe('status');
    expect(cell('hex')).toBe('#ff8800');
  });

  it('§2.5: semi-transparent text on white is blended and says so; the swatch sits on the checkerboard', () => {
    render(<ColorTool />);
    type('Color', '#00000080');
    expect(document.querySelector('[data-ratio]')!.textContent).toBe('4.00:1');
    expect(
      screen.getByText('The text colour is semi-transparent: contrast uses it blended over the background (#7f7f7f).'),
    ).toBeTruthy();
    expect(document.querySelector('[data-swatch] rect[fill^="url(#"]')).toBeTruthy();
    expect(document.querySelector('pattern rect.fill-muted')).toBeTruthy();
    type('Color', '#000000');
    type('Background', '#ffffff80');
    expect(screen.getByText('The background is semi-transparent: contrast uses it over white (#ffffff).')).toBeTruthy();
  });

  it('§2.6 and §6: errors next to their field, as a status; an invalid background empties the contrast', () => {
    render(<ColorTool />);
    type('Color', 'rgb(255 136)');
    const error = screen.getByText(
      'Not a CSS colour. Try #ff8800, rgb(255 136 0), hsl(32 100% 50%) or oklch(74% 0.18 56).',
    );
    expect(error.getAttribute('role')).toBe('status');
    expect(error.getAttribute('data-tone')).toBe('error');
    expect(cell('hex')).toBe('');
    type('Color', 'currentColor');
    expect(screen.getByText('currentColor depends on the page; enter a concrete colour.')).toBeTruthy();
    type('Color', 'rgb(from red r g b)');
    expect(
      screen.getByText('Relative colours, color-mix(), light-dark() and device-cmyk() are not supported.'),
    ).toBeTruthy();
    type('Color', 'x'.repeat(201));
    expect(screen.getByText('The colour is longer than 200 characters.')).toBeTruthy();
    type('Color', 'red');
    type('Background', 'nope');
    expect(document.querySelector('[data-contrast]')).toBeNull();
    expect(screen.getAllByRole('status').some(s => s.textContent?.startsWith('Not a CSS colour.'))).toBe(true);
    expect(cell('hex')).toBe('#ff0000');
  });

  it('§2.7: Pick from screen, where the browser has it, writes the pixel’s hex; Esc says nothing', async () => {
    let answer: Promise<{ sRGBHex: string }> = Promise.resolve({ sRGBHex: '#123456' });
    (window as { EyeDropper?: unknown }).EyeDropper = class {
      open() {
        return answer;
      }
    };
    render(<ColorTool />);
    fireEvent.click(screen.getByRole('button', { name: 'Pick from screen' }));
    await waitFor(() => expect(field('Color').value).toBe('#123456'));
    answer = Promise.reject(new DOMException('The user canceled the selection.', 'AbortError'));
    fireEvent.click(screen.getByRole('button', { name: 'Pick from screen' }));
    await act(async () => undefined);
    expect(field('Color').value).toBe('#123456');
  });

  it('the system pickers write #rrggbb into their field', () => {
    render(<ColorTool />);
    fireEvent.change(screen.getByLabelText('Pick a colour'), { target: { value: '#336699' } });
    expect(field('Color').value).toBe('#336699');
    fireEvent.change(screen.getByLabelText('Pick a background colour'), { target: { value: '#1e1e1e' } });
    expect(field('Background').value).toBe('#1e1e1e');
    type('Color', 'oklch(70% 0.4 150 / 0.5)');
    expect(screen.getByLabelText('Pick a colour')).toHaveProperty('value', '#00c248');
  });

  it('Swap exchanges the two fields as typed', () => {
    render(<ColorTool />);
    type('Color', 'ff8800');
    type('Background', ' #1e1e1e ');
    fireEvent.click(screen.getByRole('button', { name: 'Swap colour and background' }));
    expect(field('Color').value).toBe(' #1e1e1e ');
    expect(field('Background').value).toBe('ff8800');
  });

  it('copies exactly the shown value; the button says Copied until the value changes', async () => {
    const writeText = stubClipboard();
    render(<ColorTool input="#ff8800" />);
    const copy = screen.getByRole('button', { name: 'Copy OKLCH' });
    fireEvent.click(copy);
    await act(async () => undefined);
    expect(writeText).toHaveBeenCalledWith('oklch(74.42% 0.1812 56.46)');
    expect(screen.getByRole('button', { name: 'Copied OKLCH' })).toBe(copy);
    fireEvent.click(screen.getByRole('button', { name: 'Copy Name' }));
    await act(async () => undefined);
    expect(writeText).toHaveBeenLastCalledWith('≈ darkorange');
    type('Color', '#ff8801');
    expect(screen.getByRole('button', { name: 'Copy OKLCH' })).toBeTruthy();
    // Back to the value that was copied: still a change, so still "Copy" (§8: until the next change).
    type('Color', '#ff8800');
    expect(screen.getByRole('button', { name: 'Copy OKLCH' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Copied/ })).toBeNull();
  });

  it('every control is reachable in the order of §8', () => {
    (window as { EyeDropper?: unknown }).EyeDropper = class {
      open() {
        return Promise.reject(new Error('no'));
      }
    };
    render(<ColorTool input="#ff8800" />);
    const order = [...document.querySelectorAll<HTMLElement>('input, button')]
      .filter(e => !e.hasAttribute('disabled') && e.tabIndex >= 0)
      .map(e => e.getAttribute('aria-label') || (e.tagName === 'BUTTON' ? e.textContent : e.id));
    expect(order[0]).toBe('color-input');
    expect(order.slice(1, 13)).toEqual(['Pick a colour', 'Pick from screen', ...Array(10).fill('Copy')]);
    expect(order.at(-3)).toBe('color-background');
    expect(order.slice(-2)).toEqual(['Pick a background colour', 'Swap colour and background']);
    expect(within(document.body).getAllByRole('button', { name: /^Copy / })).toHaveLength(10);
  });
});

describe('the Color tool’s history', () => {
  it('a handed colour is the first edit; an edit is a snapshot, a copy commits; an entry opens back', async () => {
    stubClipboard();
    const host = memoryHost();
    const { unmount } = render(<ColorTool host={host} input="#ff8800" />);
    type('Background', '#1e1e1e');
    fireEvent.click(screen.getByRole('button', { name: 'Copy HEX' }));
    const history = host.history.forOwner('color', definition.history!);
    let entries: Awaited<ReturnType<typeof history.list>>['entries'] = [];
    await waitFor(async () => {
      entries = (await history.list({ kinds: ['convert'] })).entries;
      expect(entries).toHaveLength(1);
    });
    expect(entries[0]!.label).toBe('#ff8800 on #1e1e1e');
    unmount();

    render(<ColorTool host={host} restore={{ id: entries[0]!.id }} />);
    expect(await screen.findByText('Opened from History: #ff8800 on #1e1e1e.')).toBeTruthy();
    expect(field('Color').value).toBe('#ff8800');
    expect(field('Background').value).toBe('#1e1e1e');
    expect(document.querySelector('[data-ratio]')!.textContent).toBe('6.96:1');
  });

  it('nothing is written for an empty or unreadable colour', async () => {
    const host = memoryHost();
    render(<ColorTool host={host} />);
    type('Color', 'rgb(1 2)');
    type('Color', '');
    await act(async () => undefined);
    const history = host.history.forOwner('color', definition.history!);
    expect((await history.list()).entries).toHaveLength(0);
  });
});
