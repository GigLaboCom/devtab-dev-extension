// docs/tools/specs/number-base.md §2 (scenarios), §3–§4 (the source field, the options, N), §5 (output and details),
// §6 (errors under the source field), §8 (the interface: labels, placeholders, copy buttons) and the history of
// docs/tools/history.md §10.
import { definition } from './definition';
import { detect } from './detect';
import NumberBaseTool from './NumberBaseTool';
import { numberBaseSettings } from './settings';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { memoryHost } from '@workspace/tools-host';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolHost } from '@workspace/tools-host';

const LABELS = ['Binary', 'Octal', 'Decimal', 'Hexadecimal'] as const;
const field = (name: (typeof LABELS)[number]) => screen.getByLabelText(name, { selector: 'input' }) as HTMLInputElement;
const baseField = () => screen.getByLabelText(/^Number in base/) as HTMLInputElement;
const radix = () => screen.getByRole('textbox', { name: 'Base' }) as HTMLInputElement;
const type = (input: HTMLInputElement, value: string) => fireEvent.change(input, { target: { value } });
/** The five fields as §10 lists them: binary / octal / decimal / hexadecimal / base N. */
const values = () => [...LABELS.map(l => field(l).value), baseField().value];
const message = (id: string) => document.getElementById(`number-base-${id}-message`)?.textContent ?? '';
const details = (): Record<string, string> =>
  Object.fromEntries(
    [...document.querySelectorAll('[aria-label="Details"] [data-row]')].map(row => [
      row.getAttribute('data-row'),
      row.querySelector('output')?.textContent ?? '',
    ]),
  );
const check = (name: string) => fireEvent.click(screen.getByRole('checkbox', { name }));
const choose = async (label: string, option: string) => {
  await act(async () => {
    fireEvent.click(screen.getByRole('combobox', { name: label }));
  });
  await act(async () => {
    fireEvent.click(await screen.findByRole('option', { name: option }));
  });
};
const twos = async (width: '8 bits' | '16 bits' | '32 bits' | '64 bits' = '32 bits') => {
  await choose('Negative numbers', "Two's complement");
  if (width !== '32 bits') await choose('Width', width);
};

let writeText: ReturnType<typeof vi.fn>;
beforeEach(() => {
  writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
});
afterEach(cleanup);

describe('the Number Bases tool’s definition', () => {
  it('describes the tool, derives its result from the input, has no default shortcut, loads its component', async () => {
    expect(definition).toMatchObject({
      id: 'number-base',
      title: 'Number Bases',
      summary: 'Convert a whole number between binary, octal, decimal, hex and any base up to 36.',
      order: 15,
      output: { origin: 'input' },
    });
    expect(definition.shortcut).toBeUndefined();
    expect(definition.keywords).toEqual([
      'number',
      'base',
      'radix',
      'binary',
      'octal',
      'decimal',
      'hex',
      "two's complement",
      'bigint',
      '0x',
    ]);
    expect(definition.history?.kinds).toEqual([{ id: 'convert', title: 'Converted' }]);
    expect((await definition.load()).default).toBe(NumberBaseTool);
  });

  it('recognises only a number with its prefix, from a module of its own (§7)', () => {
    expect(['0xFF', '-0x1f', '0b1010', '0o755', '0x1F_FF'].map(detect)).toEqual([true, true, true, true, true]);
    expect(['255', '1700000000', 'deadbeef', '#ff8800', '0x', '0b102'].map(detect)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});

describe('the Number Bases tool, rendered with no host', () => {
  it('§8: empty — five fields with their placeholders, copy buttons off, no details, the options at their defaults', () => {
    render(<NumberBaseTool />);
    expect(LABELS.map(l => field(l).placeholder)).toEqual(['0b1010', '0o12', '10', '0xa']);
    expect(baseField().placeholder).toBe('a');
    expect(values()).toEqual(['', '', '', '', '']);
    expect(radix().value).toBe('36');
    expect(radix().getAttribute('inputmode')).toBe('numeric');
    for (const name of ['Copy binary', 'Copy octal', 'Copy decimal', 'Copy hexadecimal', 'Copy base 36'])
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector('[aria-label="Details"]')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Negative numbers' }).textContent).toBe('Minus sign');
    expect(screen.getByRole('combobox', { name: 'Width' }).textContent).toBe('32 bits');
    expect((screen.getByRole('combobox', { name: 'Width' }) as HTMLButtonElement).disabled).toBe(true);
    for (const name of ['Uppercase', 'Group digits', 'Prefixes'])
      expect(screen.getByRole('checkbox', { name }).getAttribute('aria-checked')).toBe('false');
    for (const input of [...LABELS.map(field), baseField(), radix()]) {
      expect(input.getAttribute('spellcheck')).toBe('false');
      expect(input.getAttribute('autocomplete')).toBe('off');
    }
  });

  it('§2.1: 0xFF pasted into Hexadecimal — the other fields and the details', () => {
    render(<NumberBaseTool />);
    type(field('Hexadecimal'), '0xFF');
    expect(values()).toEqual(['11111111', '377', '255', '0xFF', '73']);
    expect(details()).toEqual({
      'bit-length': '8',
      'byte-length': '1',
      'bytes-be': 'ff',
      'bytes-le': 'ff',
    });
  });

  it("§2.2: -2147024891 in Decimal, two's complement 32 bits — hex 80070005, Unsigned 2147942405", async () => {
    render(<NumberBaseTool />);
    await twos();
    expect((screen.getByRole('combobox', { name: 'Width' }) as HTMLButtonElement).disabled).toBe(false);
    type(field('Decimal'), '-2147024891');
    expect(field('Hexadecimal').value).toBe('80070005');
    expect(details()).toEqual({
      signed: '-2147024891',
      unsigned: '2147942405',
      'bit-length': '32',
      'byte-length': '4',
      'bytes-be': '80 07 00 05',
      'bytes-le': '05 00 07 80',
    });
  });

  it("§2.3: ffffffff in Hexadecimal, two's complement 32 bits — Decimal -1, both readings", async () => {
    render(<NumberBaseTool />);
    await twos();
    type(field('Hexadecimal'), 'ffffffff');
    expect(values()).toEqual(['1'.repeat(32), '37777777777', '-1', 'ffffffff', '1z141z3']);
    expect(details()).toMatchObject({ signed: '-1', unsigned: '4294967295' });
  });

  it('§2.4: 1,000,000 in Decimal; Group digits groups the other fields, not the source', () => {
    render(<NumberBaseTool />);
    type(field('Decimal'), '1,000,000');
    expect(field('Binary').value).toBe('11110100001001000000');
    check('Group digits');
    expect(values()).toEqual(['1111 0100 0010 0100 0000', '3 641 100', '1,000,000', 'f 4240', 'lfls']);
    expect(details()['bytes-be']).toBe('0f 42 40');
  });

  it('§2.5: 12.5 in Decimal — the error under it, the other fields and the details empty', () => {
    render(<NumberBaseTool />);
    type(field('Decimal'), '255');
    type(field('Decimal'), '12.5');
    expect(message('decimal')).toBe('Column 3: only whole numbers: fractions are not supported');
    expect(field('Decimal').getAttribute('aria-invalid')).toBe('true');
    expect(values()).toEqual(['', '', '12.5', '', '']);
    expect(document.querySelector('[aria-label="Details"]')).toBeNull();
    expect(document.getElementById('number-base-decimal-message')?.getAttribute('role')).toBe('status');
    for (const id of ['binary', 'octal', 'hexadecimal', 'base']) expect(message(id)).toBe('');
  });

  it('§2.6: 0xff in Decimal — the hint where it goes', () => {
    render(<NumberBaseTool />);
    type(field('Decimal'), '0xff');
    expect(message('decimal')).toBe('Column 2: "x" is not a base-10 digit; 0x… numbers go in the Hexadecimal field');
  });

  it('§2.7: 30 digits exactly — hex and bit length', () => {
    render(<NumberBaseTool />);
    type(field('Decimal'), '123456789012345678901234567890');
    expect(field('Hexadecimal').value).toBe('18ee90ff6c373e0ee4e3f0ad2');
    expect(baseField().value).toBe('byw97um9s91dlz68tsi');
    expect(details()).toMatchObject({ 'bit-length': '97', 'byte-length': '13' });
  });

  it('the source keeps its text as typed; editing another field makes it the source', () => {
    render(<NumberBaseTool />);
    type(field('Hexadecimal'), ' 0x00ff ');
    expect(field('Hexadecimal').value).toBe(' 0x00ff ');
    type(field('Binary'), '1_0000');
    expect(values()).toEqual(['1_0000', '20', '16', '10', 'g']);
    type(field('Binary'), '');
    expect(values()).toEqual(['', '', '', '', '']);
    expect(message('binary')).toBe('');
  });

  it('Uppercase, Prefixes and a minus sign in every base; copy takes the value without groups', async () => {
    render(<NumberBaseTool />);
    type(field('Decimal'), '-255');
    check('Uppercase');
    check('Prefixes');
    check('Group digits');
    expect(values()).toEqual(['-0b1111 1111', '-0o377', '-255', '-0xFF', '-73']);
    expect(details()).toMatchObject({ 'bytes-be': '—', 'bytes-le': '—' });
    expect(screen.getByText("Switch to two's complement to see the bytes of a negative number.")).toBeTruthy();
    expect(screen.getAllByText('—')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Copy binary' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('-0b11111111'));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
  });

  it('each field copies its own canonical value — the source too', async () => {
    render(<NumberBaseTool />);
    type(field('Decimal'), '  0042 ');
    check('Prefixes');
    for (const [name, text] of [
      ['Copy decimal', '42'],
      ['Copy binary', '0b101010'],
      ['Copy octal', '0o52'],
      ['Copy hexadecimal', '0x2a'],
      ['Copy base 36', '16'],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name }));
      await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(text));
    }
  });

  it('a bytes row shows 64 bytes and the count; its copy button copies them all', async () => {
    render(<NumberBaseTool />);
    type(field('Hexadecimal'), 'ab'.repeat(100));
    expect(details()['bytes-be']).toBe(`${Array(64).fill('ab').join(' ')} … (100 bytes)`);
    fireEvent.click(screen.getByRole('button', { name: 'Copy bytes (big-endian)' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(Array(100).fill('ab').join(' ')));
    fireEvent.click(screen.getByRole('button', { name: 'Copy bit length' }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('800'));
  });

  it("two's complement: changing Width re-reads the source; out of range is an error under it", async () => {
    render(<NumberBaseTool />);
    type(field('Decimal'), '-129');
    await twos('8 bits');
    expect(message('decimal')).toBe('Column 2: does not fit in 8 bits: the range is -128 to 255');
    expect(values()).toEqual(['', '', '-129', '', '']);
    await choose('Width', '16 bits');
    expect(message('decimal')).toBe('');
    check('Group digits');
    expect(values()).toEqual(['1111 1111 0111 1111', '177 577', '-129', 'ff7f', '1egv']);
    await choose('Negative numbers', 'Minus sign');
    expect(values()).toEqual(['-1000 0001', '-201', '-129', '-81', '-3l']);
  });

  it('§4: a new N keeps the number; when Base was the source, Decimal becomes it', () => {
    render(<NumberBaseTool />);
    type(baseField(), 'zz');
    expect(field('Decimal').value).toBe('1295');
    type(radix(), '1');
    expect(message('radix')).toBe('Base must be a whole number from 2 to 36');
    expect(baseField().disabled).toBe(true);
    expect(baseField().value).toBe('');
    expect(values().slice(0, 4)).toEqual(['10100001111', '2417', '1295', '50f']);
    type(radix(), '16');
    expect(message('radix')).toBe('');
    expect(baseField().value).toBe('50f');
    expect(baseField().placeholder).toBe('a');
    expect(screen.getByRole('button', { name: 'Copy base 16' })).toBeTruthy();
    type(field('Decimal'), '30');
    type(radix(), '3');
    expect(baseField().value).toBe('1010');
    expect(baseField().placeholder).toBe('101');
  });

  it('the Base field reads 0x1F at N = 36 as digits (§5 rule 3)', () => {
    render(<NumberBaseTool />);
    type(baseField(), '0x1F');
    expect(field('Decimal').value).toBe('42819');
  });

  it('text handed over by the start page goes into the field of its prefix', () => {
    const { unmount } = render(<NumberBaseTool input="0b1010_1010" />);
    expect(values()).toEqual(['0b1010_1010', '252', '170', 'aa', '4q']);
    unmount();
    render(<NumberBaseTool input="-0x1f" />);
    expect(field('Hexadecimal').value).toBe('-0x1f');
    expect(field('Decimal').value).toBe('-31');
  });

  it('10,000 digits are read; 10,001 are too long', () => {
    render(<NumberBaseTool />);
    type(field('Binary'), '1'.repeat(10_000));
    expect(field('Hexadecimal').value).toBe(`f${'f'.repeat(2499)}`);
    expect(details()['bit-length']).toBe('10000');
    type(field('Binary'), '1'.repeat(10_001));
    expect(message('binary')).toBe('Column 10001: too long: up to 10,000 digits');
  });
});

describe('the Number Bases tool’s history', () => {
  const entries = async (host: ToolHost) =>
    (await host.history.forOwner('number-base', definition.history!).list({ kinds: ['convert'] })).entries;

  it('an edit that reads is a snapshot (change), written when the page is left; it opens back with N and the options', async () => {
    const host = memoryHost();
    const { unmount } = render(<NumberBaseTool host={host} />);
    await twos('16 bits');
    type(radix(), '7');
    type(field('Hexadecimal'), 'ff');
    type(field('Hexadecimal'), 'ffff');
    check('Group digits');
    await act(async () => undefined);
    expect(await entries(host)).toHaveLength(0); // a snapshot waits for 3 s of rest or the page leaving
    unmount();
    let list: Awaited<ReturnType<typeof entries>> = [];
    await waitFor(async () => {
      list = await entries(host);
      expect(list).toHaveLength(1);
    });
    expect(list[0]!.label).toBe("Hexadecimal ffff = -1 · two's complement, 16 bits");

    render(<NumberBaseTool host={host} restore={{ id: list[0]!.id }} />);
    expect(
      await screen.findByText("Opened from History: Hexadecimal ffff = -1 · two's complement, 16 bits."),
    ).toBeTruthy();
    expect(values()).toEqual(['1111 1111 1111 1111', '177 777', '-1', 'ffff', '362031']);
    expect(radix().value).toBe('7');
    expect(screen.getByRole('combobox', { name: 'Width' }).textContent).toBe('16 bits');
    expect(screen.getByRole('checkbox', { name: 'Group digits' }).getAttribute('aria-checked')).toBe('true');
  });

  it('a copy commits at once with the field, the text and the number; an error or an empty field records nothing', async () => {
    const host = memoryHost();
    render(<NumberBaseTool host={host} />);
    type(field('Decimal'), '12.5');
    type(field('Decimal'), '');
    type(baseField(), 'zz');
    fireEvent.click(screen.getByRole('button', { name: 'Copy hexadecimal' }));
    let list: Awaited<ReturnType<typeof entries>> = [];
    await waitFor(async () => {
      list = await entries(host);
      expect(list).toHaveLength(1);
    });
    expect(list[0]!.label).toBe('Base 36 zz = 1295');
    const opened = await host.history.forOwner('number-base', definition.history!).open(list[0]!.id);
    expect(opened.ok && opened.payload).toEqual({
      field: 'base',
      text: 'zz',
      radix: '36',
      negative: 'sign',
      width: 32,
      uppercase: false,
      grouped: false,
      prefixes: false,
      decimal: '1295',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Copy byte length' }));
    await act(async () => undefined);
    expect(await entries(host)).toHaveLength(1); // the same draft again is not a new entry
  });

  it('text handed over by the start page is the first snapshot of the visit', async () => {
    const host = memoryHost();
    const { unmount } = render(<NumberBaseTool host={host} input="0xFF" />);
    unmount();
    await waitFor(async () => expect(await entries(host)).toHaveLength(1));
    expect((await entries(host))[0]!.label).toBe('Hexadecimal 0xFF = 255');
  });

  it('says why an entry cannot be opened; a damaged payload opens with the defaults', async () => {
    render(<NumberBaseTool host={memoryHost()} restore={{ id: 'missing' }} />);
    expect(await screen.findByText('This entry could not be opened.')).toBeTruthy();
    cleanup();
    const host = memoryHost();
    await host.history
      .forOwner('number-base', definition.history!)
      .session()
      .commit({ kind: 'convert', payload: { field: 'nope', text: 7, width: 12 }, label: 'kept' });
    const [entry] = await entries(host);
    render(<NumberBaseTool host={host} restore={{ id: entry!.id }} />);
    expect(await screen.findByText('Opened from History: kept.')).toBeTruthy();
    expect(values()).toEqual(['', '', '', '', '']);
    expect(radix().value).toBe('36');
  });
});

describe('the Number Bases tool’s saved parameters (D21, docs/tools/settings.md)', () => {
  const savedOf = (host: ToolHost) => host.settings!.forTool('number-base').saved();
  const seed = async (host: ToolHost, values: Record<string, unknown>) => {
    host.settings!.forTool('number-base').save(numberBaseSettings.schema, values as never);
    await host.settings!.forTool('number-base').flush();
  };
  const shown = (label: string) => screen.getByRole('combobox', { name: label }).textContent;
  const ticked = (name: string) => screen.getByRole('checkbox', { name }).getAttribute('aria-checked');

  it('saves the options and a valid N the person chose; reopened, it is as left, with every field empty', async () => {
    const host = memoryHost();
    const first = render(<NumberBaseTool host={host} />);
    await twos('16 bits');
    check('Uppercase');
    check('Prefixes');
    type(radix(), '1');
    type(radix(), '12');
    type(field('Decimal'), '255');
    first.unmount();
    expect(savedOf(host)).toEqual({
      schema: 1,
      values: { negative: 'twos', width: 16, uppercase: true, prefixes: true, radix: 12 },
    });

    const second = render(<NumberBaseTool host={host} />);
    expect(values()).toEqual(['', '', '', '', '']);
    expect(shown('Negative numbers')).toBe("Two's complement");
    expect(shown('Width')).toBe('16 bits');
    expect([ticked('Uppercase'), ticked('Group digits'), ticked('Prefixes')]).toEqual(['true', 'false', 'true']);
    expect(radix().value).toBe('12');
    type(field('Decimal'), '-1');
    expect(field('Hexadecimal').value).toBe('0xFFFF');
    // N being typed or out of range is shown, not saved: what was saved stays.
    type(radix(), '');
    type(radix(), '37');
    second.unmount();
    expect(savedOf(host)?.values.radix).toBe(12);
  });

  it('a saved record it cannot show falls back field by field', async () => {
    const host = memoryHost();
    await seed(host, { negative: 'twos', width: 12, uppercase: 'yes', grouped: true, radix: 40 });
    render(<NumberBaseTool host={host} />);
    expect(shown('Negative numbers')).toBe("Two's complement");
    expect(shown('Width')).toBe('32 bits');
    expect([ticked('Uppercase'), ticked('Group digits'), ticked('Prefixes')]).toEqual(['false', 'true', 'false']);
    expect(radix().value).toBe('36');
  });

  it('a handed-over number keeps the saved options; an opened entry shows its own for the visit', async () => {
    const host = memoryHost();
    const kept = { negative: 'twos', width: 8, grouped: true, radix: 7 };
    await seed(host, kept);
    const handed = render(<NumberBaseTool host={host} input="0xff" />);
    expect(field('Hexadecimal').value).toBe('0xff');
    expect(field('Decimal').value).toBe('-1');
    expect(radix().value).toBe('7');
    handed.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: kept });

    await host.history
      .forOwner('number-base', definition.history!)
      .session()
      .commit({
        kind: 'convert',
        label: 'kept entry',
        payload: {
          field: 'decimal',
          text: '255',
          radix: '16',
          negative: 'sign',
          width: 32,
          uppercase: true,
          grouped: false,
          prefixes: false,
          decimal: '255',
        },
      });
    const [entry] = (await host.history.forOwner('number-base', definition.history!).list({ kinds: ['convert'] }))
      .entries;
    const opened = render(<NumberBaseTool host={host} restore={{ id: entry!.id }} />);
    expect(await screen.findByText('Opened from History: kept entry.')).toBeTruthy();
    expect(shown('Negative numbers')).toBe('Minus sign');
    expect([ticked('Uppercase'), ticked('Group digits')]).toEqual(['true', 'false']);
    expect(radix().value).toBe('16');
    expect(field('Hexadecimal').value).toBe('FF');
    opened.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: kept });

    render(<NumberBaseTool host={host} />);
    expect(shown('Negative numbers')).toBe("Two's complement");
    expect(shown('Width')).toBe('8 bits');
    expect(radix().value).toBe('7');
  });

  it('reset puts the options and N back to the defaults and keeps the number; the fields follow', async () => {
    const host = memoryHost();
    await seed(host, { negative: 'twos', width: 8, uppercase: true, radix: 16 });
    const first = render(<NumberBaseTool host={host} />);
    type(field('Hexadecimal'), 'ff');
    expect(field('Decimal').value).toBe('-1');
    await act(async () => host.settings!.forTool('number-base').reset());
    expect(shown('Negative numbers')).toBe('Minus sign');
    expect(ticked('Uppercase')).toBe('false');
    expect(radix().value).toBe('36');
    expect(field('Hexadecimal').value).toBe('ff');
    expect(field('Decimal').value).toBe('255');
    expect(baseField().value).toBe('73');
    expect(savedOf(host)).toBeUndefined();
    first.unmount();

    // A number typed in the Base field keeps its value as N goes back to 36: Decimal becomes the source (§4).
    await seed(host, { radix: 16 });
    render(<NumberBaseTool host={host} />);
    type(baseField(), 'ff');
    await act(async () => host.settings!.forTool('number-base').reset());
    expect(radix().value).toBe('36');
    expect(field('Decimal').value).toBe('255');
    expect(baseField().value).toBe('73');
  });
});
