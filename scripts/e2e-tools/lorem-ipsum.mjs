// The Lorem Ipsum tool in the built extension (docs/tools/specs/lorem-ipsum.md): where the host lists it, its scenarios
// (§2) with the page's real controls, the largest texts the limits allow (§12: how long from the edit to the painted
// text, the longest task meanwhile, and a text box of the same text set on its own — the text box's own cost), and its
// history (D17): Generate writes one entry in clear with the settings and no text; Recent entries opens it back with
// the same settings and a new text, and the page says so; the settings are kept as saved parameters (D21) and the page
// opened again makes its first text with them. Copying is checked against the page's own stand-in for
// navigator.clipboard.writeText (nothing reaches the machine's clipboard), put back before the module ends. The theme is
// put back too. Run by scripts/e2e-tools.mjs; screenshots tool-lorem-ipsum-NN-….png.

/* global chrome, document, location, requestAnimationFrame, HTMLInputElement -- page.evaluate callbacks run in the page */

import {
  forgetSavedParameters,
  historyRecords,
  inDarkTheme,
  settledShot,
  stubClipboard,
  waitForHistoryRecord,
} from '../e2e-helpers.mjs';

const T = 'Lorem Ipsum';
const ID = 'lorem-ipsum';
const CLASSIC = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.';
const LINE = /^([\d,]+) words? · ([\d,]+) characters?$/;

export default async ({ ctx, page, base, check, shoot, sleep, report }) => {
  const opened = [];
  const open = async hash => {
    const p = await ctx.newPage();
    p.on('console', m => {
      if (m.type() === 'error' || m.type() === 'warning')
        report.console.push({ type: m.type(), text: m.text(), url: m.location().url });
    });
    p.on('pageerror', e => report.console.push({ type: 'pageerror', text: String(e) }));
    await p.goto(`${base}${hash}`);
    opened.push(p);
    return p;
  };
  let clipboard = null;
  /**
   * The tool afresh: reloaded (not a new history entry of the tab), every setting back to its default. The settings are
   * saved parameters: a change of the last 400 ms lands first, then they are forgotten and the page is read anew.
   */
  const fresh = async () => {
    const hash = `#/tools/${ID}`;
    if (!page.url().startsWith(base)) await page.goto(`${base}${hash}`);
    else await page.evaluate(url => location.replace(url), `${base}${hash}`);
    await page.waitForFunction(h => location.hash === h, hash, { timeout: 5_000 });
    await sleep(500);
    await forgetSavedParameters(page, ID);
    await page.reload();
    // The tool's own element, not the heading: the page says "Loading…" until its history is open.
    await page.locator('[data-status]').waitFor();
    clipboard = await stubClipboard(page);
  };
  const button = name => page.getByRole('button', { name, exact: true });
  const radio = name => page.getByRole('radio', { name, exact: true });
  const field = page.locator('#lorem-ipsum-result');
  const result = () => field.inputValue();
  const line = () => page.locator('[data-status]').innerText();
  const count = page.getByLabel('Count', { exact: true });
  const opening = page.getByRole('checkbox', { name: 'Start with "Lorem ipsum…"' });
  /** Waits until the text is not `before` (an edit makes a new one at once; this waits for its render). */
  const changed = before =>
    page.waitForFunction(b => document.querySelector('#lorem-ipsum-result')?.value !== b, before, { timeout: 5_000 });
  const setCount = async value => {
    const before = await result();
    await count.fill(value);
    return before;
  };
  const shot = file => settledShot(shoot, page.locator('[data-slot="tool-page"]'), file);
  const words = t =>
    t
      .replace(/<\/?p>/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
  const n = s => Number(s.replaceAll(',', ''));

  try {
    // Where the host lists the tool, with no list edited.
    await fresh();
    check(
      `${T}: listed in Tools, its page titled and summarised by its definition`,
      (await page
        .getByRole('navigation', { name: 'Sections' })
        .getByRole('list', { name: 'Tools' })
        .getByRole('link', { name: T })
        .count()) === 1 &&
        (await page.getByRole('heading', { name: T }).count()) === 1 &&
        (await page.locator('.kit-tool-page-summary').innerText()) ===
          'Generate placeholder text: words, sentences or paragraphs.',
    );
    const start = await open('#/start');
    const search = start.getByRole('combobox', { name: 'Find a tool or search the web' });
    await search.fill('dummy text');
    const firstRow = await start.getByRole('option').first().innerText();
    check(`${T}: the start page's field finds it by a keyword`, firstRow.includes(T), firstRow.split('\n')[0]);
    const settings = await open('#/settings');
    const group = settings.locator('[data-settings="history"]');
    await group.waitFor();
    const groupText = await group.innerText();
    const applies = await settings.locator('[data-settings="tools"] [data-applies]').innerText();
    const shortcut = settings.locator(`[data-shortcut="open:tools/${ID}"] input`);
    check(
      `${T}: Settings says what History keeps of it, lists it under automatic copying, and gives it no shortcut`,
      groupText.includes('The settings of each text you generated, changed or copied') &&
        groupText.includes('The text itself: an entry opens with a new text made with its settings.') &&
        applies.includes(T) &&
        (await shortcut.count()) === 1 &&
        (await shortcut.inputValue()) === '',
      applies,
    );
    await page.bringToFront();

    // §2.1: three paragraphs, the classic opening, the line under it; Copy copies the text as shown.
    const first = await result();
    const firstLine = await line();
    const [, w, c] = firstLine.match(LINE) ?? [];
    const sentences = (first.match(/\./g) ?? []).length;
    await button('Copy').click();
    await button('Copied').waitFor({ timeout: 2_000 });
    check(
      `${T}: opens with three paragraphs starting with the classic sentence and "N words · M characters"; Copy copies it`,
      first.split('\n\n').length === 3 &&
        first.startsWith(`${CLASSIC} `) &&
        sentences >= 9 &&
        sentences <= 18 &&
        n(w ?? '0') === words(first) &&
        n(c ?? '0') === first.length &&
        (await clipboard.copied()).join('|') === first &&
        (await page.locator('[data-status]').getAttribute('role')) === 'status',
      firstLine,
    );
    await shot('tool-lorem-ipsum-01-opened-light.png');

    // §2.2: Words, 5.
    await radio('Words').click();
    await changed(await setCount('5'));
    check(
      `${T}: Words, 5 — "Lorem ipsum dolor sit amet"`,
      (await result()) === 'Lorem ipsum dolor sit amet' && (await line()) === '5 words · 26 characters',
      await result(),
    );

    // §2.3: without the opening, Sentences, 2 — two random sentences.
    await opening.click();
    await radio('Sentences').click();
    await changed(await setCount('2'));
    const two = await result();
    check(
      `${T}: without the opening, Sentences, 2 — two sentences, neither the classic one`,
      two.split(/(?<=\.) /).length === 2 &&
        /^[A-Z][a-z]*(,? [a-z]+)*\. [A-Z][a-z]*(,? [a-z]+)*\.$/.test(two) &&
        !two.startsWith(CLASSIC),
      two,
    );

    // §2.4: Paragraphs, 4, HTML — four <p> lines, monospace.
    await opening.click();
    await radio('Paragraphs').click();
    await setCount('4');
    await radio('HTML').click();
    await page.waitForFunction(() => document.querySelector('#lorem-ipsum-result')?.value.startsWith('<p>'));
    const html = (await result()).split('\n');
    check(
      `${T}: Paragraphs, 4, HTML — four <p>…</p> lines, the first with the classic sentence, in a monospace field`,
      html.length === 4 &&
        html.every(l => /^<p>[A-Za-z ,.]+<\/p>$/.test(l)) &&
        html[0].startsWith(`<p>${CLASSIC} `) &&
        (await field.getAttribute('class')).includes('font-mono'),
      html[0].slice(0, 80),
    );
    await shot('tool-lorem-ipsum-02-html-light.png');

    // §2.5: 3 → 4 paragraphs keeps the first three; Generate makes a new text.
    await radio('Plain text').click();
    await changed(await setCount('3'));
    const three = await result();
    await changed(await setCount('4'));
    const four = await result();
    const beforeGenerate = await result();
    await button('Generate').click();
    await changed(beforeGenerate);
    const fresher = await result();
    check(
      `${T}: 3 → 4 paragraphs keeps the first three and adds one; Generate makes a new text`,
      four.startsWith(`${three}\n\n`) &&
        four.split('\n\n').length === 4 &&
        fresher !== four &&
        fresher.split('\n\n').length === 4,
    );

    // §2.6: 500 at Paragraphs — the message under the field, the text as it was, Copy still copies it.
    await setCount('500');
    await page.locator('#lorem-ipsum-count-error').waitFor();
    await button('Copy').click();
    await sleep(100);
    check(
      `${T}: 500 at Paragraphs — "Enter a whole number from 1 to 100." under the field, the text as it was, Copy copies it`,
      (await page.locator('#lorem-ipsum-count-error').innerText()) === 'Enter a whole number from 1 to 100.' &&
        (await count.getAttribute('aria-invalid')) === 'true' &&
        (await result()) === fresher &&
        (await button('Generate').isDisabled()) &&
        (await clipboard.copied()).at(-1) === fresher,
    );
    await shot('tool-lorem-ipsum-03-count-error-light.png');

    // §12: the largest texts. Each is made at once on the edit; measured from the edit to the painted text, the longest
    // task meanwhile, then a text box with the same text set on its own (its own cost), then the next edit answered.
    const large = {};
    for (const [unit, value] of [
      ['Words', '10000'],
      ['Sentences', '1000'],
      ['Paragraphs', '100'],
    ]) {
      await fresh();
      await radio(unit).click();
      const m = await page.evaluate(async v => {
        const box = () => document.querySelector('#lorem-ipsum-result');
        const input = document.querySelector('#lorem-ipsum-count');
        const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
        const tasks = [];
        const observer = new PerformanceObserver(list => {
          for (const e of list.getEntries()) tasks.push(e.duration);
        });
        observer.observe({ type: 'longtask', buffered: false });
        const runs = [];
        // Three times: the edit, then back to 1 (small), so each run makes the whole text again.
        for (let i = 0; i < 3; i++) {
          for (const value of ['1', v]) {
            const before = box().value;
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            const t0 = performance.now();
            setter.call(input, value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            while (box().value === before) await new Promise(r => setTimeout(r, 0));
            await frame();
            if (value === v) runs.push(performance.now() - t0);
          }
        }
        observer.disconnect();
        const text = box().value;
        const copy = document.createElement('textarea');
        copy.className = box().className;
        box().after(copy);
        const t1 = performance.now();
        copy.value = text;
        void copy.scrollHeight;
        await frame();
        const textBox = performance.now() - t1;
        copy.remove();
        return { runs, longest: Math.max(0, ...tasks), textBox, chars: text.length };
      }, value);
      const status = await line();
      const answer0 = Date.now();
      await setCount('2');
      await page.waitForFunction(() => document.querySelector('#lorem-ipsum-result')?.value.length < 3000);
      large[unit] = { ...m, status, answered: Date.now() - answer0 };
    }
    report.loremIpsumLarge = large;
    const ms = x => `${Math.round(x)} ms`;
    check(
      `${T}: the largest texts (10,000 words, 1,000 sentences, 100 paragraphs) are shown at once and the page answers the next edit`,
      Object.values(large).every(m => Math.max(...m.runs) < 1_000 && m.answered < 1_000) &&
        n(large.Words.status.match(LINE)?.[1] ?? '0') === 10_000,
      Object.entries(large)
        .map(
          ([u, m]) =>
            `${u}: ${m.chars} chars, edit → painted ${m.runs.map(ms).join('/')}, longest task ${ms(m.longest)}, text box alone ${ms(m.textBox)}, next edit ${ms(m.answered)}`,
        )
        .join('; '),
    );

    // D17: Generate writes one entry in clear — the settings, no text — and Recent entries opens it back.
    await fresh();
    const before = (await historyRecords(page, ID)).length;
    await radio('Sentences').click();
    await setCount('7');
    await opening.click();
    const shownBefore = await result();
    await button('Generate').click();
    await changed(shownBefore);
    const generated = await result();
    const record = await waitForHistoryRecord(
      page,
      ID,
      r => r.kind === 'generate' && r.payload?.count === 7 && r.payload?.startWithLorem === false,
    );
    const line7 = JSON.stringify(record);
    check(
      `${T}: Generate writes one entry in clear with the settings and no text`,
      record.label === '7 sentences · Plain text · random opening' &&
        JSON.stringify(record.payload) ===
          JSON.stringify({ unit: 'sentences', count: 7, startWithLorem: false, format: 'plain' }) &&
        !record.sealed &&
        !line7.includes(generated.slice(0, 30)) &&
        (await historyRecords(page, ID)).length > before,
      record.label,
    );
    // The settings above are saved parameters now: forgotten, so the page opens with the defaults and the entry alone
    // brings its settings back.
    await sleep(500);
    await forgetSavedParameters(page, ID);
    await page.reload();
    await page.locator('[data-status]').waitFor();
    await page.locator('.kit-tool-history-recent summary').click();
    const recent = page.locator('.kit-tool-history-recent .kit-history-entry', {
      hasText: '7 sentences · Plain text · random opening',
    });
    await recent.first().waitFor({ timeout: 3_000 });
    await recent.first().getByRole('button', { name: 'Open' }).click();
    await page.locator('[data-restored]').waitFor({ timeout: 3_000 });
    const back = await result();
    check(
      `${T}: the entry opens back with its settings and a new text of seven sentences, and says the text is new`,
      (await page.locator('[data-restored]').innerText()) ===
        'Opened from History: 7 sentences · Plain text · random opening. The text is new: only the settings were kept.' &&
        (await radio('Sentences').getAttribute('aria-checked')) === 'true' &&
        (await count.inputValue()) === '7' &&
        (await opening.getAttribute('aria-checked')) === 'false' &&
        back.split(/(?<=\.) /).length === 7 &&
        back !== generated,
    );
    await shot('tool-lorem-ipsum-04-restored-light.png');

    // Saved parameters (D21): the settings a person chose are written 400 ms after the change; the page opened again
    // shows them and makes its first text with them. The dark screenshots start afresh (forgotten), as before.
    await fresh();
    const stored = () =>
      page.evaluate(async id => (await chrome.storage.local.get('toolSettings')).toolSettings?.params?.[id], ID);
    await radio('Words').click();
    await setCount('12');
    await radio('HTML').click();
    for (let i = 0; i < 25 && (await stored())?.values?.format !== 'html'; i++) await sleep(200);
    await page.reload();
    await page.locator('[data-status]').waitFor();
    const keptText = await result();
    const kept = {
      words: await radio('Words').getAttribute('aria-checked'),
      count: await count.inputValue(),
      html: await radio('HTML').getAttribute('aria-checked'),
      opening: await opening.getAttribute('aria-checked'),
      text: keptText.slice(0, 40),
      n: words(keptText),
    };
    check(
      `${T}: Words, 12 and HTML chosen, the page opened again — as left, its first text made with them (saved parameters)`,
      kept.words === 'true' &&
        kept.count === '12' &&
        kept.html === 'true' &&
        kept.opening === 'true' &&
        keptText.startsWith('<p>Lorem ipsum dolor sit amet') &&
        kept.n === 12,
      JSON.stringify({ kept, stored: await stored() }),
    );

    await inDarkTheme(ctx, base, page, async () => {
      await fresh();
      await shot('tool-lorem-ipsum-05-opened-dark.png');
      await setCount('4');
      await radio('HTML').click();
      await page.waitForFunction(() => document.querySelector('#lorem-ipsum-result')?.value.startsWith('<p>'));
      await shot('tool-lorem-ipsum-06-html-dark.png');
      await setCount('500');
      await page.locator('#lorem-ipsum-count-error').waitFor();
      await shot('tool-lorem-ipsum-07-count-error-dark.png');
    });
  } finally {
    await clipboard?.restore().catch(() => undefined);
    for (const p of opened) await p.close();
    // The settings the dark screenshots chose are saved parameters (written 400 ms after the change): the next module
    // opens the tool with its defaults.
    await sleep(500);
    await forgetSavedParameters(page, ID).catch(() => undefined);
  }
};
