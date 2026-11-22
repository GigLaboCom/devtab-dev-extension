// The Random String tool in the built extension (docs/tools/specs/random-string.md): its scenarios (§2) with the page's
// real controls, where the host lists it, the largest batch (§12: 10,000 strings of 100 characters — how long it takes
// and how long the page is busy, with the text box's own cost measured apart), and its one secret history kind (D17)
// end to end:
//   - without a master password a generated batch is not written at all;
//   - with a throwaway master password made here, Generate writes one encrypted entry (nothing of the strings, the
//     label or the settings in clear in IndexedDB — records or blobs);
//   - locked, the entry does not open (the tool says it is encrypted) and a Generate writes nothing;
//   - unlocked, History's "Open" brings the very batch back into the tool;
//   - the master password is turned off again (its encrypted entries go with it), so later steps start as before.
// The master password and the generated strings are never written to the report or the console, and the strings are
// blurred in the screenshots. Copying is checked against the page's own stand-in for navigator.clipboard.writeText
// (nothing reaches the machine's clipboard), put back before the module ends. Run by scripts/e2e-tools.mjs.

/* global document, indexedDB, location, requestAnimationFrame, HTMLTextAreaElement -- page.evaluate callbacks run in the page */

import { inDarkTheme, settledShot, stubClipboard } from '../e2e-helpers.mjs';

const T = 'Random String';
const ID = 'random-string';

/** The tool's rows of the history database (kind, key id, the stored line) and the bytes of every blob, as text. */
const stored = page =>
  page.evaluate(async owner => {
    const db = await new Promise(res => {
      const r = indexedDB.open('tool-history');
      r.onupgradeneeded = () => r.transaction.abort();
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db) return { rows: [], blobs: '' };
    const all = name =>
      new Promise((res, rej) => {
        const r = db.transaction(name).objectStore(name).getAll();
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    const rows = (await all('records')).filter(row => row.owner === owner);
    const texts = [];
    for (const value of await all('blobs'))
      for (const part of Object.values(value))
        if (part instanceof Blob) texts.push(new TextDecoder('latin1').decode(await part.arrayBuffer()));
    db.close();
    return {
      rows: rows.map(row => ({ kind: row.kind, kid: row.kid ?? null, line: row.line })),
      blobs: texts.join('\n'),
    };
  }, ID);

export default async ({ ctx, page, base, check, shoot, sleep, report }) => {
  const opened = [];
  const open = async hash => {
    const p = await ctx.newPage();
    // Its console errors count against the run, as the main page's do.
    p.on('console', m => {
      if (m.type() === 'error' || m.type() === 'warning')
        report.console.push({ type: m.type(), text: m.text(), url: m.location().url });
    });
    p.on('pageerror', e => report.console.push({ type: 'pageerror', text: String(e) }));
    await p.goto(`${base}${hash}`);
    opened.push(p);
    return p;
  };
  // The page's clipboard stand-in; a reload drops it, so `fresh` puts it back.
  let clipboard = null;
  /** The tool afresh: reloaded (not a new history entry of the tab), every choice back to its default. */
  const fresh = async () => {
    const hash = `#/tools/${ID}`;
    if (!page.url().startsWith(base)) await page.goto(`${base}${hash}`);
    else await page.evaluate(url => location.replace(url), `${base}${hash}`);
    await page.waitForFunction(h => location.hash === h, hash, { timeout: 5_000 });
    await page.reload();
    await page.locator('[data-entropy]').waitFor();
    clipboard = await stubClipboard(page);
  };
  const button = (p, name) => p.getByRole('button', { name, exact: true });
  const radio = (p, name) => p.getByRole('radio', { name, exact: true });
  const entropy = p => p.locator('[data-entropy]').innerText();
  const hint = p => p.locator('[data-hint]').innerText();
  const frame = p => p.locator('[data-slot="tool-page"]');
  /** The strings shown — one output, rows, or the field. */
  const strings = p =>
    p.evaluate(() => {
      const field = document.querySelector('[aria-label="Generated strings"]');
      if (field instanceof HTMLTextAreaElement) return field.value === '' ? [] : field.value.split('\n');
      if (field) return [...field.querySelectorAll('output')].map(o => o.textContent ?? '');
      const one = document.querySelector('output[aria-label="Generated string"]');
      return one ? [one.textContent ?? ''] : [];
    });
  const choose = async (p, label, option) => {
    await p.getByLabel(label, { exact: true }).click();
    await p.getByRole('option', { name: option, exact: true }).click();
  };
  const fill = (p, label, value) => p.getByLabel(label, { exact: true }).fill(value);
  const errorUnder = (p, id) =>
    p.evaluate(field => {
      const by = document.getElementById(field)?.getAttribute('aria-describedby');
      return by ? (document.getElementById(by)?.textContent ?? null) : null;
    }, id);
  /** Screenshots never show a generated string: blurred through the CSSOM (not a style attribute) while shooting. */
  const shot = async (p, file) => {
    const veil = on =>
      p.evaluate(blur => {
        for (const el of document.querySelectorAll(
          '[aria-label="Generated strings"] output, output[aria-label="Generated string"], textarea[aria-label="Generated strings"]',
        ))
          el.style.filter = blur ? 'blur(5px)' : '';
      }, on);
    await veil(true);
    try {
      await settledShot(shoot, frame(p), file);
    } finally {
      await veil(false);
    }
  };

  try {
    // Where the host lists the tool, with no list edited: the Tools list, the start page's field, Settings.
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
          'Random strings and bytes for tokens, keys and test data.',
    );
    const start = await open('#/start');
    const field = start.getByRole('combobox', { name: 'Find a tool or search the web' });
    await field.fill('nonce');
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
      groupText.includes('The strings and bytes you generated or copied, with their settings') &&
        groupText.includes('Generated strings without a master password or while the history is locked') &&
        applies.includes(T) &&
        (await shortcut.count()) === 1 &&
        (await shortcut.inputValue()) === '',
      applies,
    );

    // §6, the first row: 10 strings of 32 Letters and digits, 190 bits; each a row with its copy button.
    await page.bringToFront();
    const first = await strings(page);
    check(
      `${T}: opens with 10 strings of 32 letters and digits, a copy button each, and 190 bits`,
      first.length === 10 &&
        first.every(s => /^[A-Za-z0-9]{32}$/.test(s)) &&
        new Set(first).size === 10 &&
        (await page.locator('[data-slot="result-row"] button[aria-label^="Copy string"]').count()) === 10 &&
        (await entropy(page)) === '190 bits of entropy per string',
      await entropy(page),
    );
    check(
      `${T}: says generated strings are not kept without a master password, and so does the history line`,
      (await hint(page)).endsWith('Generated strings are not kept (no master password).') &&
        /keeps secrets only: nothing is kept without a master password\./.test(
          await page.locator('.kit-tool-history-line').innerText(),
        ),
    );
    await button(page, 'Copy all').click();
    await button(page, 'Copied').waitFor({ timeout: 2000 });
    await button(page, 'Copy string 3').click();
    await sleep(100);
    const copiedFirst = await clipboard.copied();
    check(
      `${T}: Copy all copies the batch one per line with no line break at the end; a row's button copies its string`,
      copiedFirst.length === 2 && copiedFirst[0] === first.join('\n') && copiedFirst[1] === first[2],
    );
    await shot(page, 'tool-random-string-01-opened-light.png');

    // §2.1: Bytes, 32, Hex (lowercase), one string — 64 hex digits, 256 bits; Copy.
    await radio(page, 'Bytes').click();
    await fill(page, 'How many', '1');
    const [hex] = await strings(page);
    await button(page, 'Copy').click();
    await button(page, 'Copied').waitFor({ timeout: 2000 });
    check(
      `${T}: Bytes, 32, Hex (lowercase) — one string of 64 hex digits, 256 bits, Copy copies it`,
      /^[0-9a-f]{64}$/.test(hex ?? '') &&
        (await entropy(page)) === '256 bits of entropy per string' &&
        (await clipboard.copied()).at(-1) === hex,
      await entropy(page),
    );
    // §2.2: the same 32 bytes in Base64 — 44 characters with "=" at the end.
    await choose(page, 'Encoding', 'Base64');
    const [b64] = await strings(page);
    await choose(page, 'Encoding', 'Base64url');
    const [b64url] = await strings(page);
    check(
      `${T}: Base64 — 44 characters ending in "="; Base64url — 43, no "="`,
      /^[A-Za-z0-9+/]{43}=$/.test(b64 ?? '') && /^[A-Za-z0-9_-]{43}$/.test(b64url ?? ''),
    );
    await fill(page, 'How many', '3');
    await shot(page, 'tool-random-string-02-bytes-light.png');

    // §2.3: 1,000 identifiers of 12 a–z0–9 — one field, Copy all copies it whole.
    await fresh();
    await choose(page, 'Alphabet', 'Lowercase letters and digits');
    await fill(page, 'Length', '12');
    await fill(page, 'How many', '1000');
    const batch = page.getByLabel('Generated strings', { exact: true });
    const lines = (await batch.inputValue()).split('\n');
    await button(page, 'Copy all').click();
    await button(page, 'Copied').waitFor({ timeout: 2000 });
    check(
      `${T}: Lowercase letters and digits, 12, How many 1,000 — 1,000 lines in a read-only field, Copy all copies it`,
      lines.length === 1000 &&
        lines.every(l => /^[a-z0-9]{12}$/.test(l)) &&
        (await batch.evaluate(el => el.tagName === 'TEXTAREA' && el.readOnly && el.spellcheck === false)) &&
        (await clipboard.copied()).at(-1) === lines.join('\n'),
    );
    await shot(page, 'tool-random-string-03-thousand-light.png');

    // §2.4: Crockford Base32, length 8.
    await choose(page, 'Alphabet', 'Crockford Base32');
    await fill(page, 'Length', '8');
    await fill(page, 'How many', '10');
    const codes = await strings(page);
    check(
      `${T}: Crockford Base32, length 8 — no I, L, O, U; 40 bits`,
      codes.length === 10 &&
        codes.every(c => /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/.test(c)) &&
        (await entropy(page)) === '40 bits of entropy per string',
    );

    // §2.5: Custom "ACGT", length 16 — 32 bits.
    await choose(page, 'Alphabet', 'Custom');
    await page.getByLabel('Custom alphabet', { exact: true }).fill('ACGT');
    await fill(page, 'Length', '16');
    const dna = await strings(page);
    check(
      `${T}: Custom "ACGT", length 16 — DNA strings, 32 bits`,
      dna.length === 10 &&
        dna.every(s => /^[ACGT]{16}$/.test(s)) &&
        (await entropy(page)) === '32 bits of entropy per string',
    );
    // Characters outside the Basic Multilingual Plane are whole characters.
    await page.getByLabel('Custom alphabet', { exact: true }).fill('🙂👍🏽🇺🇸x');
    await fill(page, 'Length', '6');
    const emoji = await strings(page);
    check(
      `${T}: Custom "🙂👍🏽🇺🇸x" — strings of 6 whole characters, never half of a pair`,
      emoji.length === 10 &&
        emoji.every(s => /^(?:🙂|👍🏽|🇺🇸|x){6}$/u.test(s) && !/\p{Cs}/u.test(s)) &&
        (await entropy(page)) === '12 bits of entropy per string',
      await entropy(page),
    );

    // §2.6: Custom "aa" — the message under the field, no result, the buttons off.
    await page.getByLabel('Custom alphabet', { exact: true }).fill('aa');
    const twoMessage = await errorUnder(page, 'random-string-custom');
    check(
      `${T}: Custom "aa" — the message under the field, no strings, Generate and Copy all off`,
      twoMessage === 'The alphabet needs at least 2 different characters.' &&
        (await strings(page)).length === 0 &&
        (await button(page, 'Generate').isDisabled()) &&
        (await button(page, 'Copy all').isDisabled()),
      twoMessage ?? '',
    );
    await shot(page, 'tool-random-string-04-custom-error-light.png');

    // §2.7: Length 1,000 × How many 10,000 — too much at once.
    await choose(page, 'Alphabet', 'Letters and digits');
    await fill(page, 'Length', '1000');
    await fill(page, 'How many', '10000');
    const tooMuch = await errorUnder(page, 'random-string-count');
    check(
      `${T}: Length 1,000 × How many 10,000 — "Too much at once", nothing made`,
      tooMuch === 'Too much at once: length × how many must be at most 1,000,000.' &&
        (await strings(page)).length === 0,
      tooMuch ?? '',
    );

    // §12: the largest batch — 10,000 strings of 100 characters, a megabyte of text. A change makes it 300 ms after
    // the last edit; Generate says "Generating…" until it is there. Measured: the press to the painted batch, the
    // longest task meanwhile, and a text area of the same text set on its own (the text box's own cost).
    await fill(page, 'Length', '100');
    await page.waitForFunction(
      () => (document.querySelector('textarea[aria-label="Generated strings"]')?.value.length ?? 0) === 1_009_999,
      undefined,
      { timeout: 10_000 },
    );
    const big = await page.evaluate(async () => {
      const field = () => document.querySelector('textarea[aria-label="Generated strings"]');
      const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
      const tasks = [];
      const observer = new PerformanceObserver(list => {
        for (const e of list.getEntries()) tasks.push(e.duration);
      });
      observer.observe({ type: 'longtask', buffered: false });
      const runs = [];
      let sawLabel = false;
      for (let i = 0; i < 3; i++) {
        const before = field().value;
        const generate = [...document.querySelectorAll('button')].find(b => b.textContent === 'Generate');
        const t0 = performance.now();
        generate.click();
        await new Promise(r => setTimeout(r, 0));
        sawLabel ||= [...document.querySelectorAll('button')].some(b => b.textContent === 'Generating…');
        while (field().value === before) await new Promise(r => setTimeout(r, 5));
        await frame();
        runs.push(performance.now() - t0);
      }
      // The text box alone: a new text area with the same megabyte, laid out and painted.
      const text = field().value;
      const box = document.createElement('textarea');
      box.className = field().className;
      field().after(box);
      const t1 = performance.now();
      box.value = text;
      void box.scrollHeight;
      await frame();
      const textBox = performance.now() - t1;
      box.remove();
      // Responsive: an edit right after a huge batch is answered (How many 1: a single string).
      const answer0 = performance.now();
      observer.disconnect();
      return {
        runs,
        longest: Math.max(0, ...tasks),
        textBox,
        sawLabel,
        lines: text.split('\n').length,
        chars: text.length,
        answer0,
      };
    });
    await fill(page, 'How many', '1');
    await page.locator('output[aria-label="Generated string"]').waitFor({ timeout: 5_000 });
    const answered = await page.evaluate(t0 => performance.now() - t0, big.answer0);
    const ms = n => `${Math.round(n)} ms`;
    report.randomStringLargeBatch = { ...big, answered };
    check(
      `${T}: 10,000 strings of 100 characters — Generating… then the whole batch in the field, the page answering again`,
      big.sawLabel &&
        big.lines === 10_000 &&
        big.chars === 1_009_999 &&
        Math.max(...big.runs) < 5_000 &&
        answered < 5_000,
      `press → painted ${big.runs.map(ms).join(', ')}; longest task ${ms(big.longest)}; the text box alone ${ms(big.textBox)}; next edit answered in ${ms(answered)}`,
    );

    await inDarkTheme(ctx, base, page, async () => {
      await fresh();
      await shot(page, 'tool-random-string-05-opened-dark.png');
      await radio(page, 'Bytes').click();
      await choose(page, 'Encoding', 'Base64');
      await fill(page, 'How many', '3');
      await shot(page, 'tool-random-string-06-bytes-dark.png');
      await radio(page, 'Characters').click();
      await choose(page, 'Alphabet', 'Custom');
      await page.getByLabel('Custom alphabet', { exact: true }).fill('a b');
      await shot(page, 'tool-random-string-07-custom-error-dark.png');
    });

    // D17, the secret kind. No master password: nothing is written.
    await fresh();
    await button(page, 'Generate').click();
    await button(page, 'Copy all').click();
    await sleep(800);
    check(
      `${T}: without a master password a generated batch is not written at all`,
      (await stored(page)).rows.length === 0,
    );

    // A master password made here and thrown away (never printed).
    const master = `e2e-${[...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(36)).join('')}-Zz9`;
    await settings.bringToFront();
    await group.getByRole('button', { name: 'Set a master password…' }).click();
    await group.getByLabel('Master password', { exact: true }).fill(master);
    await group.getByLabel('The same again').fill(master);
    await group.getByLabel('I understand: forgotten means lost').click();
    await group.getByRole('button', { name: 'Set the master password' }).click();
    await group.getByText('The master password is set and the history is unlocked.').waitFor();
    try {
      await page.bringToFront();
      await page.waitForFunction(() =>
        document
          .querySelector('[data-hint]')
          ?.textContent?.endsWith('Generated strings are kept encrypted in this browser.'),
      );
      check(`${T}: with the history unlocked, it says generated strings are kept encrypted`, true);
      await choose(page, 'Alphabet', 'Custom');
      await page.getByLabel('Custom alphabet', { exact: true }).fill('QWXZqwxz');
      await fill(page, 'How many', '4');
      await button(page, 'Generate').click();
      const secret = await strings(page);
      let found = { rows: [], blobs: '' };
      for (let i = 0; i < 50 && found.rows.length === 0; i++) {
        await sleep(100);
        found = await stored(page);
      }
      // The edits before Generate were changes, superseded by the commit; give the checkpoint rule time, then look.
      await sleep(500);
      found = await stored(page);
      const row = found.rows.at(-1);
      const record = row ? JSON.parse(row.line) : {};
      const inClear = found.rows.map(r => r.line).join('\n') + found.blobs;
      check(
        `${T}: unlocked, Generate writes an encrypted entry — nothing of the strings, label or settings in clear (records and blobs)`,
        secret.length === 4 &&
          found.rows.length >= 1 &&
          found.rows.every(r => r.kind === 'generated' && !!r.kid) &&
          typeof record.sealed === 'object' &&
          record.payload === undefined &&
          record.label === undefined &&
          record.text === undefined &&
          !secret.some(s => inClear.includes(s)) &&
          !inClear.includes('QWXZqwxz') &&
          !inClear.includes('Custom alphabet'),
        `${found.rows.length} entr${found.rows.length === 1 ? 'y' : 'ies'}, sealed ${typeof record.sealed === 'object'}`,
      );
      const kept = found.rows.length;

      // Locked: the entry stays shut and nothing new is written.
      const history = await open('#/history');
      await history.locator('[data-page="history"]').waitFor();
      await history.getByLabel('Tool', { exact: true }).click();
      await history.getByRole('option', { name: T, exact: true }).click();
      await history.getByRole('button', { name: 'Lock now' }).click();
      await history.locator('.kit-history-lock[data-vault="locked"]').waitFor();
      const entry = history.locator('.kit-history-entry[data-kind="generated"]').first();
      await entry.waitFor();
      check(`${T}: History lists it as an encrypted entry`, /Encrypted entry/.test(await entry.innerText()));
      await entry.getByRole('button', { name: 'Open' }).click();
      await history.locator('[data-restored]').waitFor();
      const lockedText = await history.locator('[data-restored]').innerText();
      const lockedShown = await strings(history);
      check(
        `${T}: locked, opening the entry says it is encrypted and shows none of the kept strings`,
        lockedText === 'This entry is encrypted: unlock the history to open it.' &&
          !lockedShown.some(s => secret.includes(s)),
        lockedText,
      );
      await history.waitForFunction(() =>
        document
          .querySelector('[data-hint]')
          ?.textContent?.endsWith('Generated strings are not kept while the history is locked.'),
      );
      await button(history, 'Generate').click();
      await sleep(800);
      check(`${T}: locked, a Generate writes nothing`, (await stored(history)).rows.length === kept);

      // Unlocked again: History's Open brings the very batch back.
      await settings.bringToFront();
      await group.getByLabel('Master password', { exact: true }).fill(master);
      await group.getByRole('button', { name: 'Unlock' }).click();
      await group.getByText('Unlocked.', { exact: true }).first().waitFor();
      await history.bringToFront();
      await history.evaluate(url => location.replace(url), `${base}#/history`);
      await history.locator('[data-page="history"]').waitFor();
      await history.getByLabel('Tool', { exact: true }).click();
      await history.getByRole('option', { name: T, exact: true }).click();
      await history
        .locator('.kit-history-entry[data-kind="generated"]')
        .first()
        .getByRole('button', { name: 'Open' })
        .click();
      await history.locator('[data-restored]').waitFor();
      const restoredText = await history.locator('[data-restored]').innerText();
      check(
        `${T}: unlocked, History's Open brings the generated batch back into the tool, with its settings`,
        JSON.stringify(await strings(history)) === JSON.stringify(secret) &&
          restoredText === 'Opened from History: 4 strings · 32 characters · Custom alphabet · 96 bits.' &&
          (await history.getByLabel('Custom alphabet', { exact: true }).inputValue()) === 'QWXZqwxz',
        restoredText,
      );
    } finally {
      // Turn the master password off again: its encrypted entries go, later steps start without one.
      await settings.bringToFront();
      await group.getByRole('button', { name: 'Turn off…' }).click();
      await group.getByRole('button', { name: 'Delete the encrypted history' }).click();
      await group.getByText(/^The master password is off/).waitFor();
    }
    await page.bringToFront();
    await fresh();
    await button(page, 'Generate').click();
    await sleep(800);
    check(
      `${T}: with the master password off again, its entries are gone and nothing is written`,
      (await stored(page)).rows.length === 0 &&
        (await hint(page)).endsWith('Generated strings are not kept (no master password).'),
    );
  } finally {
    await clipboard?.restore().catch(() => undefined);
    for (const p of opened) await p.close();
  }
};
