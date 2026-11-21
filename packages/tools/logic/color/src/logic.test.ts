import { detectColor, MAX_INPUT } from './detect';
import {
  colorName,
  contrast,
  convertColor,
  NOT_A_COLOUR,
  parseColor,
  pickerValue,
  roundTo,
  to8bit,
  UNSUPPORTED,
} from './logic';
import { isColorFunction } from './syntax';
import { describe, expect, it } from 'vitest';
import type { Color, Formats } from './logic';

const color = (input: string): Color => {
  const parsed = parseColor(input);
  if (!parsed.ok) throw new Error(`${input}: ${'message' in parsed ? parsed.message : 'empty'}`);
  return parsed.color;
};
const formats = (input: string): Formats => convertColor(color(input));
const nameOf = (input: string): string => {
  const n = colorName(color(input));
  return 'exact' in n ? n.exact.join(' / ') : `≈ ${n.nearest} (ΔE ${n.distance})`;
};
const pair = (fg: string, bg: string) => contrast(color(fg), color(bg));
const message = (input: string): string | undefined => {
  const parsed = parseColor(input);
  return !parsed.ok && 'message' in parsed ? parsed.message : undefined;
};

// docs/tools/specs/color.md §10, row by row (the row's first input in the test's name).
describe('§10: conversions', () => {
  it.each(['#ff8800', 'ff8800', 'rgb(255, 136, 0)', 'hsl(32deg, 100%, 50%)', 'hwb(32 0% 0%)'])(
    '%s → every format of #ff8800',
    input => {
      expect(formats(input)).toMatchObject({
        hex: '#ff8800',
        rgb: 'rgb(255 136 0)',
        hsl: 'hsl(32 100% 50%)',
        hwb: 'hwb(32 0% 0%)',
        lab: 'lab(69.4 41.7 75.66)',
        lch: 'lch(69.4 86.39 61.14)',
        oklab: 'oklab(74.42% 0.1001 0.151)',
        oklch: 'oklch(74.42% 0.1812 56.46)',
        p3: 'color(display-p3 0.9387 0.5575 0.2057)',
        inSrgb: true,
        inP3: true,
        clippedHex: null,
      });
    },
  );

  it('ff8800 says how it was read', () => {
    expect(parseColor('ff8800')).toMatchObject({ ok: true, note: 'Read as #ff8800' });
    expect(parseColor('#ff8800')).not.toHaveProperty('note');
  });

  it.each(['#ff0000', 'red', 'RED'])('%s → red', input => {
    expect(formats(input)).toMatchObject({
      hex: '#ff0000',
      hsl: 'hsl(0 100% 50%)',
      hwb: 'hwb(0 0% 0%)',
      lab: 'lab(54.29 80.8 69.89)',
      lch: 'lch(54.29 106.84 40.86)',
      oklch: 'oklch(62.8% 0.2577 29.23)',
      p3: 'color(display-p3 0.9175 0.2003 0.1386)',
    });
  });

  it('#ff880080: alpha in hex, three digits elsewhere', () => {
    expect(formats('#ff880080')).toMatchObject({
      hex: '#ff880080',
      rgb: 'rgb(255 136 0 / 0.502)',
      oklch: 'oklch(74.42% 0.1812 56.46 / 0.502)',
    });
  });

  it.each(['rgb(255 136 0 / 50%)', 'rgba(255,136,0,.5)'])('%s → half transparent', input => {
    expect(formats(input)).toMatchObject({ hex: '#ff880080', rgb: 'rgb(255 136 0 / 0.5)' });
  });

  it('#ff00: transparent yellow', () => {
    expect(formats('#ff00')).toMatchObject({ hex: '#ffff0000', rgb: 'rgb(255 255 0 / 0)' });
  });

  it('rgb(127.5 0 0) → 128, half up as in Chrome', () => {
    expect(formats('rgb(127.5 0 0)')).toMatchObject({ hex: '#800000', rgb: 'rgb(128 0 0)' });
  });

  it('rgb(50% 25% 0%)', () => {
    expect(formats('rgb(50% 25% 0%)')).toMatchObject({ hex: '#804000', hsl: 'hsl(30 100% 25%)' });
  });

  it('rgb(300 -5 0) is clamped', () => {
    expect(formats('rgb(300 -5 0)')).toMatchObject({ hex: '#ff0000', inSrgb: true });
  });

  it('rgb(none 0 0): none is 0', () => {
    expect(formats('rgb(none 0 0)').hex).toBe('#000000');
  });

  it('hsl(30 150% 50%) / hsl(-30 100% 50%) — corrected 2026-11-21: the modern syntax keeps 150 % (§15)', () => {
    // CSS Color 4 §7 and Chrome 159 (color(from hsl(30 150% 50%) srgb r g b) = 1.25 0.5 -0.25): outside sRGB,
    // mapped; Chrome paints it clipped, #ff8000. The legacy comma syntax clamps to 100 %, as Chrome does.
    expect(formats('hsl(30 150% 50%)')).toMatchObject({ inSrgb: false, hex: '#ffa872', clippedHex: '#ff8000' });
    expect(formats('hsl(30, 150%, 50%)')).toMatchObject({ inSrgb: true, hex: '#ff8000', hsl: 'hsl(30 100% 50%)' });
    expect(formats('hsl(-30 100% 50%)')).toMatchObject({ hex: '#ff0080', hsl: 'hsl(330 100% 50%)' });
  });

  it('hsla(0.5turn 50% 50% / 0.25)', () => {
    expect(formats('hsla(0.5turn 50% 50% / 0.25)')).toMatchObject({
      hex: '#40bfbf40',
      hsl: 'hsl(180 50% 50% / 0.25)',
      hwb: 'hwb(180 25% 25% / 0.25)',
    });
  });

  it('hsl(none 0% 50%) / hwb(30 60% 60%)', () => {
    expect(formats('hsl(none 0% 50%)')).toMatchObject({ hex: '#808080', hsl: 'hsl(0 0% 50%)' });
    expect(formats('hwb(30 60% 60%)')).toMatchObject({ hex: '#808080', hsl: 'hsl(0 0% 50%)', hwb: 'hwb(0 50% 50%)' });
  });

  it('lab(50 40 59.5)', () => {
    expect(formats('lab(50 40 59.5)')).toMatchObject({
      inSrgb: true,
      hex: '#bf5700',
      hsl: 'hsl(27.4 100% 37.4%)',
      lch: 'lch(50 71.7 56.09)',
      oklch: 'oklch(57.77% 0.1543 49.29)',
    });
  });

  it('lab(150 0 0): L clamped, white without a meaningless hue', () => {
    expect(formats('lab(150 0 0)')).toMatchObject({ lab: 'lab(100 0 0)', hex: '#ffffff', hsl: 'hsl(0 0% 100%)' });
  });

  it('lch(52.2345% 72.2 56.2)', () => {
    expect(formats('lch(52.2345% 72.2 56.2)')).toMatchObject({ hex: '#c65d06', lch: 'lch(52.23 72.2 56.2)' });
  });

  it('lch(50% 150 30): outside both gamuts', () => {
    expect(formats('lch(50% 150 30)')).toMatchObject({
      inSrgb: false,
      inP3: false,
      hex: '#f80047',
      clippedHex: '#ff0011',
      lab: 'lab(50 129.9 75)',
    });
  });

  it('oklab(0.5 0.1 -0.1)', () => {
    expect(formats('oklab(0.5 0.1 -0.1)')).toMatchObject({ hex: '#81459a', oklch: 'oklch(50% 0.1414 315)' });
  });

  it('oklch(62.8% 0.2577 29.23): in sRGB by the tolerance, hue 0 not 360', () => {
    expect(formats('oklch(62.8% 0.2577 29.23)')).toMatchObject({
      inSrgb: true,
      clippedHex: null,
      hex: '#ff0000',
      hsl: 'hsl(0 100% 50%)',
    });
  });

  it('oklch(70% 0.4 150): outside both, mapped by CSS Color 4 §13.2, clipped as browsers do', () => {
    expect(formats('oklch(70% 0.4 150)')).toMatchObject({
      inSrgb: false,
      inP3: false,
      hex: '#00c248',
      rgb: 'rgb(0 194 72)',
      hsl: 'hsl(142.1 100% 38%)',
      clippedHex: '#00d600',
      p3: 'color(display-p3 0 0.7825 0.1942)',
      swatch: 'oklch(0.7 0.4 150)',
    });
  });

  it('oklch(50% -0.1 150): chroma clamped', () => {
    expect(formats('oklch(50% -0.1 150)')).toMatchObject({ hex: '#636363', oklch: 'oklch(50% 0 0)' });
  });

  it('oklch(120% 0.1 150): L clamped to 100%, white, outside the gamut', () => {
    expect(formats('oklch(120% 0.1 150)')).toMatchObject({
      oklch: 'oklch(100% 0.1 150)',
      hex: '#ffffff',
      inSrgb: false,
      clippedHex: '#cfffdc',
    });
  });

  it('oklch(70% 0.1 none): a hue of none is 0', () => {
    expect(formats('oklch(70% 0.1 none)')).toMatchObject({ hex: '#d2849c', oklch: 'oklch(70% 0.1 0)' });
  });

  it('color(display-p3 0 1 0): outside sRGB, inside P3', () => {
    expect(formats('color(display-p3 0 1 0)')).toMatchObject({
      inSrgb: false,
      inP3: true,
      hex: '#00fb29',
      clippedHex: '#00ff00',
      p3: 'color(display-p3 0 1 0)',
    });
  });

  it('color(srgb 1 0.5 0) / color(srgb 1.2 0 0): no clamping inside color()', () => {
    expect(formats('color(srgb 1 0.5 0)').hex).toBe('#ff8000');
    expect(formats('color(srgb 1.2 0 0)')).toMatchObject({ inSrgb: false, hex: '#ff6956', clippedHex: '#ff0000' });
  });

  it('color(rec2020 1 0 0)', () => {
    expect(formats('color(rec2020 1 0 0)')).toMatchObject({ hex: '#ff494f', clippedHex: '#ff0000' });
  });

  it('color(xyz-d65 0.5 0.5 0.5)', () => {
    expect(formats('color(xyz-d65 0.5 0.5 0.5)').hex).toBe('#ccb7b4');
  });

  it.each(['#808080', 'grey'])('%s → gray', input => {
    expect(formats(input)).toMatchObject({ hsl: 'hsl(0 0% 50.2%)', oklch: 'oklch(59.99% 0 0)' });
    expect(nameOf(input)).toBe('gray / grey');
  });

  it('white / black / transparent', () => {
    expect(formats('white').hsl).toBe('hsl(0 0% 100%)');
    expect(formats('black').hwb).toBe('hwb(0 0% 100%)');
    expect(formats('transparent')).toMatchObject({ hex: '#00000000', rgb: 'rgb(0 0 0 / 0)' });
    expect(nameOf('transparent')).toBe('transparent');
  });
});

describe('§10: names', () => {
  it('exact names, every one of the value, by alphabet', () => {
    expect(nameOf('#663399')).toBe('rebeccapurple');
    expect(nameOf('#00ffff')).toBe('aqua / cyan');
  });

  it('the nearest name with its distance', () => {
    expect(nameOf('#123456')).toBe('≈ midnightblue (ΔE 0.087)');
    expect(nameOf('#7f7f7f')).toBe('≈ gray (ΔE 0.003)');
    expect(nameOf('#ff0001')).toBe('≈ red (ΔE 0)');
  });

  it('a translucent colour and a mapped one are named by their 8-bit sRGB', () => {
    expect(nameOf('#ff880080')).toBe('≈ darkorange (ΔE 0.009)');
    expect(nameOf('oklch(70% 0.4 150)')).toBe('≈ limegreen (ΔE 0.041)');
  });

  it('transparent only for #00000000; another fully transparent colour is the nearest of its value', () => {
    expect(nameOf('#00000000')).toBe('transparent');
    expect(nameOf('#ff00')).toBe('≈ yellow (ΔE 0)');
    expect(nameOf('#ff000080')).toBe('≈ red (ΔE 0)');
  });
});

describe('§10: contrast (WCAG 2.2)', () => {
  it('#000000 on #ffffff: 21.00:1, all five pass', () => {
    expect(pair('#000000', '#ffffff')).toMatchObject({
      shown: '21.00:1',
      aaNormal: true,
      aaLarge: true,
      aaaNormal: true,
      aaaLarge: true,
      nonText: true,
    });
  });

  it('#777777 on #ffffff: 4.47:1 (4.478), AA normal fails', () => {
    const c = pair('#777777', '#ffffff');
    expect(c.ratio).toBeCloseTo(4.478, 3);
    expect(c).toMatchObject({ shown: '4.47:1', aaNormal: false, aaLarge: true, nonText: true });
  });

  it('#767676 on #ffffff: 4.54:1, the lightest grey passing AA', () => {
    expect(pair('#767676', '#ffffff')).toMatchObject({
      shown: '4.54:1',
      aaNormal: true,
      aaaLarge: true,
      aaaNormal: false,
    });
  });

  it('#595959 on #ffffff: 7.00:1 (7.0047), AAA normal', () => {
    const c = pair('#595959', '#ffffff');
    expect(c.ratio).toBeCloseTo(7.0047, 4);
    expect(c).toMatchObject({ shown: '7.00:1', aaaNormal: true });
  });

  it('#ff0000 on #ffffff: 3.99:1 (3.9985, floored, not 4.00)', () => {
    const c = pair('#ff0000', '#ffffff');
    expect(c.ratio).toBeCloseTo(3.9985, 4);
    expect(c).toMatchObject({ shown: '3.99:1', aaLarge: true, aaNormal: false });
  });

  it('#0000ff on #ffff00: 8.00:1', () => {
    expect(pair('#0000ff', '#ffff00').shown).toBe('8.00:1');
  });

  it('#949494 on #ffffff: 3.03:1, UI components pass', () => {
    expect(pair('#949494', '#ffffff')).toMatchObject({ shown: '3.03:1', nonText: true });
  });

  it('#ffffff on #ffffff: 1.00:1, all fail', () => {
    expect(pair('#ffffff', '#ffffff')).toMatchObject({
      shown: '1.00:1',
      aaNormal: false,
      aaLarge: false,
      aaaNormal: false,
      aaaLarge: false,
      nonText: false,
    });
  });

  it('#00000080 on #ffffff: blended #7f7f7f, 4.00:1 (4.0041)', () => {
    const c = pair('#00000080', '#ffffff');
    expect(c.ratio).toBeCloseTo(4.0041, 4);
    expect(c).toMatchObject({ shown: '4.00:1', foreground: '#7f7f7f', foregroundBlended: true });
  });

  it('#000000 on #ffffff80: the background over white', () => {
    expect(pair('#000000', '#ffffff80')).toMatchObject({
      shown: '21.00:1',
      background: '#ffffff',
      backgroundBlended: true,
      foregroundBlended: false,
    });
  });

  it('oklch(70% 0.4 150) on black: by its mapped #00c248, 8.81:1', () => {
    expect(pair('oklch(70% 0.4 150)', 'black')).toMatchObject({ shown: '8.81:1', foreground: '#00c248' });
  });

  it('#ff8800 on #1e1e1e: 6.96:1, AAA normal fails', () => {
    expect(pair('#ff8800', '#1e1e1e')).toMatchObject({ shown: '6.96:1', aaaNormal: false, aaNormal: true });
  });

  it('the ratio is the same either way round, and a check never rounds up to its threshold', () => {
    expect(pair('#ffffff', '#767676').ratio).toBe(pair('#767676', '#ffffff').ratio);
    // 4.4999… shows 4.49 and fails 4.5: #777777 is 4.478; the nearest grey above it passes.
    expect(pair('#777777', '#ffffff').aaNormal).toBe(false);
  });

  it('a translucent text goes over the background after the background went over white', () => {
    // #ff000080 over #00000080-over-white (#7f7f7f): round(255·a + 127·(1−a)), round(127·(1−a)).
    expect(pair('#ff000080', '#00000080')).toMatchObject({ background: '#7f7f7f', foreground: '#bf3f3f' });
  });
});

describe('§10 and §6: errors', () => {
  it.each(['#ggg', 'rgb(1 2)', 'rgb(1, 2 3)', 'reddish', '12345', '🙂'])('%s is not a colour', input => {
    expect(message(input)).toBe(NOT_A_COLOUR);
    expect(NOT_A_COLOUR).toBe('Not a CSS colour. Try #ff8800, rgb(255 136 0), hsl(32 100% 50%) or oklch(74% 0.18 56).');
  });

  it('page-dependent keywords, the word as typed', () => {
    expect(message('currentcolor')).toBe('currentcolor depends on the page; enter a concrete colour.');
    expect(message('currentColor')).toBe('currentColor depends on the page; enter a concrete colour.');
    for (const word of ['inherit', 'initial', 'unset', 'revert'])
      expect(message(word)).toBe(`${word} depends on the page; enter a concrete colour.`);
  });

  it.each(['color-mix(in srgb, red, blue)', 'rgb(from red r g b)', 'light-dark(white, black)', 'device-cmyk(0 0 0 1)'])(
    '%s is not supported',
    input => {
      expect(message(input)).toBe(UNSUPPORTED);
      expect(UNSUPPORTED).toBe('Relative colours, color-mix(), light-dark() and device-cmyk() are not supported.');
    },
  );

  it('empty and blank are the empty state, not an error', () => {
    expect(parseColor('')).toEqual({ ok: false, empty: true });
    expect(parseColor('   ')).toEqual({ ok: false, empty: true });
  });

  it('longer than 200 characters', () => {
    expect(message(`#${'f'.repeat(MAX_INPUT)}`)).toBe('The colour is longer than 200 characters.');
    expect(parseColor(`  ${'red'}${' '.repeat(300)}`).ok).toBe(true);
  });
});

describe('§6: edges', () => {
  it('f80 and ff8800 are read as hex, with the note', () => {
    expect(parseColor('f80')).toMatchObject({ ok: true, note: 'Read as #f80' });
    expect(formats('f80').hex).toBe('#ff8800');
    expect(parseColor('FF8800')).toMatchObject({ ok: true, note: 'Read as #ff8800' });
  });

  it('case and edges do not matter', () => {
    expect(formats('RED').hex).toBe('#ff0000');
    expect(formats('  #663399  ').hex).toBe('#663399');
    expect(formats('OKLCH(70% 0.1 NONE)').hex).toBe('#d2849c');
    expect(formats('Color(Display-P3 0 1 0)').hex).toBe('#00fb29');
  });

  it('hwb(30 60% 60%) is grey', () => {
    expect(formats('hwb(30 60% 60%)')).toMatchObject({ hex: '#808080', hsl: 'hsl(0 0% 50%)' });
  });
});

describe('§5: what §10 leaves out', () => {
  it('reads every notation of CSS Color 4 §5.1', () => {
    for (const input of [
      '#f80',
      '#f808',
      '#ff8800',
      '#ff880088',
      'rgb(255 136 0)',
      'rgba(255 136 0 / 0.5)',
      'rgb(255, 136, 0)',
      'rgba(255, 136, 0, 50%)',
      'rgb(100% 53.3% 0%)',
      'rgb(255 53.3% 0)',
      'hsl(32 100% 50%)',
      'hsl(32 100 50)',
      'hsla(32, 100%, 50%, 0.5)',
      'hsl(0.0889turn 100% 50%)',
      'hsl(0.5585rad 100% 50%)',
      'hsl(35.6grad 100% 50%)',
      'hwb(32 0% 0% / 1)',
      'lab(69.4% 41.7 75.66)',
      'lab(69.4 33.36% 60.53%)',
      'lch(69.4 86.39 61.14deg)',
      'oklab(74.42% 0.1001 0.151)',
      'oklab(0.7442 25% 37.75%)',
      'oklch(0.7442 0.1812 56.46)',
      'oklch(74.42% 45.3% 1.0rad)',
      'color(srgb 1 0.533 0)',
      'color(srgb-linear 1 0.246 0)',
      'color(display-p3 0.9387 0.5575 0.2057)',
      'color(a98-rgb 0.9 0.5 0.1)',
      'color(prophoto-rgb 0.8 0.6 0.2)',
      'color(rec2020 0.8 0.5 0.1)',
      'color(xyz 0.5 0.4 0.1)',
      'color(xyz-d50 0.5 0.4 0.1)',
      'color(xyz-d65 0.5 0.4 0.1 / 50%)',
      'color(srgb 100% 50% 0%)',
      'rgb(none none none / none)',
      'rebeccapurple',
      'transparent',
      '1e2',
    ])
      expect(parseColor(input).ok, input).toBe(true);
  });

  it('148 names', () => {
    for (const [input, hex] of [
      ['aliceblue', '#f0f8ff'],
      ['yellowgreen', '#9acd32'],
      ['darkslategrey', '#2f4f4f'],
    ] as const)
      expect(formats(input).hex).toBe(hex);
  });

  it('alpha none paints as 0, alpha is clamped', () => {
    expect(formats('rgb(255 0 0 / none)').hex).toBe('#ff000000');
    expect(formats('rgb(255 0 0 / 150%)').hex).toBe('#ff0000');
    expect(formats('rgb(255 0 0 / -1)').hex).toBe('#ff000000');
  });

  it('a percentage alpha is written as a number with three digits', () => {
    expect(formats('rgb(255 0 0 / 33.33%)').rgb).toBe('rgb(255 0 0 / 0.333)');
  });

  it('hwb whiteness and blackness clamped to 0–100% (Chrome 159); hsl clamped at 0, above 100% only in legacy syntax', () => {
    expect(formats('hwb(0 -20% 120%)').hex).toBe('#000000');
    expect(formats('hwb(30 -20% 50%)').hex).toBe('#804000');
    expect(formats('hsl(0 100% 150%)')).toMatchObject({ hex: '#ffffff', inSrgb: false });
    expect(formats('hsl(0, 100%, 150%)')).toMatchObject({ hex: '#ffffff', inSrgb: true });
    expect(formats('hsl(0 -50% 50%)').hex).toBe('#808080');
    expect(formats('hsl(30 100% -10%)').hex).toBe('#000000');
    expect(formats('hsl(120 150% 25%)')).toMatchObject({ inSrgb: false, inP3: true, hex: '#009f00' });
  });

  it('a hue of 359.99 rounds to 0, never 360; a hue that means nothing is 0', () => {
    expect(formats('hsl(359.99 100% 50%)').hsl).toBe('hsl(0 100% 50%)');
    expect(formats('lch(50 0 120)').lch).toBe('lch(50 0 0)');
    expect(formats('oklch(50% 0 120)').oklch).toBe('oklch(50% 0 0)');
    expect(formats('hsl(120 0% 40%)').hsl).toBe('hsl(0 0% 40%)');
    expect(formats('black').hsl).toBe('hsl(0 0% 0%)');
  });

  it('rejects what CSS rejects, more strictly than the colour library', () => {
    for (const input of [
      'rgb(255 136 0',
      'rgb (255 136 0)',
      'rgb(255 136 0 0.5)',
      'rgb(255 / 136 0)',
      'rgb(255, 136, 0 / 0.5)',
      'rgb(255, 50%, 0)',
      'rgb(none, 0, 0)',
      'rgb(1deg 2 3)',
      'hsl(50% 100% 50%)',
      'hsl(30, 100, 50)',
      'hwb(30, 0%, 0%)',
      'lch(50 30deg 30)',
      'oklch(50% 0.1deg 30)',
      'lab(50 40 59.5 / 10deg)',
      'color(display-p3 1deg 0 0)',
      'color(unknown 1 0 0)',
      'color(display-p3 1 0)',
      'color(1 0 0)',
      'rgb(calc(1) 2 3)',
      'rgb(1 2 3))',
      'rgb(1em 2 3)',
      '#12345',
      '#',
      'red blue',
      'canvas',
      'url(x)',
    ])
      expect(message(input), input).toBe(NOT_A_COLOUR);
  });

  it('a colour inside sRGB within half an 8-bit step is in sRGB; beyond that it is mapped', () => {
    expect(formats('color(srgb 1.0019 0 0)')).toMatchObject({ inSrgb: true, hex: '#ff0000' });
    expect(formats('color(srgb 1.0021 0 0)')).toMatchObject({ inSrgb: false, clippedHex: '#ff0000' });
  });

  it('the gamut line names Display P3: outside sRGB but inside P3', () => {
    expect(formats('color(display-p3 1 0 0)')).toMatchObject({ inSrgb: false, inP3: true });
    expect(formats('color(rec2020 0 1 0)')).toMatchObject({ inSrgb: false, inP3: false });
  });

  it('the swatch keeps the colour as written at six digits, with alpha', () => {
    expect(formats('oklch(70% 0.4 150 / 0.5)').swatch).toBe('oklch(0.7 0.4 150 / 0.5)');
    expect(formats('#ff8800').swatch).toBe('oklch(0.744202 0.181171 56.458455)');
    expect(formats('#808080').swatch).toBe('oklch(0.599871 0 0)');
  });

  it('the picker gets the hex without alpha', () => {
    expect(pickerValue(color('#ff880080'))).toBe('#ff8800');
    expect(pickerValue(color('oklch(70% 0.4 150)'))).toBe('#00c248');
  });

  it('matches the worked example of CSS Color 4 (#7654CD in Lab and LCH)', () => {
    // CSS Color 4, the sample conversion of sRGB #7654CD: lab(44.36% 36.05 -58.99), lch(44.36% 69.13 301.43).
    expect(formats('#7654CD')).toMatchObject({ lab: 'lab(44.36 36.05 -58.99)', lch: 'lch(44.36 69.13 301.43)' });
    expect(formats('rgb(46.27% 32.94% 80.39%)').hex).toBe('#7654cd');
  });
});

describe('§5.2: rounding', () => {
  it('half away from zero, -0 is 0', () => {
    expect(roundTo(2.5, 0)).toBe(3);
    expect(roundTo(-2.5, 0)).toBe(-3);
    expect(roundTo(-0.00001, 2)).toBe(0);
    expect(Object.is(roundTo(-0.00001, 2), -0)).toBe(false);
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(0.1001234, 4)).toBe(0.1001);
  });

  it('8 bit: noise off at 6 decimals, then half up', () => {
    expect(to8bit(0.5)).toBe(128);
    expect(to8bit(127 / 255)).toBe(127);
    expect(to8bit(1.2)).toBe(255);
    expect(to8bit(-0.1)).toBe(0);
  });
});

describe('§7: detectColor', () => {
  it.each(['#ff8800', '#F80', '#ff880080', 'rgb(255 136 0)', 'oklch(70% 0.4 150)', 'color(display-p3 0 1 0)'])(
    '%s → yes',
    text => expect(detectColor(text)).toBe(true),
  );

  it.each([
    'red',
    'ff8800',
    '#ggg',
    'rgb(1 2)',
    'deadbeef',
    '#1',
    '0 9 * * 1-5',
    '1700000000',
    // Other tools' inputs: hex strings, numbers in bases, identifiers, an issue reference, a fragment, a word.
    'ff',
    '0xff8800',
    'abc',
    '#abcde',
    '#12',
    '#readme',
    'fix #123 and #456',
    'https://example.com/#abc',
    'rgb',
    'rgb(',
    'color: red',
    '{"color": "#ff8800"}',
    'background: #fff',
    'transparent',
    'currentcolor',
    'color-mix(in srgb, red, blue)',
    'rgb(from red r g b)',
    '',
  ])('%s → no', text => expect(detectColor(text)).toBe(false));

  it('#abc — also a fragment, an issue reference and a hex string — is a colour by §7 rule 1', () => {
    expect(detectColor('#abc')).toBe(true);
    expect(detectColor('  #abc\n')).toBe(true);
  });

  it('agrees with parseColor on everything it recognises, and on every function form', () => {
    const samples = [
      'rgb(255 136 0)',
      'rgba(255,136,0,.5)',
      'hsl(32deg, 100%, 50%)',
      'hsl(30, 100, 50)',
      'lch(50 30deg 30)',
      'rgb(1, 2 3)',
      'color(xyz 1 1 1)',
      'color(display-p3 0 1)',
      'hwb(1turn 0% 0% / none)',
      'oklab(1 2 3 / 4)',
      'lab(1e2 1e-2 -1E2)',
      'rgb(+1 -.5 2.)',
      'rgb(1 2 3) ',
      'HSL(1 2% 3%)',
    ];
    for (const s of samples) {
      const parsed = parseColor(s).ok;
      expect(detectColor(s), s).toBe(parsed);
    }
  });

  it('agrees with parseColor over generated function forms: what the syntax accepts, the library reads', () => {
    const parts = ['1', '-.5', '50%', '30deg', '0.5turn', 'none', '/', ',', 'srgb', 'display-p3', 'x'];
    const names = ['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color'];
    let accepted = 0;
    let seed = 7;
    const next = (n: number) => Math.floor(((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * n);
    for (let k = 0; k < 20_000; k++) {
      const args = Array.from({ length: 3 + next(3) }, () => parts[next(parts.length)]);
      const text = `${names[next(names.length)]}(${args.join(next(8) ? ' ' : '')})`;
      const parsed = parseColor(text).ok;
      expect(detectColor(text), text).toBe(parsed);
      expect(isColorFunction(text), text).toBe(parsed);
      if (parsed) accepted++;
    }
    expect(accepted).toBeGreaterThan(100);
  });

  it('stays linear on long input', () => {
    const long = `rgb(${'1 '.repeat(150_000)})`;
    const t = performance.now();
    expect(detectColor(long)).toBe(false);
    expect(parseColor(long).ok).toBe(false);
    expect(isColorFunction(long.toLowerCase())).toBe(false);
    expect(detectColor(`#${'f'.repeat(1_000_000)}`)).toBe(false);
    expect(performance.now() - t).toBeLessThan(500);
  });
});
