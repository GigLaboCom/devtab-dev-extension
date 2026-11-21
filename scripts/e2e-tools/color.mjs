// The Color tool in the built extension (docs/tools/specs/color.md): its scenarios (§2) with the page's real controls,
// and what only the browser can tell — run by scripts/e2e-tools.mjs. Names: 'Color: …'; screenshots tool-color-NN-….
//
// - The swatch under the extension's content security policy (§5.7): the colour is an SVG `fill` attribute; the check
//   reads its computed colour, the pixels of a screenshot of it, and listens for `securitypolicyviolation`.
// - The conversions against Chrome's own (§5.2–§5.4): in a blank page, Chrome converts every input with the relative
//   colour syntax (`lab(from <input> l a b)`, …) and paints it on a canvas; the tool's values must agree within the
//   tolerances of `tolerance` below, its in-gamut HEX with Chrome's pixel within 1 of 255, its "Browsers clip it" HEX
//   with what Chrome paints for a colour outside sRGB; and every format the tool writes, painted by Chrome, gives its HEX.
// Everything stubbed in the page (the clipboard, EyeDropper, the CSP listener) is put back before the module ends.

/* global document, window, getComputedStyle, OffscreenCanvas, createImageBitmap, CSS, location, DataTransfer,
   ClipboardEvent -- page.evaluate callbacks run in the pages */

import { inDarkTheme, settledShot, stubClipboard, waitForHistoryRecord } from '../e2e-helpers.mjs';

const KEYS = ['hex', 'rgb', 'hsl', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'p3', 'name'];

/** The inputs of §10 (and a few more) held against Chrome. */
const INPUTS = [
  '#ff8800',
  'rgb(255, 136, 0)',
  'hsl(32deg, 100%, 50%)',
  'hwb(32 0% 0%)',
  '#ff0000',
  'RED',
  'rgb(127.5 0 0)',
  'rgb(50% 25% 0%)',
  'rgb(300 -5 0)',
  'rgb(none 0 0)',
  'hsl(30 150% 50%)',
  'hsl(-30 100% 50%)',
  'hsl(0.5turn 50% 50%)',
  'hsl(none 0% 50%)',
  'hwb(30 60% 60%)',
  'lab(50 40 59.5)',
  'lab(150 0 0)',
  'lch(52.2345% 72.2 56.2)',
  'lch(50% 150 30)',
  'oklab(0.5 0.1 -0.1)',
  'oklch(62.8% 0.2577 29.23)',
  'oklch(70% 0.4 150)',
  'oklch(50% -0.1 150)',
  'oklch(120% 0.1 150)',
  'oklch(70% 0.1 none)',
  'color(display-p3 0 1 0)',
  'color(srgb 1 0.5 0)',
  'color(srgb 1.2 0 0)',
  'color(rec2020 1 0 0)',
  'color(xyz-d65 0.5 0.5 0.5)',
  'color(a98-rgb 0.9 0.5 0.1)',
  'color(prophoto-rgb 0.8 0.6 0.2)',
  'color(srgb-linear 1 0.246 0)',
  'color(xyz-d50 0.5 0.4 0.1)',
  '#808080',
  'grey',
  'white',
  'black',
  'rebeccapurple',
  '#7654cd',
  '#123456',
];

/** Digits each notation shows, per component (§5.2): a difference of one unit there is the tolerance. */
/**
 * How far the tool may be from Chrome, per notation and component. One unit of the last digit shown, except where
 * Chrome itself is not CSS Color 4's sample code (the tool is: packages/tools/logic/color/src/cssColor4.test.ts):
 * Chrome's CIE Lab a/b and LCH chroma are up to ~0.02 off the sample code (its D50 white), so 0.03 there, and the LCH
 * hue as much as that error turns it; a98-rgb and prophoto into Display P3 2 units of the 4th digit.
 */
const deg = rad => (rad * 180) / Math.PI;
const tolerance = (kind, k, mine) => {
  if (kind === 'lab') return k === 0 ? 0.01 : 0.03;
  if (kind === 'lch') return k === 0 ? 0.01 : k === 1 ? 0.03 : 0.01 + deg(Math.atan(0.03 / mine[1]));
  if (kind === 'oklab') return k === 0 ? 0.01 : 0.0001;
  if (kind === 'oklch') return k === 0 ? 0.01 : k === 1 ? 0.0001 : 0.01 + deg(Math.atan(0.0001 / mine[1]));
  return 0.0002;
};

const numbers = text =>
  text === null || text === undefined
    ? null
    : [...String(text).matchAll(/(-?[\d.]+(?:e-?\d+)?%?|none)/g)].map(m => m[1]).filter(s => s !== '');
/** The three components of a serialised colour as numbers; percentages of OKLab/OKLCH lightness as 0–1. */
const components = (text, kind) => {
  const parts = numbers(String(text).replace(/^color\(\s*display-p3/, 'color('));
  if (!parts) return null;
  return parts.slice(0, 3).map((p, i) => {
    if (p === 'none') return 0;
    const v = parseFloat(p);
    return p.endsWith('%') && (kind === 'oklab' || kind === 'oklch') && i === 0 ? v / 100 : v;
  });
};
const bytes = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const far = (a, b) => Math.max(...a.slice(0, 3).map((v, i) => Math.abs(v - b[i])));

export default async ({ ctx, base, check, shoot, sleep }) => {
  const T = 'Color';
  const tool = `${base}#/tools/color`;
  // A tab of its own: the module visits many places, and later modules count the entries of the main tab's history
  // (Chrome keeps no more than 50). Its console is watched here, as the run watches the main page's.
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('console', m => {
    if (m.type() === 'error') pageErrors.push(m.text());
  });
  page.on('pageerror', e => pageErrors.push(String(e)));
  const oracle = await ctx.newPage(); // about:blank: Chrome as the reference, and the PNG decoder
  let clipboard = null;
  let tab = null;

  const field = page.locator('#color-input');
  const background = page.locator('#color-background');
  const table = () =>
    page.evaluate(
      keys =>
        Object.fromEntries(
          keys.map(k => [k, document.querySelector(`[data-format="${k}"]`)?.childNodes[0]?.textContent ?? '']),
        ),
      KEYS,
    );
  const text = selector => page.locator(selector).first().innerText();
  /** RGB of points (fractions of the image) in a PNG, decoded by the browser in the blank page. */
  const pixels = (png, points) =>
    oracle.evaluate(
      async ([b64, pts]) => {
        const data = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        const bmp = await createImageBitmap(new Blob([data], { type: 'image/png' }));
        const canvas = new OffscreenCanvas(bmp.width, bmp.height);
        const g = canvas.getContext('2d');
        g.drawImage(bmp, 0, 0);
        return pts.map(([fx, fy]) => [
          ...g.getImageData(Math.floor(fx * bmp.width), Math.floor(fy * bmp.height), 1, 1).data,
        ]);
      },
      [png.toString('base64'), points],
    );
  /** What Chrome paints for CSS colours on an sRGB canvas, and what it computes for each in the given spaces. */
  const chrome = list =>
    oracle.evaluate(values => {
      const el = document.createElement('div');
      document.body.append(el);
      const g = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true });
      const computed = v => {
        el.style.color = '';
        el.style.color = v;
        return el.style.color === '' ? null : getComputedStyle(el).color;
      };
      const paint = v => {
        g.clearRect(0, 0, 1, 1);
        g.fillStyle = '#123456';
        g.fillStyle = v;
        g.fillRect(0, 0, 1, 1);
        return [...g.getImageData(0, 0, 1, 1).data];
      };
      const out = values.map(v => ({
        input: v,
        valid: CSS.supports('color', v),
        computed: computed(v),
        pixel: paint(v),
        lab: computed(`lab(from ${v} l a b)`),
        lch: computed(`lch(from ${v} l c h)`),
        oklab: computed(`oklab(from ${v} l a b)`),
        oklch: computed(`oklch(from ${v} l c h)`),
        p3: computed(`color(from ${v} display-p3 r g b)`),
      }));
      el.remove();
      return out;
    }, list);

  try {
    await page.goto(tool);
    await field.waitFor();
    // Every CSP violation of the page from here on (the swatches included), until the end of the module.
    await page.evaluate(() => {
      const seen = [];
      const listen = e => seen.push(`${e.violatedDirective} ${e.blockedURI} ${e.sample ?? ''}`);
      document.addEventListener('securitypolicyviolation', listen);
      document.documentElement.__colorCsp = { seen, listen };
    });

    // ---- §8: the empty state ----
    const empty = {
      color: await field.inputValue(),
      background: await background.inputValue(),
      fills: await page.locator('[data-swatch] [data-fill]').count(),
      contrast: await page.locator('[data-contrast]').count(),
      dropper: await page.getByRole('button', { name: 'Pick from screen' }).count(),
      hasApi: await page.evaluate(() => 'EyeDropper' in window),
    };
    check(
      `${T}: opens empty — an empty frame, no formats, Background #ffffff, no contrast; Pick from screen where Chrome has EyeDropper (§8)`,
      empty.color === '' &&
        empty.background === '#ffffff' &&
        empty.fills === 0 &&
        empty.contrast === 0 &&
        empty.dropper === (empty.hasApi ? 1 : 0),
      JSON.stringify(empty),
    );

    // ---- §2.1: #ff8800 in every notation; the swatch is that colour ----
    await field.fill('#ff8800');
    const orange = await table();
    check(
      `${T}: #ff8800 in every notation (§2.1)`,
      Object.values(orange).join(' | ') ===
        '#ff8800 | rgb(255 136 0) | hsl(32 100% 50%) | hwb(32 0% 0%) | lab(69.4 41.7 75.66) | lch(69.4 86.39 61.14) | ' +
          'oklab(74.42% 0.1001 0.151) | oklch(74.42% 0.1812 56.46) | color(display-p3 0.9387 0.5575 0.2057) | ≈ darkorange',
      Object.values(orange).join(' | '),
    );
    const swatch = page.locator('[data-swatch] svg');
    const fillOf = selector => page.locator(selector).evaluate(el => getComputedStyle(el).fill);
    const orangeFill = await fillOf('[data-swatch] [data-fill="color"]');
    const [orangePixel] = await pixels(await swatch.screenshot(), [[0.5, 0.5]]);
    const styled = await page.evaluate(
      () => document.querySelectorAll('[data-swatch] [style], [data-contrast] [style]').length,
    );
    check(
      `${T}: the swatch shows the colour — an SVG fill attribute: computed fill and the screenshot's pixel are 255,136,0, no style attribute (§5.7)`,
      orangeFill === 'rgb(255, 136, 0)' && far(orangePixel, [255, 136, 0]) <= 1 && styled === 0,
      `computed ${orangeFill}; pixel ${orangePixel.join(',')}; style attributes ${styled}`,
    );

    // Copy: exactly the shown value; "Copied" on the button; a commit to the history.
    clipboard = await stubClipboard(page);
    await page.getByRole('button', { name: 'Copy OKLCH' }).click();
    await page.getByRole('button', { name: 'Copied OKLCH' }).waitFor({ timeout: 2_000 });
    await page.getByRole('button', { name: 'Copy Name' }).click();
    const copied = await clipboard.copied();
    await clipboard.restore();
    clipboard = null;
    check(
      `${T}: Copy copies exactly the shown value and says Copied (§3, §8)`,
      copied.join(' | ') === 'oklch(74.42% 0.1812 56.46) | ≈ darkorange',
      copied.join(' | '),
    );
    const record = await waitForHistoryRecord(page, 'color', r => r.kind === 'convert').catch(() => null);
    check(
      `${T}: copying a format is recorded (kind convert, colour and background as typed)`,
      record?.label === '#ff8800 on #ffffff',
      JSON.stringify(record?.label ?? null),
    );

    // ---- §2.4: hex without # ----
    await field.fill('ff8800');
    const readAs = await page.getByText('Read as #ff8800').getAttribute('role');
    check(
      `${T}: ff8800 is read as #ff8800, said as a status (§2.4)`,
      readAs === 'status' && (await table()).hex === '#ff8800',
    );

    // ---- §2.2: outside sRGB — two halves, the gamut line; Chrome paints the left half clipped ----
    await field.fill('oklch(70% 0.4 150)');
    const gamut = await text('[data-gamut]');
    const halves = {
      left: await fillOf('[data-swatch] [data-fill="as-written"]'),
      right: await fillOf('[data-swatch] [data-fill="srgb"]'),
    };
    const [leftPixel, rightPixel] = await pixels(await swatch.screenshot(), [
      [0.25, 0.5],
      [0.75, 0.5],
    ]);
    check(
      `${T}: oklch(70% 0.4 150) — the gamut line and two halves: as written (painted clipped, 0,214,0) and sRGB #00c248 (§2.2, §5.4)`,
      gamut ===
        'Outside sRGB and Display P3. The sRGB formats show the closest colour by CSS Color 4 gamut mapping: #00c248. Browsers clip it instead: #00d600.' &&
        /^oklch\(0\.7 0\.4 150\)$/.test(halves.left) &&
        halves.right === 'rgb(0, 194, 72)' &&
        far(leftPixel, [0, 214, 0]) <= 1 &&
        far(rightPixel, [0, 194, 72]) <= 1 &&
        (await page.getByText('As written').count()) === 1,
      `${gamut} | ${halves.left} | ${halves.right} | pixels ${leftPixel.join(',')} / ${rightPixel.join(',')}`,
    );
    await page.mouse.move(0, 0);
    await settledShot(shoot, page, 'tool-color-02-gamut-light.png');
    await field.fill('color(display-p3 0 1 0)');
    check(
      `${T}: color(display-p3 0 1 0) — outside sRGB, inside Display P3 (§5.4)`,
      (await text('[data-gamut]')) ===
        'Outside sRGB, inside Display P3. The sRGB formats show the closest colour by CSS Color 4 gamut mapping: #00fb29. Browsers clip it instead: #00ff00.',
      await text('[data-gamut]'),
    );

    // ---- §2.5: translucent — the checkerboard under the swatch; the text blended in the contrast ----
    await field.fill('#ff880080');
    const cells = await page.evaluate(() =>
      ['fill-muted', 'fill-background'].map(c => getComputedStyle(document.querySelector(`pattern .${c}`)).fill),
    );
    const [muted, light] = (await chrome(cells)).map(c => c.pixel);
    // The pattern: 16 × 16 tiles, muted 8 × 8 cells at the tile's top left and bottom right.
    const [onMuted, onLight] = await pixels(await swatch.screenshot(), [
      [4 / 96, 4 / 48],
      [12 / 96, 4 / 48],
    ]);
    const a = 128 / 255;
    const blend = under => [255, 136, 0].map((v, i) => Math.round(v * a + under[i] * (1 - a)));
    check(
      `${T}: #ff880080 sits on the theme's checkerboard: each pixel is the colour blended over its cell (§5.7)`,
      far(onMuted, blend(muted)) <= 2 && far(onLight, blend(light)) <= 2,
      `muted ${muted.slice(0, 3)} → ${onMuted.slice(0, 3)} (want ${blend(muted)}); background ${light.slice(0, 3)} → ${onLight.slice(0, 3)} (want ${blend(light)})`,
    );
    await field.fill('#00000080');
    check(
      `${T}: semi-transparent text on white — 4.00:1, blended #7f7f7f (§2.5)`,
      (await text('[data-ratio]')) === '4.00:1' &&
        (await page
          .getByText('The text colour is semi-transparent: contrast uses it blended over the background (#7f7f7f).')
          .count()) === 1,
      await text('[data-ratio]'),
    );

    // ---- §2.3: contrast on white ----
    await field.fill('#777777');
    const grey77 = [
      await text('[data-ratio]'),
      await text('[data-check="aaNormal"]'),
      await text('[data-check="aaLarge"]'),
    ];
    await field.fill('#767676');
    const grey76 = [await text('[data-ratio]'), await text('[data-check="aaNormal"]')];
    const [samplePixel] = await pixels(await page.locator('[data-contrast-sample]').screenshot(), [[0.95, 0.1]]);
    check(
      `${T}: #777777 on white 4.47:1 fails AA normal text, passes large; #767676 4.54:1 passes (§2.3); the sample's background is painted`,
      grey77.join('|').replace(/\s+/g, ' ') === '4.47:1|AA · normal text 4.5:1 Fail|AA · large text 3:1 Pass' &&
        grey76.join('|').replace(/\s+/g, ' ') === '4.54:1|AA · normal text 4.5:1 Pass' &&
        far(samplePixel, [255, 255, 255]) <= 1,
      `${grey77.join('|')} ; ${grey76.join('|')} ; sample ${samplePixel.slice(0, 3)}`,
    );

    // ---- §2.6 and §6: errors next to their field ----
    await field.fill('rgb(255 136)');
    const error = page.getByText(
      'Not a CSS colour. Try #ff8800, rgb(255 136 0), hsl(32 100% 50%) or oklch(74% 0.18 56).',
    );
    check(
      `${T}: a typo says what a colour looks like, under the field, as a status (§2.6)`,
      (await error.count()) === 1 && (await error.getAttribute('role')) === 'status' && (await table()).hex === '',
    );
    await field.fill('red');
    await background.fill('nope');
    check(
      `${T}: an invalid background empties the contrast and says why under itself (§6)`,
      (await page.locator('[data-contrast]').count()) === 0 && (await error.count()) === 1,
    );
    await background.fill('#ffffff');

    // ---- the system picker and Swap ----
    await page.getByLabel('Pick a colour').fill('#336699');
    const picked = await field.inputValue();
    await field.fill('ff8800');
    await background.fill('#1e1e1e');
    await page.getByRole('button', { name: 'Swap colour and background' }).click();
    const swapped = [await field.inputValue(), await background.inputValue()];
    await page.getByRole('button', { name: 'Swap colour and background' }).click();
    check(
      `${T}: the system picker writes #rrggbb into the field; Swap exchanges the fields as typed (§4, §5.8)`,
      picked === '#336699' && swapped.join(' ') === '#1e1e1e ff8800',
      `${picked}; ${swapped.join(' ')}`,
    );
    await field.fill('#ff8800');
    await page.mouse.move(0, 0);
    await settledShot(shoot, page, 'tool-color-01-convert-light.png');
    const contrastPane = page.locator('[data-slot="tool-pane"]').filter({ has: background });
    await settledShot(shoot, contrastPane, 'tool-color-05-contrast-light.png');

    // ---- §2.7: Pick from screen (EyeDropper stubbed in the page, then put back) ----
    let dropped = 'no EyeDropper in this Chrome';
    if (empty.hasApi) {
      await page.evaluate(() => {
        window.__colorEyeDropper = window.EyeDropper;
        window.EyeDropper = class {
          open() {
            return Promise.resolve({ sRGBHex: '#123456' });
          }
        };
      });
      await page.goto(`${base}#/tools`);
      await page.goto(tool);
      await field.waitFor();
      await page.getByRole('button', { name: 'Pick from screen' }).click();
      await page.waitForFunction(() => document.querySelector('#color-input').value === '#123456', null, {
        timeout: 2_000,
      });
      dropped = await field.inputValue();
      await page.evaluate(() => {
        window.EyeDropper = window.__colorEyeDropper;
        delete window.__colorEyeDropper;
      });
    }
    check(`${T}: Pick from screen writes the pixel's hex into Color (§2.7)`, dropped === '#123456', dropped);

    // ---- the keyboard: §8's order ----
    await field.fill('#ff8800');
    await field.focus();
    const stops = [];
    for (let k = 0; k < 15; k++) {
      await page.keyboard.press('Tab');
      stops.push(
        await page.evaluate(() => {
          const el = document.activeElement;
          return el?.getAttribute('aria-label') || el?.id || el?.textContent || el?.tagName;
        }),
      );
    }
    const o = empty.hasApi ? 2 : 1;
    check(
      `${T}: Tab goes field → picker → Pick from screen → ten Copy → background → picker → Swap (§8)`,
      stops[0] === 'Pick a colour' &&
        (!empty.hasApi || stops[1] === 'Pick from screen') &&
        stops.slice(o, o + 10).every(s => /copy-/.test(s)) &&
        stops[o + 10] === 'color-background' &&
        stops[o + 11] === 'Pick a background colour' &&
        stops[o + 12] === 'Swap colour and background',
      stops.join(' → '),
    );

    // ---- History: an entry opens back into the tool ----
    await background.fill('#1e1e1e');
    clipboard = await stubClipboard(page);
    await page.getByRole('button', { name: 'Copy HEX' }).click();
    await clipboard.restore();
    clipboard = null;
    await waitForHistoryRecord(page, 'color', r => r.label === '#ff8800 on #1e1e1e');
    await page.goto(`${base}#/history`);
    const entry = page.locator('.kit-history-entry[data-kind="convert"]', { hasText: '#ff8800 on #1e1e1e' }).first();
    await entry.waitFor({ timeout: 5_000 });
    await entry.getByRole('button', { name: 'Open' }).click();
    await page.locator('[data-restored]').waitFor();
    check(
      `${T}: an entry of History opens back into the tool with both fields`,
      (await field.inputValue()) === '#ff8800' &&
        (await background.inputValue()) === '#1e1e1e' &&
        (await text('[data-ratio]')) === '6.96:1',
      `${await field.inputValue()} on ${await background.inputValue()}`,
    );

    // ---- the dark theme ----
    await field.fill('oklch(70% 0.4 150)');
    const darkShots = await inDarkTheme(ctx, base, page, async () => {
      await page.mouse.move(0, 0);
      await settledShot(shoot, page, 'tool-color-03-gamut-dark.png');
      await field.fill('#ff8800');
      await page.mouse.move(0, 0);
      await settledShot(shoot, page, 'tool-color-04-convert-dark.png');
      await settledShot(shoot, contrastPane, 'tool-color-06-contrast-dark.png');
      const [px] = await pixels(await swatch.screenshot(), [[0.5, 0.5]]);
      return { mode: await page.evaluate(() => document.documentElement.dataset.mode), px };
    });
    check(
      `${T}: in the dark theme the swatch is the same colour`,
      darkShots.mode === 'dark' && far(darkShots.px, [255, 136, 0]) <= 1,
      JSON.stringify(darkShots),
    );

    // ---- the conversions against Chrome's own ----
    await page.goto(tool);
    await field.waitFor();
    const ours = [];
    for (const input of INPUTS) {
      await field.fill(input);
      ours.push({
        input,
        ...(await table()),
        gamut: await text('[data-gamut]'),
      });
    }
    const theirs = await chrome(INPUTS);
    const worst = { srgb: 0, clipped: 0, lab: 0, lch: 0, oklab: 0, oklch: 0, p3: 0 };
    const where = {};
    const misses = [];
    const note = (kind, diff, input, detail) => {
      if (diff > worst[kind]) {
        worst[kind] = diff;
        where[kind] = `${input}: ${detail}`;
      }
    };
    ours.forEach((o, i) => {
      const c = theirs[i];
      const outside = o.gamut.trim() !== '';
      const clipped = outside ? /clip it instead: (#[0-9a-f]{6})/.exec(o.gamut)?.[1] : null;
      // sRGB: the tool's HEX (in gamut) or its "clip" HEX (outside) against Chrome's pixel.
      const want = bytes(outside ? clipped : o.hex);
      const diff = far(c.pixel, want);
      note(outside ? 'clipped' : 'srgb', diff, o.input, `${c.pixel.slice(0, 3)} vs ${outside ? clipped : o.hex}`);
      if (diff > 1) misses.push(`${o.input} pixel ${c.pixel.slice(0, 3)} vs ${outside ? clipped : o.hex}`);
      for (const kind of ['lab', 'lch', 'oklab', 'oklch', 'p3']) {
        if (kind === 'p3' && /and Display P3/.test(o.gamut)) continue; // outside P3 the tool shows it mapped
        const mine = components(o[kind], kind);
        const chromes = components(c[kind], kind);
        if (!mine || !chromes) {
          misses.push(`${o.input} ${kind}: ${o[kind]} vs ${c[kind]}`);
          continue;
        }
        const raw = numbers(String(c[kind]).replace(/^color\(\s*display-p3/, 'color('));
        [0, 1, 2].forEach(k => {
          if (raw[k] === 'none') return; // Chrome carries a missing hue over to the analogous one (CSS Color 4 §12.2)
          const hue = (kind === 'lch' || kind === 'oklch') && k === 2;
          if (hue && mine[1] < (kind === 'lch' ? 1 : 0.01)) return; // the hue of a near-grey means nothing
          if ((kind === 'lab' || kind === 'lch') && k === 0 && mine[0] > 100) return; // lab() clamps L when re-read
          let delta = Math.abs(mine[k] - chromes[k]);
          if (hue) delta = Math.min(delta, 360 - delta);
          const percent = (kind === 'oklab' || kind === 'oklch') && k === 0; // shown in percent
          const scaled = percent ? delta * 100 : delta;
          const limit = tolerance(kind, k, mine);
          note(kind, +scaled.toFixed(6), o.input, `${o[kind]} vs ${c[kind]}`);
          if (scaled > limit + 1e-9) misses.push(`${o.input} ${kind}[${k}]: ${o[kind]} vs ${c[kind]}`);
        });
      }
    });
    check(
      `${T}: every conversion agrees with Chrome's own (one unit of the last digit; Lab a/b and LCH C 0.03, P3 0.0002); in-gamut HEX = Chrome's pixel ±1; "Browsers clip it" = what Chrome paints ±1`,
      misses.length === 0,
      `${INPUTS.length} inputs; largest differences ${JSON.stringify(worst)}; at ${JSON.stringify(where)}${
        misses.length ? `; misses: ${misses.join('; ')}` : ''
      }`,
    );

    // Chrome reads every format the tool writes as the colour its HEX says.
    const roundTrip = [];
    for (const o of ours) {
      const outside = o.gamut.trim() !== '';
      const formats = outside
        ? ['hex', 'rgb', 'hsl', 'hwb']
        : ['hex', 'rgb', 'hsl', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'p3'];
      const painted = await chrome(formats.map(k => o[k]));
      painted.forEach((p, k) => {
        const d = far(p.pixel, bytes(o.hex));
        if (!p.valid || d > 1)
          roundTrip.push(`${o.input} ${formats[k]} ${o[formats[k]]} → ${p.pixel.slice(0, 3)} vs ${o.hex}`);
      });
    }
    check(
      `${T}: Chrome paints each format the tool writes as its HEX (±1), all valid CSS`,
      roundTrip.length === 0,
      roundTrip.join('; ') || `${ours.length} colours`,
    );
    // Parsing as Chrome does: what Chrome rejects the tool rejects, and the reverse.
    const parsing = await chrome([
      'rgb(1 2)',
      'rgb(1, 2 3)',
      '#ggg',
      'reddish',
      'rgb(255 136 0 / none)',
      'hsl(30 100 50)',
    ]);
    await field.fill('rgb(255 136 0 / none)');
    const noneAlpha = (await table()).hex;
    check(
      `${T}: what Chrome rejects is rejected; alpha none paints as 0 in both; modern hsl() with numbers is valid in both`,
      parsing.slice(0, 4).every(p => !p.valid) &&
        parsing[4].valid &&
        parsing[4].pixel[3] === 0 &&
        noneAlpha === '#ff880000' &&
        parsing[5].valid,
      JSON.stringify(parsing.map(p => [p.input, p.valid, p.pixel.join(',')])),
    );

    // ---- the policy: nothing above was refused ----
    const violations = await page.evaluate(() => document.documentElement.__colorCsp?.seen ?? ['listener lost']);
    check(
      `${T}: no content security policy violation on the page while the swatches, the picker and the sample were shown`,
      violations.length === 0,
      violations.join('; '),
    );
    // ---- §7: pasted on the start page — in a tab of its own, so the many visits stay out of the main tab's history
    // (later modules count its entries, and Chrome keeps no more than 50) ----
    tab = await ctx.newPage();
    const tabErrors = [];
    tab.on('console', m => {
      if (m.type() === 'error') tabErrors.push(m.text());
    });
    tab.on('pageerror', e => tabErrors.push(String(e)));
    const paste = async value => {
      await tab.goto(`${base}#/start`);
      const box = tab.getByRole('combobox', { name: 'Find a tool or search the web' });
      await box.waitFor();
      await box.focus();
      await tab.evaluate(v => {
        const data = new DataTransfer();
        data.setData('text/plain', v);
        document.activeElement.dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
        );
      }, value);
      await tab.waitForFunction(() => location.hash !== '#/start', null, { timeout: 3_000 }).catch(() => {});
      await sleep(200);
      return tab.evaluate(() => location.hash);
    };
    const opened = {};
    for (const value of ['#ff8800', '#abc', 'oklch(70% 0.4 150)', 'rgb(255 136 0)', 'color(display-p3 0 1 0)']) {
      const hash = await paste(value);
      opened[value] = hash === '#/tools/color' ? await tab.locator('#color-input').inputValue() : hash;
    }
    check(
      `${T}: §7 a hex with # and colour functions pasted on the start page open the tool with them`,
      Object.entries(opened).every(([v, got]) => v === got),
      JSON.stringify(opened),
    );
    const notOurs = {};
    for (const value of ['red', 'ff8800', 'deadbeef', '#ggg', '#12345', '1700000000', '0 9 * * 1-5', 'fix #123']) {
      const hash = await paste(value);
      if (hash === '#/tools/color') notOurs[value] = hash;
    }
    check(
      `${T}: §7 a name, hex without #, other tools' inputs do not open it`,
      Object.keys(notOurs).length === 0,
      JSON.stringify(notOurs),
    );
    check(`${T}: no console error in the pasting tab`, tabErrors.length === 0, tabErrors.join('; '));
  } finally {
    if (clipboard) await clipboard.restore().catch(() => {});
    await page
      .evaluate(() => {
        if ('__colorEyeDropper' in window) {
          window.EyeDropper = window.__colorEyeDropper;
          delete window.__colorEyeDropper;
        }
        const csp = document.documentElement.__colorCsp;
        if (csp) document.removeEventListener('securitypolicyviolation', csp.listen);
        delete document.documentElement.__colorCsp;
      })
      .catch(() => {});
    await oracle.close().catch(() => {});
    if (tab) await tab.close().catch(() => {});
    check(`${T}: no console error or page error in the tool's tab`, pageErrors.length === 0, pageErrors.join('; '));
    await page.close().catch(() => {});
  }
};
