// The String Inspector in the built extension (docs/tools/specs/string-inspector.md): its scenarios (§2) the way a
// person does them — the page's real controls; Copy goes to the page's own stubbed clipboard, never the machine's. Then
// the same inputs counted by Chrome on the page and by the tool's logic in Node, every difference named (§15: Chrome
// 159 carries Unicode 17 and its own word rules, Node 22.20 Unicode 16 and ICU 77.1); the page kept whole by hostile
// text — bidirectional overrides, a flood of combining marks, a megabyte without a line break (§5.4, measured: what
// lies outside the text's boxes keeps its place and its pixels, the boxes keep their height); a megabyte timed in the
// browser (§12), the text box apart from the tool's work; an entry opened back from the tool's own history (D17); the
// keyboard; the page in the light and the dark theme. Every invisible or bidirectional character is an escape. Run by
// scripts/e2e-tools.mjs.

/* global document, location, HTMLTextAreaElement, requestAnimationFrame, getComputedStyle -- page.evaluate callbacks run in the page */

import { inDarkTheme, settledShot, stubClipboard, waitForHistoryRecord } from '../e2e-helpers.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

const FAMILY = '\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}';

/** §10's inputs and the hard cases of §5: Chrome must answer what the logic answers in Node, except where named. */
const INPUTS = [
  ' ',
  'hello',
  'h\u{E9}llo',
  'he\u{301}llo',
  'Stra\u{DF}e',
  '\u{1F44D}',
  '\u{1F44D}\u{1F3FD}',
  FAMILY,
  '\u{1F1F7}\u{1F1FA}',
  '\u{1F1F7}\u{1F1FA}\u{1F1E9}',
  '1\u{FE0F}\u{20E3}',
  '\u{2764}\u{FE0F}',
  'a\u{FE0F}b',
  'a\u{200B}b',
  '\u{FEFF}x',
  'abc\u{D800}',
  '\u{DC00}',
  'a\nb\nc',
  'one two  three',
  "don't stop",
  'foo_bar foo-bar 3.14 v1.2.3',
  'fooBar',
  'e-mail a@b.com',
  '\u{41F}\u{440}\u{438}\u{432}\u{435}\u{442}, \u{43C}\u{438}\u{440}!',
  '\u{4F60}\u{597D}\u{4E16}\u{754C}',
  '\u{6211}\u{559C}\u{6B22}\u{5403}\u{82F9}\u{679C}',
  '\u{79C1}\u{306F}\u{65E5}\u{672C}\u{8A9E}\u{3092}\u{8A71}\u{3057}\u{307E}\u{3059}',
  '\u{E2A}\u{E27}\u{E31}\u{E2A}\u{E14}\u{E35}\u{E04}\u{E23}\u{E31}\u{E1A}',
  '\u{928}\u{92E}\u{938}\u{94D}\u{924}\u{947}',
  '\u{915}\u{94D}\u{937}',
  '\u{995}\u{9CD}\u{9B7}',
  '\u{1112}\u{1161}\u{11AB}\u{AD6D}\u{C5B4}',
  'e\u{301}\u{302}\u{323}',
  'hello \u{1F44B} world',
  '\u{DC}n\u{EF}c\u{F6}d\u{E9}',
  '\u{395}\u{3BB}\u{3BB}\u{3AC}\u{3B4}\u{3B1}',
  'p\u{430}ypal',
  'p\u{430}ypal.com',
  '\u{3A1}ython',
  '\u{202E}abc\u{202C}',
  '\u{2066}a\u{2069}',
  'a\tb',
  '\u{A0}',
  'a\u{2003}b',
  'x\u{AD}y',
  'x\u{2028}y',
  'x\u{0}y',
  '\u{3164}',
  '\u{201C}quoted\u{201D} \u{2014} dash',
  '\u{FF21}\u{FF22}\u{FF23}',
  '\u{5E9}\u{5DC}\u{5D5}\u{5DD} \u{627}\u{644}\u{639}\u{627}\u{644}\u{645}',
  '\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}',
  'x\u{E000}\u{FFFF}\u{378}',
  `Z${'\u{301}\u{316}'.repeat(200)}`,
  '\u{FB01} e\u{301}',
  '\u{2605}\u{FE0F}',
  '\u{1780}\u{17D2}\u{1780}',
  '\u{20C1}',
  '\u{A7F1}',
  '\u{295}',
];

/**
 * Where Chrome 159 and Node 22.20 differ — measured in this module and in a probe of every code point (spec §15). Each
 * is the input, what differs, and why.
 */
const EXPECTED_DIFFERENCES = new Map([
  [
    'e-mail a@b.com',
    'words: Chrome splits b.com at the full stop (Node keeps letters joined across it, UAX #29 WB6/7)',
  ],
  ['p\u{430}ypal.com', 'words and the quoted word: Chrome ends the word at the full stop'],
  ['\u{2605}\u{FE0F}', 'U+2605 is no longer Extended_Pictographic in Chrome: its VS16 is marked'],
  ['\u{1780}\u{17D2}\u{1780}', 'Khmer coeng: one grapheme in Chrome (Unicode 17), two in Node'],
  ['\u{20C1}', 'U+20C1 SAUDI RIYAL SIGN is assigned in Unicode 17: no warning in Chrome'],
  [
    '\u{A7F1}',
    'U+A7F1 is assigned in Unicode 17 with a compatibility decomposition: NFKC and NFKD change it in Chrome',
  ],
  ['\u{295}', 'U+0295 is Lo in Unicode 17, Ll in 16'],
]);

const SAMPLE_UNIT =
  'The quick brown fox jumps over the lazy dog. \u{201C}Quoted\u{201D} \u{2014} dash, e\u{301}t\u{E9} na\u{EF}ve.\n' +
  '\u{41F}\u{440}\u{438}\u{432}\u{435}\u{442}, \u{43C}\u{438}\u{440}! \u{395}\u{3BB}\u{3BB}\u{3AC}\u{3B4}\u{3B1} \u{4F60}\u{597D}\u{4E16}\u{754C} \u{928}\u{92E}\u{938}\u{94D}\u{924}\u{947} ' +
  `${FAMILY} \u{1F1F7}\u{1F1FA} \u{1F44D}\u{1F3FD} \u{2764}\u{FE0F} ` +
  'api\u{200B}_key p\u{430}ypal\u{A0}x 3.14 v1.2.3 foo_bar don\u{2019}t\n';
const sample = n => SAMPLE_UNIT.repeat(Math.ceil(n / SAMPLE_UNIT.length)).slice(0, n);

/** The RGB(A) pixels of a screenshot (8-bit, not interlaced, as Chrome writes them). */
const pixelsOf = png => {
  let pos = 8;
  let width = 0;
  let height = 0;
  let channels = 4;
  const idat = [];
  while (pos < png.length) {
    const length = png.readUInt32BE(pos);
    const kind = png.toString('latin1', pos + 4, pos + 8);
    const chunk = png.subarray(pos + 8, pos + 8 + length);
    if (kind === 'IHDR') {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      channels = chunk[9] === 2 ? 3 : 4;
    } else if (kind === 'IDAT') idat.push(chunk);
    pos += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= channels ? out[y * stride + x - channels] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels] : 0;
      const p = a + b - c;
      const paeth =
        Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c)
          ? a
          : Math.abs(p - b) <= Math.abs(p - c)
            ? b
            : c;
      out[y * stride + x] = (v + [0, a, b, (a + b) >> 1, paeth][filter]) & 255;
    }
  }
  return { width, height, channels, data: out };
};
/** How many pixels of two screenshots of one size differ by more than antialiasing noise (a level of 48 in a channel). */
const changedPixels = (a, b) => {
  const pa = pixelsOf(a);
  const pb = pixelsOf(b);
  if (pa.width !== pb.width || pa.height !== pb.height) return Infinity;
  let n = 0;
  for (let i = 0; i < pa.data.length; i += pa.channels) {
    let most = 0;
    for (let k = 0; k < 3; k++) most = Math.max(most, Math.abs(pa.data[i + k] - pb.data[i + k]));
    if (most > 48) n++;
  }
  return n;
};

export default async ({ ctx, page, base, check, shoot, sleep }) => {
  // The logic itself, run by Node (its files are erasable TypeScript, so Node runs them as they are).
  const logic = await import(pathToFileURL(join(ROOT, 'packages/tools/logic/string-inspector/src/index.ts')).href);
  const names = await logic.loadNames();

  // Every move replaces the tab's history entry: Chrome keeps at most 50, and a later module counts entries.
  const go = async hash => {
    if (page.url().startsWith(base)) await page.evaluate(h => location.replace(h), hash);
    else await page.goto(`${base}${hash}`);
  };
  await go('#/tools/string-inspector');
  const text = page.getByLabel('Text', { exact: true });
  await text.waitFor();
  const clipboard = await stubClipboard(page);
  const value = key => page.locator(`[data-summary="${key}"] dd`).innerText();
  const button = name => page.getByRole('button', { name, exact: true });
  const visibleBox = page.locator('[data-part="visible"]');
  const warningsOf = () => page.locator('[data-part="warnings"] li').allInnerTexts();
  /** Sets the field as typing would and waits two frames; the results of a small text are there by then. */
  const put = async (v, { wait = true } = {}) => {
    await page.evaluate(next => {
      const field = document.querySelector('#string-inspector-input');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, next);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }, v);
    if (wait) await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  };
  /** The visible text as the page shows it, markers as [MARKER]. */
  const shownText = () =>
    page.evaluate(() => {
      const box = document.querySelector('[data-part="visible"]');
      if (!box) return null;
      return [...box.childNodes].map(n => (n.nodeType === 3 ? n.textContent : `[${n.dataset.marker}]`)).join('');
    });

  try {
    // Empty state (§6, §8).
    const zeros = await page.locator('[data-summary] dd').allInnerTexts();
    check(
      'String Inspector: opens empty \u{2014} the field, a summary of zeros, Copy summary off, nothing else; Chrome\u{2019}s Unicode said',
      zeros.join('|') === '0|0|0|0|0|0|0|NFC and NFD' &&
        (await text.getAttribute('placeholder')) === 'Paste a string to inspect' &&
        (await button('Copy summary').isDisabled()) &&
        (await visibleBox.count()) === 0 &&
        (await page.locator('[data-part="table"]').count()) === 0 &&
        (await page.locator('[data-part="unicode"]').innerText()) ===
          'Counted with this browser\u{2019}s Unicode data (17.0 or later).',
      `${zeros.join('|')}; ${await page.locator('[data-part="unicode"]').innerText()}`,
    );
    await settledShot(shoot, page, 'tool-string-inspector-01-empty-light.png');

    // §2.1–§2.3.
    await text.fill('\u{41F}\u{440}\u{438}\u{432}\u{435}\u{442} \u{43C}\u{438}\u{440}');
    const varchar = [await value('graphemes'), await value('utf8Bytes')];
    await text.fill(FAMILY);
    await visibleBox.waitFor();
    const family = await Promise.all(['graphemes', 'codePoints', 'utf16Units', 'utf8Bytes'].map(value));
    const familyRows = await page.locator('[data-part="table"] tbody tr td:nth-child(4)').allInnerTexts();
    await text.fill('api\u{200B}_key');
    const zwsp = [await shownText(), await warningsOf()];
    check(
      'String Inspector: \u{A7}2.1\u{2013}\u{A7}2.3 \u{41F}\u{440}\u{438}\u{432}\u{435}\u{442} \u{43C}\u{438}\u{440} 10 / 19 bytes; a family 1 / 7 / 11 / 25 with three ZWJ rows; api[ZWSP]_key',
      varchar.join('|') === '10|19' &&
        family.join('|') === '1|7|11|25' &&
        familyRows.filter(n => n === 'ZERO WIDTH JOINER').length === 3 &&
        zwsp[0] === 'api[ZWSP]_key' &&
        zwsp[1].join('|') === '1 invisible character: ZWSP.',
      JSON.stringify({ varchar, family, zwsp }),
    );

    // §2.4–§2.7, as Chrome counts.
    await text.fill('p\u{430}ypal.com');
    const paypal = await warningsOf();
    const paypalRow = await page.locator('[data-part="table"] tbody tr').nth(1).locator('td').allInnerTexts();
    await text.fill('\u{202E}abc\u{202C}');
    const trojan = [await shownText(), await warningsOf()];
    await settledShot(shoot, page, 'tool-string-inspector-02-trojan-source-light.png');
    await text.fill('\u{201C}quoted\u{201D} \u{2014} dash');
    const quotes = await warningsOf();
    await text.fill('e\u{301}');
    const nfd = [await value('normalization'), await value('codePoints')];
    await text.fill('\u{E9}');
    const nfc = [await value('normalization'), await value('codePoints')];
    check(
      'String Inspector: \u{A7}2.4\u{2013}\u{A7}2.7 p\u{430}ypal.com (Chrome quotes "p\u{430}ypal"), Trojan Source, quotes and a dash, NFD against NFC',
      paypal.join('|') === 'Mixed scripts in 1 word: "p\u{430}ypal" (Cyrillic, Latin).' &&
        paypalRow[2] === 'U+0430' &&
        paypalRow[5] === 'Cyrillic' &&
        trojan[0] === '[RLO]abc[PDF]' &&
        trojan[1][1] === 'Bidirectional controls (RLO, PDF) can change the order in which text is displayed.' &&
        quotes.join('|') ===
          '3 characters look like ASCII: \u{201C} \u{2192} ", \u{201D} \u{2192} ", \u{2014} \u{2192} -.' &&
        nfd.join('|') === 'NFD|2' &&
        nfc.join('|') === 'NFC|1',
      JSON.stringify({ paypal, trojan, quotes, nfd, nfc }),
    );

    // Copy summary and Copy table (§3): the page's own clipboard.
    await text.fill('a\u{200B}\u{E9}');
    await button('Copy summary').click();
    await button('Copied').waitFor({ timeout: 2_000 });
    await button('Copy table').click();
    await page.waitForFunction(() => document.documentElement.__e2eCopied?.length >= 2, null, { timeout: 2_000 });
    const copies = await clipboard.copied();
    check(
      'String Inspector: Copy summary copies the eight lines, Copy table the TSV with names',
      copies.at(-2) === logic.summaryText(logic.summarize('a\u{200B}\u{E9}')) &&
        copies.at(-1) === logic.tableTsv(logic.rows('a\u{200B}\u{E9}', logic.MAX_ROWS, names)),
      JSON.stringify(copies.slice(-2)),
    );

    // Chrome against Node, input by input: the summary, the warnings, the visible text, the forms, the first row's
    // category. Read back from the field, as a person's text arrives (the field may change line breaks).
    const answers = [];
    for (const input of INPUTS) {
      await put(input);
      await page.waitForFunction(() => document.querySelector('[data-part="visible"]'), null, { timeout: 5_000 });
      answers.push(
        await page.evaluate(() => {
          const box = document.querySelector('[data-part="visible"]');
          return {
            input: document.querySelector('#string-inspector-input').value,
            summary: [...document.querySelectorAll('[data-summary] dd')].map(dd => dd.textContent),
            warnings: [...document.querySelectorAll('[data-part="warnings"] li')].map(li => li.textContent),
            visible: [...box.childNodes]
              .map(n => (n.nodeType === 3 ? n.textContent : `[${n.dataset.marker}]`))
              .join(''),
            forms: document.querySelector('[data-part="forms"]')?.textContent ?? '',
            category: document.querySelector('[data-part="table"] tbody tr td:nth-child(5)')?.textContent ?? '',
          };
        }),
      );
    }
    const differ = new Map();
    for (const a of answers) {
      const r = logic.inspect(a.input);
      const node = {
        summary: logic.SUMMARY_LABELS.map(([key]) => logic.summaryValue(r.summary, key)),
        warnings: logic.warningLines(r.warnings),
        visible: logic.partsText(logic.visibleParts(a.input)),
        category: logic.categoryName(logic.rows(a.input, 1)[0]?.category ?? ''),
      };
      const what = [];
      if (node.summary.join('|') !== a.summary.join('|'))
        what.push(`summary ${a.summary.join('|')} (Node ${node.summary.join('|')})`);
      // The page builds the mixed-script line itself; its words are the logic's.
      if (node.warnings.join('|') !== a.warnings.join('|'))
        what.push(`warnings ${JSON.stringify(a.warnings)} (Node ${JSON.stringify(node.warnings)})`);
      if (node.visible !== a.visible)
        what.push(`visible ${JSON.stringify(a.visible)} (Node ${JSON.stringify(node.visible)})`);
      if (node.category !== a.category) what.push(`category ${a.category} (Node ${node.category})`);
      const nodeForms = r.forms === null ? null : r.forms.map(f => f.changes).join('|');
      const chromeForms = a.forms.startsWith('Normalization not checked')
        ? null
        : ['NFC', 'NFD', 'NFKC', 'NFKD'].map(f => a.forms.includes(`${f} changes it`)).join('|');
      if (nodeForms !== chromeForms) what.push(`forms ${a.forms} (Node ${nodeForms})`);
      if (what.length) differ.set(a.input, what.join('; '));
    }
    const unexpected = [...differ.keys()].filter(k => !EXPECTED_DIFFERENCES.has(k));
    const missing = [...EXPECTED_DIFFERENCES.keys()].filter(k => !differ.has(k));
    check(
      `String Inspector: Chrome and Node agree on ${INPUTS.length - differ.size} of ${INPUTS.length} inputs; the ${EXPECTED_DIFFERENCES.size} differences are the known ones`,
      unexpected.length === 0 && missing.length === 0,
      [...differ].map(([k, v]) => `${JSON.stringify(k)}: ${v}`).join(' || ') +
        (missing.length ? ` || expected but not seen: ${missing.map(m => JSON.stringify(m)).join(', ')}` : ''),
    );

    // Hostile text (§5.4). A flood of combining marks above and below two letters: what lies outside the visible box
    // keeps its place and its pixels, and the box keeps its height (clipped, one line box per line).
    const geometry = () =>
      page.evaluate(() => {
        const rect = sel => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
        };
        return {
          title: rect('[data-slot="tool-page"] h2'),
          field: rect('#string-inspector-input'),
          summary: rect('#string-inspector-summary'),
          copy: rect('[data-slot="copy-button"]'),
          visibleHead: rect('#string-inspector-visible'),
          box: rect('[data-part="visible"]'),
          tableHead: rect('#string-inspector-table'),
          heads: [...document.querySelectorAll('[data-part="table"] th')].map(th =>
            Math.round(th.getBoundingClientRect().x),
          ),
          pageWidth: [document.scrollingElement.scrollWidth, document.scrollingElement.clientWidth],
        };
      });
    // The bands just outside the visible text's box: from above its heading to its top edge, and from its bottom edge
    // to the end of the next heading.
    const bands = async () => {
      const g = await geometry();
      const [x, y, width, height] = g.box;
      const above = { x, y: g.visibleHead[1] - 8, width, height: y - (g.visibleHead[1] - 8) };
      const belowTop = y + height;
      const below = { x, y: belowTop, width, height: g.tableHead[1] + g.tableHead[3] - belowTop };
      return Promise.all([page.screenshot({ clip: above }), page.screenshot({ clip: below })]);
    };
    // Latin marks on the first line (the page's font overlaps most of them); on the second, Hebrew points: the fallback
    // font stacks them downwards, 25 pairs reach 82 px below the line (measured on the page), so 200 pairs make a tower.
    const flood = '\u{301}\u{30B}\u{316}\u{333}\u{337}'.repeat(800);
    const tower = `\u{5D0}${'\u{5B4}\u{5B7}'.repeat(200)}`;
    await text.fill('A\nB');
    await visibleBox.waitFor();
    await page.evaluate(() => document.activeElement?.blur());
    const before = await geometry();
    const [aboveBefore, belowBefore] = await bands();
    await put(`A${flood}\n${tower}`);
    await page.evaluate(() => document.activeElement?.blur());
    await sleep(100);
    const after = await geometry();
    const [aboveAfter, belowAfter] = await bands();
    await settledShot(shoot, page, 'tool-string-inspector-03-combining-flood-light.png');
    // The control: the same flood with the box's clipping switched off in the page paints over the bands — so the
    // comparison above can see a leak. The page's own style comes back right after.
    // Through the CSSOM (the page's policy refuses a style attribute), and removed again right after.
    await page.evaluate(() => {
      const box = document.querySelector('[data-part="visible"]');
      box.style.setProperty('overflow', 'visible');
      box.style.setProperty('contain', 'none');
    });
    await sleep(50);
    const [aboveOpen, belowOpen] = await bands();
    await page.evaluate(() => {
      const box = document.querySelector('[data-part="visible"]');
      box.style.removeProperty('overflow');
      box.style.removeProperty('contain');
    });
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const KEYS = ['title', 'field', 'summary', 'copy', 'visibleHead', 'box', 'tableHead'];
    const changed = {
      above: changedPixels(aboveBefore, aboveAfter),
      below: changedPixels(belowBefore, belowAfter),
      aboveUnclipped: changedPixels(aboveBefore, aboveOpen),
      belowUnclipped: changedPixels(belowBefore, belowOpen),
    };
    const leaks = changed.aboveUnclipped + changed.belowUnclipped > 20;
    check(
      'String Inspector: 4,000 combining marks on a letter and a tower of 400 Hebrew points paint only inside their box \u{2014} outside it nothing moves, no pixel changes; unclipped they would',
      KEYS.every(k => same(before[k], after[k])) && changed.above === 0 && changed.below === 0 && leaks,
      JSON.stringify({
        moved: KEYS.filter(k => !same(before[k], after[k])),
        box: [before.box, after.box],
        changedPixels: changed,
      }),
    );

    // Bidirectional overrides and isolates, Hebrew and Arabic: no control reaches the page outside the field, every box
    // of the person's text isolates, the table's columns stay in their order, nothing outside moves.
    // The same number of warning lines in both (an invisible character and a look-alike, against the invisible and the
    // bidirectional warnings), so the sections below the warnings are compared at the same height.
    await put('abc d\u{200B}ef \u{2014}ghi jkl (1) xyz\nmno');
    await page.evaluate(() => document.activeElement?.blur());
    const plain = await geometry();
    await put('\u{202E}abc \u{2067}def\u{2069} \u{5E9}\u{5DC}\u{5D5}\u{5DD} (1) \u{202D}ghi\nmno\u{202B}');
    await page.evaluate(() => document.activeElement?.blur());
    const bidi = await geometry();
    const bidiDom = await page.evaluate(() => {
      const walker = document.createTreeWalker(document.body, 4);
      let controls = 0;
      for (let n = walker.nextNode(); n; n = walker.nextNode())
        if (
          n.parentElement?.tagName !== 'TEXTAREA' &&
          /[\u{202A}-\u{202E}\u{2066}-\u{2069}\u{200E}\u{200F}\u{61C}]/u.test(n.textContent)
        )
          controls++;
      const isolates = [
        ...document.querySelectorAll('[data-part="visible"], [data-part="table"] bdi, bdi[data-word]'),
      ].map(el => `${el.getAttribute('dir')}:${getComputedStyle(el).unicodeBidi}`);
      return { controls, isolates: [...new Set(isolates)] };
    });
    await settledShot(shoot, page, 'tool-string-inspector-04-bidi-light.png');
    const increasing = xs => xs.every((x, i) => i === 0 || x > xs[i - 1]);
    check(
      'String Inspector: overrides and isolates never reach the page; the text\u{2019}s boxes isolate (dir="ltr"); columns and everything outside keep their place',
      bidiDom.controls === 0 &&
        bidiDom.isolates.every(s => s === 'ltr:isolate') &&
        increasing(bidi.heads) &&
        ['title', 'field', 'summary', 'copy', 'visibleHead', 'box', 'tableHead'].every(k => same(plain[k], bidi[k])),
      JSON.stringify({
        ...bidiDom,
        heads: bidi.heads.join(','),
        moved: ['title', 'field', 'summary', 'copy', 'visibleHead', 'box', 'tableHead'].filter(
          k => !same(plain[k], bidi[k]),
        ),
      }),
    );

    // A megabyte without a line break: the page does not widen, the box keeps its limit, the table its own.
    const timed = (v, settle) =>
      page.evaluate(
        async ([next, settleMs]) => {
          const field = document.querySelector('#string-inspector-input');
          const long = [];
          const observer = new PerformanceObserver(list => {
            for (const e of list.getEntries()) long.push([Math.round(e.startTime), Math.round(e.duration)]);
          });
          observer.observe({ type: 'longtask', buffered: false });
          const graphemes = () => document.querySelector('[data-summary="graphemes"] dd')?.textContent;
          const was = graphemes();
          const start = performance.now();
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, next);
          field.dispatchEvent(new Event('input', { bubbles: true }));
          const input = performance.now() - start;
          while (
            (document.querySelector('[data-part="input-message"]')?.textContent.trim() !== '' || graphemes() === was) &&
            performance.now() - start < 20_000
          )
            await new Promise(r => requestAnimationFrame(r));
          const elapsed = performance.now() - start;
          await new Promise(r => setTimeout(r, 200));
          observer.disconnect();
          const at = t => t - start;
          // Long tasks before the settle are the text box's (the field and React's render of it); after it, the tool's.
          const box = long.filter(([t]) => at(t) < settleMs).map(([, d]) => d);
          const tool = long.filter(([t]) => at(t) >= settleMs).map(([, d]) => d);
          return {
            input: Math.round(input),
            elapsed: Math.round(elapsed),
            boxLongest: Math.max(0, ...box),
            toolLongest: Math.max(0, ...tool),
            graphemes: graphemes(),
          };
        },
        [v, settle],
      );
    await put('');
    const oneLine = await timed('x'.repeat(logic.MAX_INPUT), logic.SETTLE_MS);
    const wide = await geometry();
    const limits = [
      await page.locator('[data-part="visible-limit"]').innerText(),
      await page.locator('[data-part="table-limit"]').innerText(),
      await page.locator('[data-part="table"] tbody tr').count(),
    ];
    check(
      'String Inspector: a megabyte on one line widens nothing; the visible text and the table show their first 10,000 and 1,000',
      wide.pageWidth[0] <= wide.pageWidth[1] &&
        wide.box[3] <= 362 &&
        limits[0] === 'Showing the first 10,000 of 1,048,576 code points.' &&
        limits[1] === 'Showing the first 1,000 of 1,048,576 code points.' &&
        limits[2] === 1000 &&
        oneLine.graphemes === '1,048,576',
      JSON.stringify({ pageWidth: wide.pageWidth, box: wide.box, limits, oneLine }),
    );

    // §12, timed in Chrome: a megabyte of mixed text — 300 ms after the last edit, the passes over it in the worker;
    // the field's own cost apart. And the segmenter alone on the page, for the record.
    await put('');
    const mixed = await timed(sample(logic.MAX_INPUT), logic.SETTLE_MS);
    await put('');
    const live = await timed(sample(logic.LIVE_INPUT), 0);
    const segmenter = await page.evaluate(n => {
      const unitText = n;
      const g = new Intl.Segmenter('en', { granularity: 'grapheme' });
      const w = new Intl.Segmenter('en', { granularity: 'word' });
      const t0 = performance.now();
      let k = 0;
      for (const segment of g.segment(unitText)) if (segment) k++;
      const t1 = performance.now();
      let words = 0;
      for (const s of w.segment(unitText)) if (s.isWordLike) words++;
      const t2 = performance.now();
      return { graphemes: k, graphemeMs: Math.round(t1 - t0), words, wordMs: Math.round(t2 - t1) };
    }, sample(logic.MAX_INPUT));
    const expected = logic.summarize(sample(logic.MAX_INPUT));
    check(
      'String Inspector: \u{A7}12 a megabyte of mixed text counted after the pause in the worker, no task of the tool over 200 ms; 64 Ki at once',
      mixed.graphemes === expected.graphemes.toLocaleString('en-US') &&
        mixed.elapsed >= logic.SETTLE_MS &&
        mixed.toolLongest < 200 &&
        live.elapsed < 300,
      `1 Mi: results in ${mixed.elapsed} ms, setting the field ${mixed.input} ms, longest task of the text box ${mixed.boxLongest} ms, of the tool ${mixed.toolLongest} ms; 64 Ki: ${live.elapsed} ms (longest task ${live.toolLongest} ms); Intl.Segmenter on the page over 1 Mi: graphemes ${segmenter.graphemeMs} ms, words ${segmenter.wordMs} ms`,
    );

    // Above 1 Mi: the refusal at once, no results.
    await put('x'.repeat(logic.MAX_INPUT + 1));
    const refusal = await page.locator('[data-part="input-message"]').innerText();
    check(
      'String Inspector: above 1 MB the tool refuses in words (role status) and shows no results',
      refusal === 'Text is larger than 1 MB. String Inspector works with up to 1 MB.' &&
        (await page.locator('[data-part="input-message"]').getAttribute('role')) === 'status' &&
        (await page.locator('[data-summary]').count()) === 0,
      refusal,
    );
    await settledShot(shoot, page, 'tool-string-inspector-05-too-large-light.png');
    await put('');
    await sleep(100);

    // The keyboard (§8): the field, Copy summary, the visible text's box, Copy table, the table's box.
    await text.fill('a\u{200B}b');
    await visibleBox.waitFor();
    await text.focus();
    const order = [];
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab');
      order.push(
        await page.evaluate(
          () => document.activeElement.getAttribute('aria-label') || document.activeElement.textContent,
        ),
      );
    }
    check(
      'String Inspector: Tab goes from the field to Copy summary, the visible text, Copy table and the table',
      order.join('|') ===
        'Copy summary|The text with its invisible characters marked|Copy table|Characters, one row per code point',
      order.join(' \u{2192} '),
    );

    // D17: a copied summary is in the tool's own history — its label counts only, never the text — and opens back.
    await text.fill('pass\u{202E}word\u{200B}');
    await button('Copy summary').click();
    const label = '10 characters \u{B7} 14 UTF-8 bytes \u{B7} 2 invisible \u{B7} copied summary';
    const record = await waitForHistoryRecord(page, 'string-inspector', r => r.label === label).catch(() => null);
    await go('#/start');
    await page.waitForFunction(() => location.hash === '#/start');
    await go('#/tools/string-inspector');
    await text.waitFor();
    const recent = page.locator('.kit-tool-history-recent');
    await recent.locator('summary').waitFor({ timeout: 5_000 });
    await recent.locator('summary').click();
    const entry = recent.locator('.kit-history-entry', { hasText: label }).first();
    const listed = await entry.count();
    if (listed) await entry.getByRole('button', { name: 'Open' }).click();
    await page
      .locator('[data-restored]')
      .waitFor({ timeout: 5_000 })
      .catch(() => {});
    const back = {
      record: record?.kind ?? null,
      listed,
      kind: listed ? await entry.locator('.kit-history-entry-kind').innerText() : null,
      text: await text.inputValue(),
      visible: await shownText(),
    };
    check(
      'String Inspector: a copied summary is in the tool\u{2019}s history as Inspected, its label counts only, and it opens back',
      back.record === 'inspect' &&
        back.listed > 0 &&
        back.kind === 'Inspected' &&
        back.text === 'pass\u{202E}word\u{200B}' &&
        back.visible === 'pass[RLO]word[ZWSP]' &&
        !/[^\x20-\x7e\u{B7}]/u.test(record?.label ?? 'x'),
      JSON.stringify(back),
    );

    // The page in the light and the dark theme (entered afresh: "Recent entries" closed).
    await go('#/start');
    await page.waitForFunction(() => location.hash === '#/start');
    await go('#/tools/string-inspector');
    await text.waitFor();
    await text.fill(`p\u{430}ypal.com api\u{200B}_key \u{201C}quoted\u{201D} ${FAMILY} e\u{301}\u{202E}abc\u{202C}`);
    await visibleBox.waitFor();
    await settledShot(shoot, page, 'tool-string-inspector-06-warnings-light.png');
    await inDarkTheme(ctx, base, page, async () => {
      await page.waitForFunction(() => document.documentElement.dataset.mode === 'dark', null, { timeout: 5_000 });
      await sleep(300);
      await settledShot(shoot, page, 'tool-string-inspector-07-warnings-dark.png');
      await put(`A${flood}\n${tower}`);
      await sleep(100);
      await settledShot(shoot, page, 'tool-string-inspector-08-combining-flood-dark.png');
    });
    await put('');
  } finally {
    await clipboard.restore().catch(() => {});
  }
};
