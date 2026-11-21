// The HTML Entities tool in the built extension (docs/tools/specs/html-entities.md): its scenarios (§2) with the page's
// real controls, the notes (§6), the keyboard (§8), the limits timed in the browser (§12), the table of names loading
// only when needed, pasting into the start page's field (§7), an entry opened back from the tool's history (D17), the
// page in the light and the dark theme — and the decoder's agreement with the browser's own parser: every name of the
// table and a set of malformed references, decoded by the tool's page and by DOMParser on a whole document (inert:
// nothing loads, nothing runs), text and attribute values, every difference listed in the report. Run by
// scripts/e2e-tools.mjs; navigates by replacing the current history entry (Chrome keeps 50 per tab, shared by modules).

/* global document, location, DOMParser, HTMLTextAreaElement, requestAnimationFrame, DataTransfer, ClipboardEvent -- page.evaluate callbacks run in the page */

import { inDarkTheme, settledShot, stubClipboard, waitForHistoryRecord } from '../e2e-helpers.mjs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const T = 'HTML Entities';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOGIC = pathToFileURL(join(ROOT, 'packages/tools/logic/html-entities/src/index.ts')).href;

/** The Decode rows of the specification's §10 (the one with markup is checked on its own below). */
const SPEC_ROWS = [
  '&lt;p&gt;Tom &amp; Jerry&lt;/p&gt;',
  '&quot;&#39;&apos;',
  '&eacute;&#233;&#xE9;&#XE9;',
  '&copy 2024',
  '&amp',
  '&lt3',
  '&notit;',
  '&ampx;',
  '&copy=1',
  'AT&T &unknown; & x',
  '&unknown; &amp; &copyx; &foo; &foo; &Amp;',
  '&AMP;&Amp;',
  '&#128512;&#x1F600;',
  '&#0;&#x110000;&#xD800;',
  '&#99999999999999;',
  '&#128;&#x9F;&#150;',
  '&#x81;&#x8D;&#x8F;&#x90;&#x9D;',
  '&#x7F;',
  '&#13;',
  '&#65',
  '&#0065;',
  '&#x;',
  '&amp;lt;',
  '&NotEqualTilde;',
  '&nbsp;',
  '&hellip;',
  '  &lt;  ',
  '\n&lt;',
  'a\u0000b',
];

/** References the table alone does not cover: numbers, malformed names, the edges of the character reference states. */
const MALFORMED = [
  ...SPEC_ROWS,
  '&',
  '&&',
  '& ',
  '&;',
  '&#',
  '&#;',
  '&#x',
  '&#x;',
  '&#X;',
  '&#xg;',
  '&# 65;',
  '&#x 41;',
  '&#65',
  '&#065;',
  '&#X41;',
  '&#x41',
  `&#${'0'.repeat(60)}65;`,
  `&#x${'0'.repeat(60)}41;`,
  '&#0;',
  '&#x0;',
  '&#1;',
  '&#9;',
  '&#10;',
  '&#11;',
  '&#13;',
  '&#x0D;',
  '&#31;',
  '&#127;',
  ...Array.from({ length: 32 }, (_, i) => `&#x${(0x80 + i).toString(16).toUpperCase()};`),
  '&#xA0;',
  '&#xD7FF;',
  '&#xD800;',
  '&#xDBFF;&#xDC00;',
  '&#55357;&#56832;',
  '&#xDFFF;',
  '&#xFDD0;',
  '&#xFFFE;',
  '&#xFFFF;',
  '&#x1FFFF;',
  '&#x10FFFF;',
  '&#x110000;',
  '&#1114112;',
  '&#99999999999999;',
  `&#${'9'.repeat(80)};`,
  `&#x${'F'.repeat(80)};`,
  '&#x1F600;',
  '&#128512',
  '&unknown;',
  '&Amp;',
  '&AMP',
  '&ampamp;',
  '&amp;amp;',
  '&&amp;',
  '&#38;amp;',
  '&notit;',
  '&notin',
  '&noti',
  '&not;in',
  '&copy=1',
  '&copyright',
  '&copy2024',
  '&lt3',
  '&gt=',
  '&a',
  '&a;',
  '&1;',
  '&_x;',
  `&${'a'.repeat(40)};`,
  `&not${'a'.repeat(40)};`,
  'AT&T',
  'a & b && c',
  '&nbsp',
  '&nbsp;x',
  '&NotEqualTilde;',
  '&fjlig;',
  '&ThickSpace;',
  '&CounterClockwiseContourIntegral;',
  '&CounterClockwiseContourIntegra;',
  '&CounterClockwiseContourIntegrall;',
  '&lt;script&gt;alert(1)&lt;/script&gt;',
  '?a=1&b=2&lang=en&copy=3',
  'a\r\nb\rc&#13;',
  'a\u0000b',
  '&\u0000amp;',
];

/**
 * The tool's decoder in Node, as a separate process (its logic is TypeScript; Node strips the types): the table's
 * names, the inputs built from them and the malformed ones, and what the decoder makes of each in text and in an
 * attribute value.
 */
const NODE_SIDE = `
import { readFileSync } from 'node:fs';
const { decodeHtml, loadReferenceTable } = await import(process.argv[1]);
const malformed = JSON.parse(readFileSync(0, 'utf8'));
const table = await loadReferenceTable();
const keys = [...table.keys()];
const legacy = keys.filter(k => !k.endsWith(';'));
const items = [...new Set([
  ...keys.map(k => '&' + k),
  ...keys.filter(k => k.endsWith(';')).map(k => '&' + k.slice(0, -1)),
  ...legacy.flatMap(k => ['&' + k + 'x', '&' + k + '=', '&' + k + '9', '&' + k + ';x']),
  ...malformed,
])];
process.stdout.write(JSON.stringify({
  size: table.size,
  names: keys.length,
  items,
  text: items.map(i => decodeHtml(i, table).text),
  attribute: items.map(i => decodeHtml(i, table, { context: 'attribute' }).text),
}));
`;

/** U+E000 (private use) separates the inputs of one batch: nothing here decodes to it, and it ends no reference. */
const SEP = '';

const show = s => JSON.stringify(s).slice(0, 80);

export default async ({ ctx, page, base, check, shoot, sleep, report }) => {
  const frame = page.locator('[data-slot="tool-page"]');
  const input = page.getByLabel('Input');
  const result = page.getByLabel('Result');
  const notes = page.locator('[data-part="note"]');
  const errorLine = page.locator('[data-part="error"]');
  const radio = name => page.getByRole('radio', { name, exact: true });
  const button = name => page.getByRole('button', { name, exact: true });
  const choose = async (id, option) => {
    await page.locator(`#${id}`).click();
    await page.getByRole('option', { name: option, exact: true }).click();
  };
  const noteText = async () => (await notes.allInnerTexts()).map(t => t.trim()).filter(Boolean);
  // Chrome keeps at most 50 entries of a tab's history, and the modules after this one count them: go by replacing the
  // current entry.
  const go = async hash => {
    // The first visit of a run may start from another page: one ordinary navigation, then replacements.
    if (!page.url().startsWith(base)) await page.goto(`${base}${hash}`);
    else await page.evaluate(url => location.replace(url), `${base}${hash}`);
    await page.waitForFunction(h => location.hash === h, hash, { timeout: 5000 });
  };
  // What the page fetched from the package, as the browser's network events see it (resource timing leaves out an
  // extension's own files).
  const fetched = [];
  const onRequest = request => fetched.push(request.url());
  page.on('request', onRequest);
  const resources = async () => [...fetched];
  /** Waits until the result has settled on a value (the table may still be loading). */
  const resultOf = async () => {
    await page.waitForFunction(() => document.querySelector('#html-entities-output').value !== '', null, {
      timeout: 5000,
    });
    return result.inputValue();
  };

  // The start route never loads the tool or its table; opening the tool loads its chunk, the table waits for a name.
  await go('#/start');
  fetched.length = 0;
  await page.reload();
  await page.getByRole('combobox', { name: 'Find a tool or search the web' }).waitFor();
  await sleep(500); // what loads after the first paint (the detectors)
  const onStart = await resources();
  await go('#/tools/html-entities');
  await input.waitFor();
  check(
    `${T}: opens empty in Encode — Only & < > " ', Numbers as off, Copy and Swap off`,
    (await radio('Encode').getAttribute('aria-checked')) === 'true' &&
      (await input.inputValue()) === '' &&
      (await input.getAttribute('placeholder')) === 'Text to escape' &&
      (await page.locator('#html-entities-scope').innerText()).includes(`Only & < > " '`) &&
      (await page.locator('#html-entities-format').isDisabled()) &&
      (await button('Copy').isDisabled()) &&
      (await button('Swap').isDisabled()),
  );
  await input.fill('Tom & Jerry <3');
  const afterEncode = await resources();
  await radio('Decode').click();
  await input.fill('Tom &amp; Jerry');
  await resultOf();
  const afterName = await resources();
  const table = names => names.filter(n => /namedReferences\.generated/.test(n)).length;
  check(
    `${T}: the table of names is not on the start route or in detect; it loads on the first name, not with the page`,
    !onStart.some(n => /HtmlEntitiesTool|namedReferences/.test(n)) &&
      onStart.some(n => /detectors/.test(n)) &&
      afterEncode.some(n => /HtmlEntitiesTool/.test(n)) &&
      table(afterEncode) === 0 &&
      table(afterName) === 1,
    `start: ${onStart.filter(n => /assets/.test(n)).length} chunks; tool open: table ${table(afterEncode)}; after a name: ${table(afterName)}`,
  );

  const clipboard = await stubClipboard(page);
  try {
    // §2.1 — what an API sent.
    await input.fill('&lt;p&gt;Tom &amp; Jerry&lt;/p&gt;');
    check(
      `${T}: §2.1 Decode &lt;p&gt;Tom &amp; Jerry&lt;/p&gt; — <p>Tom & Jerry</p>`,
      (await resultOf()) === '<p>Tom & Jerry</p>' &&
        (await input.getAttribute('placeholder')) === 'Text with &amp; and other references' &&
        (await page.locator('#html-entities-scope').count()) === 0,
    );

    // §2.4 — a name without its semicolon; §2.6 — a typo.
    await input.fill('&copy 2024 ACME');
    const copyNoSemicolon = await resultOf();
    await input.fill('a&nbps;b &unknown; &foo; &unknown;');
    const typo = await resultOf();
    const typoNote = await noteText();
    check(
      `${T}: §2.4 &copy 2024 decodes as in the browser; §2.6 a typo stays and is named`,
      copyNoSemicolon === '© 2024 ACME' &&
        typo === 'a&nbps;b &unknown; &foo; &unknown;' &&
        typoNote.join('|') === 'Not recognised, left as is: &nbps;, &unknown;, &foo;',
      `${show(copyNoSemicolon)} · ${typoNote.join('|')}`,
    );
    await settledShot(shoot, frame, 'tool-html-entities-02-decode-unknown-light.png');

    // §6: markup in the input is text — nothing is built, loaded or run.
    await page.evaluate(() => delete document.documentElement.dataset.heProbe);
    await input.fill('</textarea><img src=x onerror="document.documentElement.dataset.heProbe=1">&amp;');
    const markup = await resultOf();
    await sleep(200);
    check(
      `${T}: §6 markup in Decode stays text; no element, no handler, no request`,
      markup === '</textarea><img src=x onerror="document.documentElement.dataset.heProbe=1">&' &&
        (await page.evaluate(() => document.querySelectorAll('img[src="x"]').length)) === 0 &&
        (await page.evaluate(() => document.documentElement.dataset.heProbe)) === undefined &&
        !(await resources()).some(n => n.endsWith('/x')),
    );

    // §2.2 — a code sample for an article, Copy.
    await radio('Encode').click();
    await input.fill(`<a href="x">Tom & 'Jerry'</a>`);
    const sample = await result.inputValue();
    await button('Copy').click();
    await button('Copied').waitFor({ timeout: 2000 });
    const copied = await clipboard.copied();
    check(
      `${T}: §2.2 Encode a code sample and Copy it`,
      sample === '&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;' && copied.at(-1) === sample,
      show(copied.at(-1)),
    );

    // §2.5 — text that already has references, encoded again with the note.
    await input.fill('Tom &amp; Jerry');
    await page.waitForFunction(() => document.querySelector('[data-part="note"]')?.textContent.trim() !== '', null, {
      timeout: 5000,
    });
    const again = await result.inputValue();
    const againNote = await noteText();
    check(
      `${T}: §2.5 &amp; is encoded again, with the note`,
      again === 'Tom &amp;amp; Jerry' &&
        againNote.join('|') ===
          'The input already contains HTML references. They are encoded again: &amp; becomes &amp;amp;.',
      againNote.join('|'),
    );
    await settledShot(shoot, frame, 'tool-html-entities-01-encode-again-light.png');

    // §2.3 — ASCII only: Also non-ASCII, Hex; C1 controls stay and are counted.
    await choose('html-entities-scope', 'Also non-ASCII');
    await choose('html-entities-format', 'Hex');
    await input.fill('café 😀 — “q”');
    const ascii = await result.inputValue();
    await input.fill('\u0080 and \u009F');
    const c1Note = await noteText();
    check(
      `${T}: §2.3 Also non-ASCII, Hex — one reference per code point; C1 left as is with the note`,
      ascii === 'caf&#xE9; &#x1F600; &#x2014; &#x201C;q&#x201D;' &&
        (await result.inputValue()) === '\u0080 and \u009F' &&
        c1Note.join('|') === '2 C1 control characters (U+0080–U+009F) left as is: HTML has no reference for them.',
      `${show(ascii)} · ${c1Note.join('|')}`,
    );
    await input.fill('<p class="note">Café — “déjà vu” 😀</p>');
    await settledShot(shoot, frame, 'tool-html-entities-03-encode-non-ascii-light.png');

    // Swap: the result into the input, the direction turned, the options kept.
    const there = await result.inputValue();
    await button('Swap').click();
    const back = await resultOf();
    check(
      `${T}: Swap moves the result into the input and turns to Decode; Encode’s options are kept`,
      (await input.inputValue()) === there &&
        (await radio('Decode').getAttribute('aria-checked')) === 'true' &&
        back === '<p class="note">Café — “déjà vu” 😀</p>',
    );
    await radio('Encode').click();
    const keptOptions =
      (await page.locator('#html-entities-scope').innerText()).includes('Also non-ASCII') &&
      (await page.locator('#html-entities-format').innerText()).includes('Hex');

    // §8: the keyboard — Tab passes direction, Encode, Numbers as, Swap, Input, Copy, Result; arrows switch.
    await input.fill('keyboard &');
    await radio('Encode').focus();
    const order = [];
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      order.push(
        await page.evaluate(() => {
          const el = document.activeElement;
          return el.labels?.[0]?.textContent || el.getAttribute('aria-label') || el.textContent.trim().slice(0, 20);
        }),
      );
    }
    await radio('Encode').focus();
    await page.keyboard.press('ArrowRight');
    await sleep(100);
    const onDecode = await radio('Decode').evaluate(el => el === document.activeElement);
    await page.keyboard.press('Space');
    const arrowed = onDecode && (await radio('Decode').getAttribute('aria-checked')) === 'true';
    check(
      `${T}: §8 Tab order is direction, Encode, Numbers as, Swap, Input, Copy, Result; arrows and Space switch; options kept`,
      order.join(' → ') === 'Encode → Numbers as → Swap → Input → Copy → Result' && arrowed && keptOptions,
      `${order.join(' → ')}; arrow ${onDecode}, Space ${arrowed}; options kept ${keptOptions}`,
    );
    await radio('Encode').click();
    await choose('html-entities-scope', `Only & < > " '`);

    // The decoder against the browser's parser: every name of the table and the malformed set.
    let node;
    try {
      node = JSON.parse(
        execFileSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', NODE_SIDE, LOGIC], {
          input: JSON.stringify(MALFORMED),
          maxBuffer: 64 * 1024 * 1024,
        }).toString('utf8'),
      );
    } catch (error) {
      node = { error: String(error).slice(0, 400) };
    }
    if (node.error) check(`${T}: the decoder runs in Node (TypeScript stripped by Node 22.18+)`, false, node.error);
    else {
      const browser = await page.evaluate(
        ([items, sep]) => {
          const parse = html =>
            new DOMParser().parseFromString(`<!doctype html><html><head></head><body>${html}`, 'text/html');
          const text = parse(items.join(sep)).body.textContent.split(sep);
          const attrs = [...parse(items.map(i => `<p title="${i}"></p>`).join('')).querySelectorAll('p')].map(p =>
            p.getAttribute('title'),
          );
          return { text, attrs };
        },
        [node.items, SEP],
      );
      // The tool's page on the same inputs (one batch; the field turns CR into LF and cannot hold U+0000, so inputs
      // with those go through Node only), read through Copy — the exact result, not the field's view.
      const batch = node.items
        .map((item, i) => [item, i])
        .filter(([item]) => !item.includes('\r') && !item.includes('\u0000'));
      await radio('Decode').click();
      await page.evaluate(
        ([value]) => {
          const field = document.querySelector('#html-entities-input');
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, value);
          field.dispatchEvent(new Event('input', { bubbles: true }));
        },
        [batch.map(([item]) => item).join(SEP)],
      );
      await resultOf();
      await button('Copy').click();
      await button('Copied').waitFor({ timeout: 2000 });
      const fromPage = (await clipboard.copied()).at(-1).split(SEP);

      const differences = [];
      const expected = [];
      node.items.forEach((item, i) => {
        const note = (where, ours, theirs) => {
          // §5, «Раскодирование» 8: U+0000 stays (the parser drops it from text and makes U+FFFD of it in attributes).
          (item.includes('\u0000') ? expected : differences).push({ where, item, ours, browser: theirs });
        };
        if (node.text[i] !== browser.text[i]) note('text', node.text[i], browser.text[i]);
        if (node.attribute[i] !== browser.attrs[i]) note('attribute', node.attribute[i], browser.attrs[i]);
      });
      const pageDiffers = batch.filter(([, i], k) => fromPage[k] !== node.text[i]).map(([item]) => item);
      report.htmlEntities = {
        tableEntries: node.size,
        inputs: node.items.length,
        throughThePage: batch.length,
        differences,
        expectedDifferences: expected,
        pageDiffersFromNode: pageDiffers,
      };
      check(
        `${T}: the decoder agrees with the browser’s parser on all ${node.names} names and ${node.items.length - node.names} more inputs, text and attribute values`,
        node.size === 2231 && browser.text.length === node.items.length && differences.length === 0,
        `${node.items.length} inputs; ${differences.length} differences${
          differences.length
            ? `: ${differences
                .slice(0, 5)
                .map(d => `${d.where} ${show(d.item)} ours ${show(d.ours)} browser ${show(d.browser)}`)
                .join('; ')}`
            : ''
        }; expected (U+0000, §5.8): ${expected.map(d => `${d.where} ${show(d.item)} ours ${show(d.ours)} browser ${show(d.browser)}`).join('; ')}`,
      );
      check(
        `${T}: the page decodes the same ${batch.length} inputs as the logic in Node`,
        fromPage.length === batch.length && pageDiffers.length === 0,
        `${fromPage.length} results; ${pageDiffers.length} differ${pageDiffers.length ? `: ${pageDiffers.slice(0, 5).map(show).join(', ')}` : ''}`,
      );
    }

    // §12: the limits, timed in the browser. Up to 1 Mi the result follows every edit, then SETTLE_MS after the last;
    // above 5 Mi the tool refuses at once. `longest` is the longest task the page ran meanwhile.
    const timed = (text, expectLength) =>
      page.evaluate(
        async ([value, want]) => {
          const field = document.querySelector('#html-entities-input');
          const out = document.querySelector('#html-entities-output');
          let longest = 0;
          const observer = new PerformanceObserver(list => {
            for (const e of list.getEntries()) longest = Math.max(longest, e.duration);
          });
          observer.observe({ type: 'longtask', buffered: false });
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
          const start = performance.now();
          setter.call(field, value);
          field.dispatchEvent(new Event('input', { bubbles: true }));
          while (out.value.length !== want && performance.now() - start < 15_000)
            await new Promise(r => requestAnimationFrame(r));
          const elapsed = performance.now() - start;
          await new Promise(r => setTimeout(r, 100));
          observer.disconnect();
          return { elapsed: Math.round(elapsed), longest: Math.round(longest), length: out.value.length };
        },
        [text, expectLength],
      );
    const unit = '&lt;p&gt;Tom &amp; Jerry&lt;/p&gt; &copy &#xE9; '; // 47 characters, 6 references → 23
    const decodedUnit = '<p>Tom & Jerry</p> © é '.length;
    const units = n => Math.floor(n / unit.length);
    await radio('Decode').click();
    await input.fill('');
    const live = await timed(unit.repeat(units(1024 * 1024)), units(1024 * 1024) * decodedUnit);
    await input.fill('');
    const max = await timed(unit.repeat(units(5 * 1024 * 1024)), units(5 * 1024 * 1024) * decodedUnit);
    await input.fill('');
    // The same with an emoji in every unit: the decoding is as fast (Node: about 100 ms for 5 Mi), but Chrome lays out
    // the 2.5 Mi result with ~110,000 emoji in the field for seconds — measured and reported, not a limit of the tool.
    const emojiUnit = '&lt;p&gt;Tom &amp; Jerry&lt;/p&gt; &#x1F600; ';
    const emojiUnits = Math.floor((5 * 1024 * 1024) / emojiUnit.length);
    const emoji = await timed(emojiUnit.repeat(emojiUnits), emojiUnits * '<p>Tom & Jerry</p> 😀 '.length);
    await input.fill('');
    const amps = await timed('&'.repeat(300_000), 300_000);
    await input.fill('');
    const ampNames = await timed('&a'.repeat(150_000), 300_000);
    await input.fill('');
    await radio('Encode').click();
    const encodeText = 'Tom & Jerry <3 '.repeat(349_525); // 5,242,875 characters, two to escape in each 15
    const encodeMax = await timed(encodeText, encodeText.length + 349_525 * 7);
    const refused = await timed(`${'a'.repeat(5 * 1024 * 1024)}b`, 0);
    const refusal = (await errorLine.innerText()).trim();
    check(
      `${T}: §12 1 Mi follows the edit at once; 5 Mi decodes and encodes after the pause; 300,000 ampersands; one over 5 Mi refuses`,
      live.length === units(1024 * 1024) * decodedUnit &&
        live.elapsed < 300 &&
        max.length === units(5 * 1024 * 1024) * decodedUnit &&
        max.longest < 1000 &&
        emoji.length === emojiUnits * '<p>Tom & Jerry</p> 😀 '.length &&
        amps.length === 300_000 &&
        ampNames.length === 300_000 &&
        encodeMax.length === encodeText.length + 349_525 * 7 &&
        refusal === 'Input is larger than 5 MB. This tool works with up to 5 MB.' &&
        refused.length === 0,
      `1 Mi decode ${live.elapsed} ms (longest task ${live.longest} ms); 5 Mi decode ${max.elapsed} ms (longest ${max.longest} ms); 5 Mi decode to ${emojiUnits.toLocaleString('en-US')} emoji ${emoji.elapsed} ms (longest ${emoji.longest} ms, the field's layout); 300,000 × & ${amps.elapsed} ms (longest ${amps.longest} ms); 150,000 × &a ${ampNames.elapsed} ms (longest ${ampNames.longest} ms); 5 Mi encode ${encodeMax.elapsed} ms (longest ${encodeMax.longest} ms); 5 Mi + 1 refused in ${refused.elapsed} ms`,
    );
    report.htmlEntitiesTimings = { live, max, emoji, amps, ampNames, encodeMax, refused };
    await input.fill('');

    // D17: what was taken (Copy) is in the tool's history and opens back into the tool.
    await radio('Decode').click();
    await input.fill('&eacute;t&eacute; &amp; &#x1F600;');
    await resultOf();
    await button('Copy').click();
    await button('Copied').waitFor({ timeout: 2000 });
    const record = await waitForHistoryRecord(
      page,
      'html-entities',
      r => r.label === 'Decode · 33 characters · copied',
    ).catch(() => null);
    await go('#/start');
    await go('#/tools/html-entities');
    await page.reload();
    await input.waitFor();
    const recent = page.locator('.kit-tool-history-recent');
    await recent.locator('summary').click();
    const entry = recent.locator('.kit-history-entry', { hasText: 'Decode · 33 characters · copied' }).first();
    await entry.waitFor({ timeout: 5000 }).catch(() => {});
    const listed = await entry.count();
    if (listed) await entry.getByRole('button', { name: 'Open' }).click();
    await page
      .locator('[data-restored]')
      .waitFor({ timeout: 5000 })
      .catch(() => {});
    const restored = {
      record: record?.label,
      listed,
      kind: listed ? await entry.locator('.kit-history-entry-kind').innerText() : null,
      input: await input.inputValue(),
      decode: await radio('Decode').getAttribute('aria-checked'),
      result: await result.inputValue().catch(() => null),
    };
    check(
      `${T}: a copied result is in the tool’s history as Decoded and opens back into the tool`,
      restored.record === 'Decode · 33 characters · copied' &&
        restored.listed > 0 &&
        restored.kind === 'Decoded' &&
        restored.input === '&eacute;t&eacute; &amp; &#x1F600;' &&
        restored.decode === 'true' &&
        restored.result === 'été & 😀',
      JSON.stringify(restored),
    );
  } finally {
    await clipboard.restore();
  }

  // §7: text with references pasted into the start page's field opens the tool in Decode; other text does not.
  const paste = async text => {
    await go('#/start');
    const field = page.getByRole('combobox', { name: 'Find a tool or search the web' });
    await field.waitFor();
    await field.fill('');
    await field.focus();
    await page.evaluate(value => {
      const data = new DataTransfer();
      data.setData('text/plain', value);
      document.activeElement.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    }, text);
  };
  await paste('Tom &amp; Jerry &lt;3');
  await page.waitForFunction(() => location.hash === '#/tools/html-entities', null, { timeout: 5000 }).catch(() => {});
  await input.waitFor({ timeout: 5000 }).catch(() => {});
  const opened = {
    hash: await page.evaluate(() => location.hash),
    input: await input.inputValue().catch(() => null),
    decode: await radio('Decode')
      .getAttribute('aria-checked')
      .catch(() => null),
    result: await resultOf().catch(() => null),
  };
  check(
    `${T}: §7 text with references pasted into the start page opens the tool in Decode with it`,
    opened.hash === '#/tools/html-entities' &&
      opened.input === 'Tom &amp; Jerry &lt;3' &&
      opened.decode === 'true' &&
      opened.result === 'Tom & Jerry <3',
    JSON.stringify(opened),
  );
  const notOurs = [];
  for (const text of ['AT&T', '&copy 2024', 'https://example.com/?a=1&b=2', '&unknown;', '<p>&nbsp;</p>', 'a && b']) {
    await paste(text);
    await sleep(300);
    if ((await page.evaluate(() => location.hash)) === '#/tools/html-entities') notOurs.push(text);
  }
  check(
    `${T}: §7 AT&T, &copy 2024, a URL with a query, an unknown name, markup, a && b do not open it`,
    notOurs.length === 0,
    notOurs.join(', '),
  );

  // The page in the dark theme, then the theme mode as it was.
  await go('#/tools/html-entities');
  await page.reload();
  await input.waitFor();
  await inDarkTheme(ctx, base, page, async () => {
    await input.fill('<a href="?q=1&lang=en">Tom & \'Jerry\'</a>');
    await settledShot(shoot, frame, 'tool-html-entities-04-encode-dark.png');
    await radio('Decode').click();
    await input.fill('&copy 2024 &mdash; &eacute;t&eacute; &#x1F600; &nbps; &amp;amp;');
    await resultOf();
    await settledShot(shoot, frame, 'tool-html-entities-05-decode-dark.png');
  });
  await input.fill('');
  await go('#/start');
  page.off('request', onRequest);
};
