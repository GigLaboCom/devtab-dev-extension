// The Lines tool in the built extension (docs/tools/specs/lines.md): its scenarios (§2) the way a person does them —
// the page's real controls — then the sort rows of §10 through the page, the collation compared with Node's on the same
// inputs, the keyboard order (§8), the limits timed in the browser with a large input processed in the tool's module
// worker (§12), an entry opened back from the tool's own history (D17), and the page in the light and the dark theme.
// The browser's language is not trusted: DevTools sets it to sv-SE (where ä sorts after z) for the length of this module,
// and the sort must still be the fixed 'en' order (§5.9.2); it is put back at the end. The clipboard is stubbed for one press.
// The steps are saved parameters (D21): checked once; every scenario starts from a page with them forgotten.
// Run by scripts/e2e-tools.mjs.

/* global document, HTMLTextAreaElement, requestAnimationFrame, chrome -- page.evaluate callbacks run in the page */

import {
  forgetSavedParameters,
  inDarkTheme,
  settledShot,
  stubClipboard,
  waitForHistoryRecord,
} from '../e2e-helpers.mjs';

const T = 'Lines';

/** The collation options of §5.9.2. */
const COLLATIONS = {
  Alphabetical: { usage: 'sort', sensitivity: 'accent', numeric: false, ignorePunctuation: false },
  'Alphabetical, Uppercase first': {
    usage: 'sort',
    sensitivity: 'variant',
    caseFirst: 'upper',
    numeric: false,
    ignorePunctuation: false,
  },
  Natural: { usage: 'sort', sensitivity: 'accent', numeric: true, ignorePunctuation: false },
  'Natural, Uppercase first': {
    usage: 'sort',
    sensitivity: 'variant',
    caseFirst: 'upper',
    numeric: true,
    ignorePunctuation: false,
  },
};

/** Words over letters, digits, marks, punctuation and scripts the lists of §2 carry (fixed seed: the same each run). */
const corpus = () => {
  let seed = 16;
  const random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const pool = [
    'a',
    'A',
    'b',
    'B',
    'z',
    'ä',
    'Ä',
    'é',
    'é',
    'ß',
    'ẞ',
    'ı',
    'İ',
    'i',
    '1',
    '2',
    '10',
    '01',
    '-',
    '_',
    ' ',
    '.',
    '😀',
    '👍🏽',
    '中',
    'я',
    'Ё',
    'ё',
    'ǅ',
    'ﬁ',
    'Å',
    'Ω',
    'ω',
    '­',
    '​',
    '̀',
    'ʼ',
    '’',
    "'",
    '·',
    '٣',
    '१',
    '⅓',
    '²',
    '@',
    'x',
    'file',
    '.txt',
  ];
  return Array.from({ length: 20_000 }, () =>
    Array.from({ length: 1 + Math.floor(random() * 5) }, () => pool[Math.floor(random() * pool.length)]).join(''),
  );
};
const order = (list, options) => {
  const { compare } = new Intl.Collator('en', options);
  return list.map((_, i) => i).sort((i, j) => compare(list[i], list[j]));
};

export default async ({ ctx, page, base, check, shoot, sleep }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setLocaleOverride', { locale: 'sv-SE' });
  // One entry in the tab's history for the whole module: the tool is started afresh by reloading its page, not by
  // going away and back (the tab keeps at most 50 entries, and later modules count theirs).
  await page.goto(`${base}#/tools/lines`);
  try {
    await run({ ctx, page, base, check, shoot, sleep });
  } finally {
    await cdp.send('Emulation.setLocaleOverride', {}).catch(() => undefined);
    await cdp.detach().catch(() => undefined);
  }
};

const run = async ({ ctx, page, base, check, shoot, sleep }) => {
  const input = page.locator('#lines-input');
  const result = page.locator('#lines-output');
  const summary = page.locator('[data-part="summary"]');
  const errorLine = page.locator('[data-part="error"]');
  const step = name => page.getByRole('checkbox', { name, exact: true });
  const button = name => page.getByRole('button', { name, exact: true });
  /** The steps that are on (their own checkboxes, not their options). */
  const stepsOn = () => page.locator('[data-step] > div:first-child [role="checkbox"][aria-checked="true"]');
  const counter = name => page.getByRole('group', { name, exact: true }).locator('[data-part="delta"]');
  const choose = async (label, option) => {
    await page.getByRole('combobox', { name: label, exact: true }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
  };
  const type = (label, value) => page.getByRole('textbox', { name: label, exact: true }).fill(value);
  /**
   * The tool afresh: every step off, both fields empty. The steps are saved parameters: the page is left first (its
   * last changes are written as it goes), then they are forgotten and the page is read anew.
   */
  const fresh = async () => {
    await page.reload();
    await input.waitFor();
    await forgetSavedParameters(page, 'lines');
    await page.reload();
    await input.waitFor();
  };
  /**
   * Puts text into the input the way a paste does, without the editing commands `fill` uses: on a text box holding a
   * million lines Chrome's select-all-and-replace can keep the page busy for minutes (seen in this module's first runs).
   */
  const put = text =>
    page.evaluate(value => {
      const field = document.querySelector('#lines-input');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, value);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }, text);
  const settled = async () => {
    await page.waitForFunction(() => document.querySelector('[data-part="summary"]')?.textContent !== 'Updating…');
    return result.inputValue();
  };

  await fresh();
  const language = await page.evaluate(() => [navigator.language, new Intl.Collator().resolvedOptions().locale]);
  const empty = {
    steps: await page.getByRole('group').count(),
    on: await stepsOn().count(),
    sortBy: await page.getByRole('combobox', { name: 'Sort by', exact: true }).isDisabled(),
    copy: await button('Copy').isDisabled(),
    use: await button('Use as input').isDisabled(),
    summary: (await summary.innerText()).trim(),
    placeholder: await input.getAttribute('placeholder'),
  };
  check(
    `${T}: opens empty — nine steps off with their options disabled, Copy and Use as input off, no summary (§8)`,
    empty.steps === 9 &&
      empty.on === 0 &&
      empty.sortBy &&
      empty.copy &&
      empty.use &&
      empty.summary === '' &&
      empty.placeholder === 'One item per line',
    JSON.stringify({ ...empty, language }),
  );
  await settledShot(shoot, page, 'tool-lines-01-empty-light.png');

  // §2.1: addresses.
  await input.fill('alice@example.com\n Bob@example.com\n\nbob@example.com\ncarol@example.com\nalice@example.com \n');
  await step('Trim').click();
  await step('Remove blank lines').click();
  await step('Duplicates').click();
  await step('Ignore case').click();
  await step('Order').click();
  const addresses = {
    result: await result.inputValue(),
    summary: (await summary.innerText()).trim(),
    blank: (await counter('Remove blank lines').innerText()).trim(),
    duplicates: (await counter('Duplicates').innerText()).trim(),
  };
  check(
    `${T}: §2.1 addresses trimmed, blank and repeated lines removed, sorted — 6 lines in, 3 out`,
    addresses.result === 'alice@example.com\nBob@example.com\ncarol@example.com\n' &&
      addresses.summary === '6 lines in, 3 out' &&
      addresses.blank === '1 removed' &&
      addresses.duplicates === '2 removed',
    JSON.stringify(addresses),
  );
  // The page's own clipboard stand-in, only for this press (nothing reaches the machine's clipboard).
  const clipboard = await stubClipboard(page);
  await button('Copy').click();
  await button('Copied').waitFor({ timeout: 2_000 });
  const copied = await clipboard.copied();
  await clipboard.restore();
  const record = await waitForHistoryRecord(page, 'lines', r => r.kind === 'process' && /copied$/.test(r.label ?? ''))
    .then(r => r.label)
    .catch(error => `none: ${error.message}`);
  check(
    `${T}: Copy copies the result as computed, with its final line break, and is recorded as Processed`,
    copied.at(-1) === addresses.result &&
      record === 'Trim · Remove blank lines · Duplicates · Sort: Alphabetical · 6 lines in, 3 out · copied',
    `${JSON.stringify(copied.at(-1))}; ${record}`,
  );
  await settledShot(shoot, page, 'tool-lines-02-addresses-light.png');

  // Saved parameters (D21): the steps of §2.1 are kept (written 400 ms after the change); the page opened again has
  // them, with both fields empty.
  const stored = () =>
    page.evaluate(async () => (await chrome.storage.local.get('toolSettings')).toolSettings?.params?.lines);
  const kept = ['trimEnabled', 'blankEnabled', 'duplicatesEnabled', 'duplicatesIgnoreCase', 'orderEnabled'];
  for (let i = 0; i < 25; i++) {
    const values = (await stored())?.values;
    if (kept.every(key => values?.[key] === true)) break;
    await sleep(200);
  }
  await page.reload();
  await input.waitFor({ timeout: 15_000 });
  const reopened = {
    on: await stepsOn().count(),
    trim: await step('Trim').getAttribute('aria-checked'),
    ignoreCase: await step('Ignore case').getAttribute('aria-checked'),
    input: await input.inputValue(),
    result: await result.inputValue(),
  };
  check(
    `${T}: the steps of §2.1 built, the page opened again — the same four steps on, Ignore case too, the fields empty (saved parameters)`,
    reopened.on === 4 &&
      reopened.trim === 'true' &&
      reopened.ignoreCase === 'true' &&
      reopened.input === '' &&
      reopened.result === '',
    JSON.stringify({ ...reopened, stored: await stored() }),
  );

  // D17: the copied result of §2.1 is in the tool's history (its recent eight) and opens back into the tool.
  await fresh();
  const recent = page.locator('.kit-tool-history-recent');
  await recent.locator('summary').waitFor({ timeout: 5_000 });
  await recent.locator('summary').click();
  const entry = recent
    .locator('.kit-history-entry', { hasText: 'Sort: Alphabetical · 6 lines in, 3 out · copied' })
    .first();
  const listed = await entry.count();
  if (listed) await entry.getByRole('button', { name: 'Open' }).click();
  await page
    .locator('[data-restored]')
    .waitFor({ timeout: 5_000 })
    .catch(() => {});
  const back = {
    listed,
    kind: listed ? await entry.locator('.kit-history-entry-kind').innerText() : null,
    input: await input.inputValue(),
    on: await stepsOn().count(),
    result: await result.inputValue(),
  };
  check(
    `${T}: a copied result is in the tool’s history as Processed and opens back with its input and steps`,
    back.listed > 0 &&
      back.kind === 'Processed' &&
      back.input.startsWith('alice@example.com\n Bob@example.com') &&
      back.on === 4 &&
      back.result === 'alice@example.com\nBob@example.com\ncarol@example.com\n',
    JSON.stringify(back),
  );

  // §2.2: Natural.
  await fresh();
  await input.fill('file1.txt\nfile10.txt\nfile2.txt');
  await step('Order').click();
  const alphabetical = await result.inputValue();
  await choose('Sort by', 'Natural (file2 before file10)');
  const natural = await result.inputValue();
  check(
    `${T}: §2.2 Alphabetical keeps file10 before file2, Natural puts file2 first`,
    alphabetical === 'file1.txt\nfile10.txt\nfile2.txt' && natural === 'file1.txt\nfile2.txt\nfile10.txt',
    JSON.stringify({ alphabetical, natural }),
  );

  // §2.3: a frequency table.
  await fresh();
  await input.fill('200\n404\n200\n500\n200\n404');
  await step('Duplicates').click();
  await choose('Duplicates mode', 'Count occurrences');
  await step('Order').click();
  await choose('Sort by', 'Numeric');
  await choose('Direction', 'Descending');
  const counts = await result.inputValue();
  check(
    `${T}: §2.3 Count occurrences sorted Numeric, Descending — 3⇥200, 2⇥404, 1⇥500; Uppercase first off`,
    counts === '3\t200\n2\t404\n1\t500' && (await step('Uppercase first').isDisabled()),
    JSON.stringify(counts),
  );

  // §2.4: WHERE id IN (…).
  await fresh();
  await input.fill('42\n17\n42\n8');
  await step('Duplicates').click();
  await step('Order').click();
  await choose('Sort by', 'Numeric');
  await step('Prefix and suffix').click();
  await type('Prefix', "'");
  await type('Suffix', "'");
  await step('Join into one line').click();
  const ids = { result: await result.inputValue(), summary: (await summary.innerText()).trim() };
  check(
    `${T}: §2.4 ids for WHERE id IN (…) — '8', '17', '42', 4 lines in, 1 out`,
    ids.result === "'8', '17', '42'" && ids.summary === '4 lines in, 1 out',
    JSON.stringify(ids),
  );
  await settledShot(shoot, page, 'tool-lines-03-sql-list-light.png');

  // §2.5: Split.
  await fresh();
  await input.fill('red, green, blue');
  await step('Split lines').click();
  await step('Trim').click();
  const split = { result: await result.inputValue(), counter: (await counter('Split lines').innerText()).trim() };
  check(
    `${T}: §2.5 Split on Comma and Trim — red, green, blue, 2 added`,
    split.result === 'red\ngreen\nblue' && split.counter === '2 added',
    JSON.stringify(split),
  );

  // §2.6: Shuffle, Number lines keeps the order, Shuffle again changes it.
  await fresh();
  const names = Array.from({ length: 12 }, (_, i) => `Speaker ${String.fromCharCode(65 + i)}`);
  await input.fill(names.join('\n'));
  await step('Order').click();
  await page.getByRole('radio', { name: 'Shuffle', exact: true }).click();
  const shuffled = await result.inputValue();
  await step('Number lines').click();
  const numbered = await result.inputValue();
  const again = new Set();
  for (let i = 0; i < 3; i++) {
    await button('Shuffle again').click();
    again.add(await result.inputValue());
  }
  check(
    `${T}: §2.6 Shuffle is a permutation; Number lines keeps the order; Shuffle again draws a new one`,
    [...shuffled.split('\n')].sort().join() === [...names].sort().join() &&
      numbered ===
        shuffled
          .split('\n')
          .map((n, i) => `${i + 1}. ${n}`)
          .join('\n') &&
      again.size > 1,
    `${JSON.stringify(shuffled.split('\n').slice(0, 4))}…; ${again.size} orders in 3 presses`,
  );
  await settledShot(shoot, page, 'tool-lines-04-shuffle-light.png');

  // §2.7: Filter.
  await fresh();
  await input.fill('10:01 ERROR db timeout\n10:03 Error retry\n10:04 ERROR disk');
  await step('Filter').click();
  await type('Filter text', 'ERROR');
  await step('Match case').click();
  const filtered = { result: await result.inputValue(), counter: (await counter('Filter').innerText()).trim() };
  check(
    `${T}: §2.7 Filter Keep lines containing ERROR, Match case — 1 removed`,
    filtered.result === '10:01 ERROR db timeout\n10:04 ERROR disk' && filtered.counter === '1 removed',
    JSON.stringify(filtered),
  );

  // Use as input.
  await fresh();
  await input.fill('b\na\nb');
  await step('Duplicates').click();
  await button('Use as input').click();
  const used = {
    input: await input.inputValue(),
    on: await stepsOn().count(),
  };
  check(
    `${T}: Use as input moves the result into the input and turns every step off`,
    used.on === 0,
    JSON.stringify(used),
  );

  // §10's sort rows through the page, with the browser's language set to sv-SE: the fixed 'en' order holds.
  const locale = await page.evaluate(() => new Intl.Collator().resolvedOptions().locale);
  const rows = [
    ['Alphabetical', false, 'b\nB\na\nA\nä\nÄ\nZ', 'a\nA\nä\nÄ\nb\nB\nZ'],
    ['Alphabetical', true, 'b\nB\na\nA\nä\nÄ\nZ', 'A\na\nÄ\nä\nB\nb\nZ'],
    ['Alphabetical', false, '_b\n-a\n a\n.x\n1\nA', ' a\n_b\n-a\n.x\n1\nA'],
    ['Alphabetical', false, 'я\nа\nЁ\nё\nе\nж', 'а\nе\nЁ\nё\nж\nя'],
    ['Alphabetical', false, '😀\na\n中\nZ', '😀\na\nZ\n中'],
    ['Alphabetical', false, 'a​b\nab', 'a​b\nab'],
    [
      'Natural (file2 before file10)',
      false,
      'file10\nfile2\nfile1\nFile3\nfile02',
      'file1\nfile2\nfile02\nFile3\nfile10',
    ],
    ['Natural (file2 before file10)', false, '1.10.0\n1.9.0\n1.2.10\n1.2.9', '1.2.9\n1.2.10\n1.9.0\n1.10.0'],
    ['Natural (file2 before file10)', false, '-5\n3\n-10\n+2', '-5\n-10\n+2\n3'],
    [
      'Natural (file2 before file10)',
      true,
      'img12.png\nimg10.png\nIMG2.png\nimg1.png',
      'img1.png\nIMG2.png\nimg10.png\nimg12.png',
    ],
    ['Code point', false, 'b\nB\na\nA\nä\n_\n1\n \nZ', ' \n1\nA\nB\nZ\n_\na\nb\nä'],
    ['Code point', false, '￿\n😀\n\nz', 'z\n\n￿\n😀'],
    ['Length', false, 'ccc\na\nbb\n👍🏽\né\né\n', 'a\né\nbb\n👍🏽\né\nccc\n'],
  ];
  await fresh();
  await step('Order').click();
  const wrong = [];
  for (const [by, upper, text, expected] of rows) {
    await choose('Sort by', by);
    const box = step('Uppercase first');
    if (!(await box.isDisabled()) && (await box.getAttribute('aria-checked')) !== String(upper)) await box.click();
    await input.fill(text);
    const got = await result.inputValue();
    if (got !== expected) wrong.push({ by, upper, text, got });
  }
  check(
    `${T}: §10 sort rows give the specification's order in Chrome with the browser in sv-SE (the 'en' order is fixed)`,
    wrong.length === 0 && language[1] === 'sv-SE' && locale === 'sv-SE',
    wrong.length
      ? JSON.stringify(wrong)
      : `${rows.length} rows; navigator.language ${language.join(', default collator ')}`,
  );

  // The same collation in Node (this script) and in Chrome on 20 000 generated words, for each set of options.
  const words = corpus();
  const differences = [];
  for (const [name, options] of Object.entries(COLLATIONS)) {
    const inNode = order(words, options);
    const inChrome = await page.evaluate(
      ([list, o]) => {
        const { compare } = new Intl.Collator('en', o);
        return list.map((_, i) => i).sort((i, j) => compare(list[i], list[j]));
      },
      [words, options],
    );
    const at = inNode.findIndex((v, i) => v !== inChrome[i]);
    if (at !== -1)
      differences.push(
        `${name}: first at ${at} (${JSON.stringify(words[inNode[at]])} vs ${JSON.stringify(words[inChrome[at]])})`,
      );
  }
  check(
    `${T}: Node ${process.version} (ICU ${process.versions.icu}) and Chrome sort 20,000 words the same with every collation of §5.9.2`,
    differences.length === 0,
    differences.join('; ') || `${Object.keys(COLLATIONS).length} collations agree`,
  );

  // §8: the keyboard — Tab goes through the steps top to bottom (a step's options only when it is on), then the
  // input, Use as input, Copy and the result.
  await fresh();
  await input.fill('b\na');
  await step('Filter').click();
  await step('Split lines').focus();
  const tabbed = [];
  for (let i = 0; i < 16; i++) {
    await page.keyboard.press('Tab');
    tabbed.push(
      await page.evaluate(() => {
        const el = document.activeElement;
        return (
          el.getAttribute('aria-label') ||
          el.labels?.[0]?.textContent ||
          el.getAttribute('role') ||
          el.textContent.trim().slice(0, 20)
        );
      }),
    );
  }
  const expectedTabs =
    'Trim → Filter → Filter mode → Filter text → Match case → Remove blank lines → Duplicates → Order → Prefix and suffix → Number lines → Join into one line → Input → Use as input → Copy → Result';
  check(
    `${T}: §8 Tab passes the steps top to bottom (options of the enabled step only), then Input, Use as input, Copy, Result`,
    tabbed.slice(0, 15).join(' → ') === expectedTabs,
    tabbed.join(' → '),
  );

  // §12: the limits, timed in the browser. `longest` is the longest task on the page's thread meanwhile.
  const timed = (text, done) =>
    page.evaluate(
      async ([value, want]) => {
        const field = document.querySelector('#lines-input');
        const status = () => document.querySelector('[data-part="summary"]').textContent;
        const error = () => document.querySelector('[data-part="error"]').textContent;
        let longest = 0;
        const observer = new PerformanceObserver(list => {
          for (const e of list.getEntries()) longest = Math.max(longest, e.duration);
        });
        observer.observe({ type: 'longtask', buffered: false });
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        const start = performance.now();
        let firstFrame = 0;
        requestAnimationFrame(() => (firstFrame = performance.now() - start));
        setter.call(field, value);
        field.dispatchEvent(new Event('input', { bubbles: true }));
        const ready = () => (want.startsWith('error:') ? error() === want.slice(6) : status() === want);
        while (!ready() && performance.now() - start < 20_000) await new Promise(r => requestAnimationFrame(r));
        const elapsed = performance.now() - start;
        await new Promise(r => setTimeout(r, 100));
        observer.disconnect();
        return {
          elapsed: Math.round(elapsed),
          firstFrame: Math.round(firstFrame),
          longest: Math.round(longest),
          ok: ready(),
          status: status(),
          error: error(),
        };
      },
      [text, done],
    );
  /** The text box's own cost: the same text into a bare textarea, no tool. */
  const textBox = text =>
    page.evaluate(async value => {
      const box = document.createElement('textarea');
      box.setAttribute('wrap', 'off');
      document.body.append(box);
      const start = performance.now();
      box.value = value;
      void box.scrollHeight;
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const ms = performance.now() - start;
      box.remove();
      return Math.round(ms);
    }, text);
  const gamma = n => Array.from({ length: n }, (_, i) => `gamma-${(i * 7919) % 100_000} item ${i % 10}`).join('\n');
  await fresh();
  await step('Order').click();
  await choose('Sort by', 'Natural (file2 before file10)');
  const live = await timed(gamma(20_000), '20,000 lines in, 20,000 out');
  const liveBox = await textBox(gamma(20_000));
  await put('');
  const delayed = await timed(gamma(200_000), '200,000 lines in, 200,000 out');
  const delayedBox = await textBox(gamma(200_000));
  const sortedHead = (await result.inputValue()).slice(0, 40);
  await page.getByRole('radio', { name: 'Shuffle', exact: true }).click();
  await settled();
  const shuffledHead = (await result.inputValue()).split('\n').slice(0, 3);
  await step('Number lines').click();
  await settled();
  const numberedHead = (await result.inputValue()).split('\n').slice(0, 3);
  await put('');
  const million = await timed(
    'x\n'.repeat(1_000_000),
    'error:Text has 1,000,000 lines. This tool works with up to 200,000 lines.',
  );
  await put('');
  const millionBox = await textBox('x\n'.repeat(1_000_000));
  const huge = await timed('a'.repeat(8_388_609), 'error:Text is larger than 8 MB. This tool works with up to 8 MB.');
  const workers = page.workers().map(w => new URL(w.url()).pathname);
  await put('');
  check(
    `${T}: §12 20,000 lines follow the edit on the page; 200,000 sort Natural in the module worker, the page's long frames only the text boxes' own; the shuffled order holds; 1,000,000 lines and 8 Mi + 1 characters are refused at once`,
    live.ok &&
      delayed.ok &&
      million.ok &&
      huge.ok &&
      // The page's own work stays out of the long frames: what is left is the text box's rendering (measured on a bare
      // textarea with the same text; one run varies by about a tenth).
      delayed.longest <= delayedBox * 1.2 + 200 &&
      million.longest <= millionBox * 1.2 + 200 &&
      sortedHead.startsWith('gamma-0 item 0\n') &&
      numberedHead.join() === shuffledHead.map((l, i) => `${i + 1}. ${l}`).join() &&
      workers.some(w => /\/assets\/lines\.worker-[\w-]+\.js$/.test(w)),
    [
      `20k live: result ${live.elapsed} ms, longest task ${live.longest} ms (bare textarea ${liveBox} ms)`,
      `200k Natural: result ${delayed.elapsed} ms (300 ms of it the settle), longest task ${delayed.longest} ms (bare textarea ${delayedBox} ms)`,
      `1M lines refused in ${million.elapsed} ms, longest task ${million.longest} ms (bare textarea ${millionBox} ms)`,
      `8 Mi + 1 refused in ${huge.elapsed} ms, longest task ${huge.longest} ms`,
      `workers ${workers.join(', ')}`,
    ].join('; '),
  );

  // The page in the light and the dark theme.
  await fresh();
  await input.fill('item10\nitem2\n  item1  \n\nitem2\nItem3\n');
  await step('Trim').click();
  await step('Remove blank lines').click();
  await step('Duplicates').click();
  await step('Order').click();
  await choose('Sort by', 'Natural (file2 before file10)');
  await step('Number lines').click();
  await settledShot(shoot, page, 'tool-lines-05-natural-light.png');
  await inDarkTheme(ctx, base, page, async () => {
    await sleep(300);
    await settledShot(shoot, page, 'tool-lines-06-natural-dark.png');
    await put('x\n'.repeat(200_001));
    await settledShot(shoot, page.locator('[data-slot="tool-pane"]').first(), 'tool-lines-07-limit-dark.png');
  });
  const limit = (await errorLine.innerText()).trim();
  check(
    `${T}: the limit is said under the input`,
    limit === 'Text has 200,001 lines. This tool works with up to 200,000 lines.',
    limit,
  );
  await put('');
  // The steps of the screenshots are saved: the next module opens Lines with its defaults.
  await forgetSavedParameters(page, 'lines');
};
