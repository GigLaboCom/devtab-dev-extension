// The SQL Formatter in the built extension (docs/tools/specs/sql-format.md): its scenarios (§2) with the page's real
// controls; what loads where — nothing of the library on the start route, on the tool's page only the worker of the
// chosen dialect (the library's core and that one dialect), proved by the requests the page makes; every one of the 14
// dialects formatting in its module worker under the extension's CSP with no violation and no eval in its source; the
// limits of §12 timed in the browser (a megabyte by Run, Cancel and Esc, thousands of nested parentheses, one enormous
// IN list) with the longest task on the page; pasting SQL into the start page's field (§7); an entry opened back from
// the tool's own history (D17); the options kept as saved parameters (D21); the page in the light and the dark theme.
// Run by scripts/e2e-tools.mjs.
//
// It navigates with location.replace (the e2e modules share one tab, and Chrome keeps 50 entries of its history) and
// puts the page's clipboard back before it ends.

/* global chrome, document, location, HTMLTextAreaElement, requestAnimationFrame, DataTransfer, ClipboardEvent, Worker, self -- callbacks run in the page or the worker */

import {
  forgetSavedParameters,
  inDarkTheme,
  settledShot,
  stubClipboard,
  waitForHistoryRecord,
} from '../e2e-helpers.mjs';

const T = 'SQL Formatter';
const NOT_CHECKED = "Formatting doesn't check that the query is valid.";
const LARGE = 'Large input: press Run (Ctrl+Enter) to format it.';
const lines = (...rows) => rows.join('\n');

/** A query per dialect that only that dialect (or few) reads, and what it becomes. */
const SAMPLES = {
  'Standard SQL': [
    'select id, name from users where active = 1',
    lines('SELECT', '  id,', '  name', 'FROM', '  users', 'WHERE', '  active = 1'),
  ],
  PostgreSQL: [
    "select data->>'name', created::date from t where id = $1",
    lines('SELECT', "  data ->> 'name',", '  created::date', 'FROM', '  t', 'WHERE', '  id = $1'),
  ],
  MySQL: [
    'select `order`, count(*) from `t` group by `order`',
    lines('SELECT', '  `order`,', '  count(*)', 'FROM', '  `t`', 'GROUP BY', '  `order`'),
  ],
  MariaDB: ["select 'it\\'s' as s # note", lines('SELECT', "  'it\\'s' AS s # note")],
  SQLite: ['select a from t where n = :name', lines('SELECT', '  a', 'FROM', '  t', 'WHERE', '  n = :name')],
  'SQL Server': [
    'select top 10 [Order Id] from [dbo].[Orders]',
    lines('SELECT', '  TOP 10 [Order Id]', 'FROM', '  [dbo].[Orders]'),
  ],
  'Oracle PL/SQL': ["select q'[it's]' from dual", lines('SELECT', "  q'[it's]'", 'FROM', '  dual')],
  BigQuery: [
    'select * from `proj.ds.t` where n = @name',
    lines('SELECT', '  *', 'FROM', '  `proj.ds.t`', 'WHERE', '  n = @name'),
  ],
  Snowflake: ['select $$a /* b$$ as s', lines('SELECT', '  $$a /* b$$ AS s')],
  Redshift: ['select a::int from t', lines('SELECT', '  a::INT', 'FROM', '  t')],
  Spark: ['select ${var} from t', lines('SELECT', '  ${var}', 'FROM', '  t')],
  Trino: ['select a from t where id = ?', lines('SELECT', '  a', 'FROM', '  t', 'WHERE', '  id = ?')],
  DuckDB: ["select E'a\\'b' as s", lines('SELECT', "  E'a\\'b' AS s")],
  ClickHouse: ['select {id:UInt32} as a # c', lines('SELECT', '  {id:UInt32} AS a # c')],
};

export default async ({ ctx, page, base, check, shoot, sleep }) => {
  const requests = [];
  const workers = [];
  const workerConsole = [];
  const onRequest = r => requests.push({ url: r.url(), type: r.resourceType() });
  const onWorker = w => {
    workers.push(w);
    w.on?.('console', m => workerConsole.push(`${m.type()}: ${m.text()}`));
  };
  page.on('request', onRequest);
  page.on('worker', onWorker);
  // A worker's script is fetched for the worker, not by the page: the files of the library are the workers' own URLs,
  // and each worker reports what it fetched itself (its resource timing — nothing, it is one file).
  const sqlWorkerRequests = () => workers.map(w => w.url());
  const named = (urls, name) => urls.filter(u => new RegExp(`/assets/${name}\\.worker-`).test(u));
  const fetchedBy = worker =>
    worker.evaluate(() => performance.getEntriesByType('resource').map(e => e.name)).catch(() => ['(gone)']);
  // The page's own loads (the size measurement below fetches the workers' sources on purpose: `fetch`, not counted).
  const libraryOnPage = () => requests.filter(r => r.type !== 'fetch' && /\.worker-|sql-formatter/.test(r.url));

  /** Moves inside the page without a new entry of the tab's history. */
  const go = async hash => {
    // From another origin (a blank tab) the first move is an ordinary navigation: a page may not replace itself with
    // an extension page.
    if (!page.url().startsWith(base)) await page.goto(`${base}${hash}`);
    else await page.evaluate(url => location.replace(url), `${base}${hash}`);
  };

  // Nothing of the tool's code on the start route: reloaded afresh, its requests are watched until it is idle.
  await go('#/start');
  await page.getByRole('combobox', { name: 'Find a tool or search the web' }).waitFor();
  requests.length = 0;
  await page.reload();
  await page.getByRole('combobox', { name: 'Find a tool or search the web' }).waitFor();
  await page.waitForLoadState('networkidle').catch(() => {});
  await sleep(500);
  const startRequests = requests.map(r => r.url);
  check(
    `${T}: the start route loads nothing of the tool — no component chunk, no worker, no library`,
    startRequests.length > 0 &&
      !startRequests.some(u => /SqlFormatTool-|sql-formatter|\.worker-/.test(u)) &&
      page.workers().length === 0,
    `${startRequests.length} requests: ${startRequests.map(u => u.split('/').pop()).join(', ')}`,
  );

  await go('#/tools/sql-format');
  const input = page.locator('#sql-format-input');
  const output = page.locator('#sql-format-output');
  await input.waitFor();
  const clipboard = await stubClipboard(page);
  const status = page.locator('[data-part="status"]');
  const radio = name => page.getByRole('radio', { name, exact: true });
  const button = name => page.getByRole('button', { name, exact: true });
  const choose = async (label, option) => {
    await page.getByLabel(label, { exact: true }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
    await page.getByRole('listbox').waitFor({ state: 'detached', timeout: 5_000 });
  };
  // A result counts once it is the input's own, not the previous one kept while the new one is under way.
  const result = async (expected, timeout = 8_000) => {
    await page
      .waitForFunction(
        want =>
          document.querySelector('#sql-format-output')?.value === want &&
          !document.querySelector('[data-part="status"]')?.hasAttribute('data-stale'),
        expected,
        { timeout },
      )
      .catch(() => {});
    return output.inputValue().catch(() => null);
  };
  const said = async (expected, timeout = 8_000) => {
    await page
      .waitForFunction(
        want => {
          const line = document.querySelector('[data-part="status"]');
          return line?.textContent.trim() === want && !line.hasAttribute('data-stale');
        },
        expected,
        { timeout },
      )
      .catch(() => {});
    return (await status.innerText()).trim();
  };
  /** Sets the input as a paste would (one input event), without sending megabytes through the keyboard. */
  const put = text =>
    page.evaluate(value => {
      const field = document.querySelector('#sql-format-input');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, value);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }, text);

  // Empty state (§4, §8): and still no worker — the library loads when there is a query.
  const toolChunk = requests.map(r => r.url).filter(u => /SqlFormatTool-/.test(u));
  check(
    `${T}: opens empty in Standard SQL, UPPER, 2 spaces, Standard; Copy and Save off; the component chunk loaded, no worker yet`,
    (await page.getByLabel('Dialect', { exact: true }).innerText()).includes('Standard SQL') &&
      (await radio('UPPER').getAttribute('aria-checked')) === 'true' &&
      (await page.getByLabel('Indent', { exact: true }).innerText()).includes('2 spaces') &&
      (await page.getByLabel('Layout', { exact: true }).innerText()).includes('Standard') &&
      (await input.getAttribute('placeholder')) === 'select id, name from users where active = 1' &&
      (await input.getAttribute('spellcheck')) === 'false' &&
      (await button('Copy').isDisabled()) &&
      (await button('Save').isDisabled()) &&
      (await page.locator('[data-part="note"]').innerText()).trim() === NOT_CHECKED &&
      toolChunk.length === 1 &&
      sqlWorkerRequests().length === 0,
    toolChunk.map(u => u.split('/').pop()).join(', '),
  );

  // §2.1: a query from a log; Copy. The Standard SQL worker is the one request.
  await input.fill('select id, name from users where active = 1 and age > 18 order by name');
  const first = await result(
    lines(
      'SELECT',
      '  id,',
      '  name',
      'FROM',
      '  users',
      'WHERE',
      '  active = 1',
      '  AND age > 18',
      'ORDER BY',
      '  name',
    ),
  );
  await button('Copy').click();
  await page.getByRole('button', { name: 'Copied', exact: true }).waitFor({ timeout: 2_000 });
  const copied = await clipboard.copied();
  check(
    `${T}: §2.1 a query from a log is laid out at once and copied — formatted in the Standard SQL worker, the only file of the library requested`,
    first ===
      lines(
        'SELECT',
        '  id,',
        '  name',
        'FROM',
        '  users',
        'WHERE',
        '  active = 1',
        '  AND age > 18',
        'ORDER BY',
        '  name',
      ) &&
      copied.at(-1) === first &&
      sqlWorkerRequests().length === 1 &&
      named(sqlWorkerRequests(), 'sql').length === 1 &&
      (await fetchedBy(workers[0])).length === 0 &&
      libraryOnPage().length === 0 &&
      page.workers().length === 1,
    sqlWorkerRequests()
      .map(u => u.split('/').pop())
      .join(', '),
  );
  await settledShot(shoot, page, 'tool-sql-format-01-log-query-light.png');

  // §2.2: PostgreSQL syntax under Standard SQL — the error with the hint and its place; PostgreSQL lays it out.
  await input.fill('select created::date from t');
  const castError = await said(
    'Line 1, column 15: unexpected "::date fro". Standard SQL doesn\'t have this syntax; try PostgreSQL, Redshift, DuckDB, Snowflake.',
  );
  await page.getByRole('button', { name: /^Line 1, column 15/ }).click();
  const caret = await page.evaluate(() => {
    const el = document.querySelector('#sql-format-input');
    return { focused: document.activeElement === el, at: el.selectionStart };
  });
  await settledShot(shoot, page, 'tool-sql-format-02-dialect-hint-light.png');
  await choose('Dialect', 'PostgreSQL');
  const cast = await result(lines('SELECT', '  created::date', 'FROM', '  t'));
  check(
    `${T}: §2.2 :: under Standard SQL names its place and the dialects to try (no alert); PostgreSQL lays it out in its own worker`,
    castError ===
      'Line 1, column 15: unexpected "::date fro". Standard SQL doesn\'t have this syntax; try PostgreSQL, Redshift, DuckDB, Snowflake.' &&
      caret.focused &&
      caret.at === 14 &&
      (await page.getByRole('alert').count()) === 0 &&
      cast === lines('SELECT', '  created::date', 'FROM', '  t') &&
      named(sqlWorkerRequests(), 'postgresql').length === 1 &&
      sqlWorkerRequests().length === 2 &&
      page.workers().length === 1,
    `${JSON.stringify(caret)}; ${sqlWorkerRequests()
      .map(u => u.split('/').pop())
      .join(', ')}`,
  );

  // §2.3, §2.4, §2.5 and the layouts.
  await choose('Dialect', 'Standard SQL');
  await radio('lower').click();
  await input.fill('SELECT id FROM users WHERE x = 1');
  const lower = await result(lines('select', '  id', 'from', '  users', 'where', '  x = 1'));
  await radio('UPPER').click();
  await input.fill('-- leading comment\nselect a, -- trailing\n /* block */ b from t /* end */');
  const comments = await result(
    lines('-- leading comment', 'SELECT', '  a, -- trailing', '  /* block */', '  b', 'FROM', '  t /* end */'),
  );
  await input.fill('select (a from t');
  const early = await said('Line 1, column 17: the query ends too early (an unclosed parenthesis or CASE?)');
  await input.fill('select 1 /* abc');
  const unclosed = await said('Line 1, column 10: unclosed comment: /* without */');
  check(
    `${T}: §2.3 keywords lower case; §2.4 comments stay in place; §2.5 a cut-off query and an unclosed comment are named with their place`,
    lower === lines('select', '  id', 'from', '  users', 'where', '  x = 1') &&
      comments ===
        lines('-- leading comment', 'SELECT', '  a, -- trailing', '  /* block */', '  b', 'FROM', '  t /* end */') &&
      early === 'Line 1, column 17: the query ends too early (an unclosed parenthesis or CASE?)' &&
      unclosed === 'Line 1, column 10: unclosed comment: /* without */',
    JSON.stringify({ early, unclosed }),
  );
  await input.fill('select a, b from t where x = 1 and y = 2');
  await choose('Indent', 'Tab');
  const tabbed = await result(lines('SELECT', '\ta,', '\tb', 'FROM', '\tt', 'WHERE', '\tx = 1', '\tAND y = 2'));
  await choose('Layout', 'Tabular left');
  const tabular = await result(
    lines('SELECT    a,', '          b', 'FROM      t', 'WHERE     x = 1', 'AND       y = 2'),
  );
  const indentNow = await page.getByLabel('Indent', { exact: true }).innerText();
  await page.getByLabel('Indent', { exact: true }).click();
  const tabOffered = await page.getByRole('option', { name: 'Tab', exact: true }).getAttribute('aria-disabled');
  await page.keyboard.press('Escape');
  await page.getByRole('listbox').waitFor({ state: 'detached', timeout: 5_000 });
  await settledShot(shoot, page, 'tool-sql-format-03-tabular-light.png');
  await choose('Layout', 'Standard');
  check(
    `${T}: Tab indents with tabs; Tabular left aligns keywords in a column of 10 and takes Tab out of the Indent list`,
    tabbed === lines('SELECT', '\ta,', '\tb', 'FROM', '\tt', 'WHERE', '\tx = 1', '\tAND y = 2') &&
      tabular === lines('SELECT    a,', '          b', 'FROM      t', 'WHERE     x = 1', 'AND       y = 2') &&
      indentNow.includes('2 spaces') &&
      tabOffered === 'true',
    JSON.stringify({ indentNow, tabOffered }),
  );

  // Every dialect: its own worker, its sample formatted, no CSP violation in the worker, no eval in its source; bytes.
  const perDialect = [];
  for (const [label, [query, expected]] of Object.entries(SAMPLES)) {
    const before = sqlWorkerRequests().length;
    const workersBefore = workers.length;
    await choose('Dialect', label);
    await put(query);
    const got = await result(expected);
    const worker = workers.slice(workersBefore).at(-1) ?? page.workers().at(-1);
    // The worker's own report of violations, then the same query once more inside it watched.
    let violations = null;
    if (worker) {
      violations = await worker
        .evaluate(() => {
          self.__csp = [];
          self.addEventListener('securitypolicyviolation', e => self.__csp.push(e.violatedDirective));
          return [];
        })
        .catch(() => null);
      await put(`${query} `);
      await result(expected);
      violations = await worker.evaluate(() => self.__csp).catch(() => null);
    }
    const url = sqlWorkerRequests().slice(before).at(-1) ?? worker?.url() ?? '';
    const size = await page.evaluate(async src => {
      const text = await fetch(src).then(r => r.text());
      const gz = await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
      return {
        raw: new TextEncoder().encode(text).length,
        gzip: gz.byteLength,
        evals: (text.match(/\beval\s*\(|new\s+Function\b|\bFunction\s*\(/g) ?? []).length,
      };
    }, url);
    const loads = worker ? await fetchedBy(worker) : ['(no worker)'];
    perDialect.push({
      label,
      ok: got === expected,
      file: url.split('/').pop(),
      newRequests: sqlWorkerRequests().length - before,
      loads,
      violations,
      ...size,
    });
  }
  const failed = perDialect.filter(
    d =>
      !d.ok ||
      d.evals !== 0 ||
      d.violations === null ||
      d.violations.length > 0 ||
      d.newRequests > 1 ||
      d.loads.length > 0,
  );
  check(
    `${T}: all 14 dialects format their own syntax, each in its own module worker (one request: the core and that dialect), under the extension's CSP — no violation, no eval or Function in any worker`,
    failed.length === 0 &&
      perDialect.length === 14 &&
      new Set(perDialect.map(d => d.file)).size === 14 &&
      workerConsole.length === 0 &&
      libraryOnPage().length === 0,
    perDialect
      .map(
        d =>
          `${d.label} ${d.file} ${d.raw} B / ${d.gzip} B gzip${d.ok ? '' : ' WRONG'}${d.violations === null ? ' (no CSP watch)' : d.violations.length ? ` CSP ${d.violations}` : ''}${d.newRequests > 1 ? ` ${d.newRequests} workers` : ''}${d.loads.length ? ` fetched ${d.loads.join(',')}` : ''}`,
      )
      .join('; ') + (workerConsole.length ? ` | worker console: ${workerConsole.join(' | ')}` : ''),
  );
  await choose('Dialect', 'PostgreSQL');

  // §12: a megabyte by Run, in the worker; the page keeps drawing frames. The tool's work and the text boxes apart.
  const big = await page.evaluate(() => {
    const parts = [];
    let size = 0;
    for (let i = 0; size < 1024 * 1024; i++) {
      const q = `select u.id, u.name, count(o.id) as orders, sum(o.total) as total from users u left join orders o on o.user_id = u.id where u.active = 1 and u.country in ('DE', 'FR', 'NL') and o.created_at > $${(i % 9) + 1} group by u.id, u.name having count(o.id) > 5 order by total desc;\n`;
      parts.push(q);
      size += q.length;
    }
    return parts.join('');
  });
  const pasted = await page.evaluate(async text => {
    const field = document.querySelector('#sql-format-input');
    const start = performance.now();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, text);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return Math.round(performance.now() - start);
  }, big);
  const largeSaid = await said(LARGE);
  await sleep(300);
  const runOn = async (label, doneWhen) =>
    page.evaluate(
      async ([what, until]) => {
        // `until`: the message the run starts from (Large input…), which is not its end.
        let longest = 0;
        const observer = new PerformanceObserver(list => {
          for (const e of list.getEntries()) longest = Math.max(longest, e.duration);
        });
        observer.observe({ type: 'longtask', buffered: false });
        const start = performance.now();
        if (what) [...document.querySelectorAll('button')].find(b => b.textContent === what).click();
        let sawFormatting = false;
        let frames = 0;
        const out = () => document.querySelector('#sql-format-output')?.value ?? '';
        const summary = () => document.querySelector('[data-part="summary"]')?.textContent ?? '';
        const line = () => document.querySelector('[data-part="status"]');
        // Settled: a result, or a message that is not a state of the run (an error, the time limit).
        const finished = () => {
          const said = line().textContent.trim();
          return (
            !line().hasAttribute('data-stale') &&
            (out() !== '' ||
              summary() !== '' ||
              (said !== '' && said !== 'Formatting…' && said !== until && !said.startsWith('Loading')))
          );
        };
        while (!finished() && performance.now() - start < 60_000) {
          sawFormatting ||= line().textContent.includes('Formatting…');
          await new Promise(r => requestAnimationFrame(r));
          frames++;
        }
        const elapsed = performance.now() - start;
        observer.disconnect();
        return {
          elapsed: Math.round(elapsed),
          longest: Math.round(longest),
          frames,
          sawFormatting,
          lines: out().split('\n').length,
          summary: summary(),
          status: line().textContent.trim(),
        };
      },
      [label, doneWhen],
    );
  const mega = await runOn('Run', LARGE);
  // The tool's work alone: the same megabyte posted to a fresh PostgreSQL worker straight from the page.
  const pgUrl = named(sqlWorkerRequests(), 'postgresql')[0];
  const workerOnly = await page.evaluate(
    async ([url, text]) => {
      const w = new Worker(url, { type: 'module' });
      await new Promise(r => {
        w.onmessage = e => e.data.type === 'ready' && r();
      });
      const start = performance.now();
      const reply = await new Promise(r => {
        w.onmessage = e => e.data.type === 'result' && r(e.data);
        w.postMessage({
          id: 1,
          text,
          options: { dialect: 'postgresql', keywordCase: 'upper', indent: 2, layout: 'standard' },
        });
      });
      const ms = performance.now() - start;
      w.terminate();
      return { ms: Math.round(ms), ok: reply.result.ok, chars: reply.result.ok ? reply.result.text.length : 0 };
    },
    [pgUrl, big],
  );
  check(
    `${T}: §2.6, §12 a megabyte of SQL formats by Run in the worker — "Formatting…" meanwhile, the page keeps drawing frames`,
    largeSaid === LARGE &&
      mega.sawFormatting &&
      mega.lines > 80_000 &&
      mega.longest < 1_500 &&
      workerOnly.ok &&
      !(await button('Copy').isDisabled()),
    `${(big.length / 1048576).toFixed(2)} Mi characters (setting the input field: ${pasted} ms); Run → result shown ${mega.elapsed} ms, ${mega.frames} frames meanwhile, longest task on the page ${mega.longest} ms (the result field filled with ${mega.lines} lines); the worker's work alone ${workerOnly.ms} ms for ${workerOnly.chars} characters`,
  );
  await settledShot(shoot, page, 'tool-sql-format-04-megabyte-light.png');

  await put(`${big}select 1;`);
  await said(LARGE);
  await button('Run').click();
  await button('Cancel').waitFor({ timeout: 2_000 });
  await button('Cancel').click();
  const afterCancel = await said(LARGE);
  await input.focus();
  await page.keyboard.press('Control+Enter');
  await said('Formatting…', 2_000);
  await page.keyboard.press('Escape');
  const afterEscape = await said(LARGE);
  await put('x'.repeat(2 * 1024 * 1024 + 1));
  const refused = await said('Input is larger than 2 MB. This tool formats up to 2 MB.');
  check(
    `${T}: Cancel and Esc stop a Run under way (Ctrl+Enter starts one); more than 2 Mi characters is refused at once`,
    afterCancel === LARGE &&
      afterEscape === LARGE &&
      refused === 'Input is larger than 2 MB. This tool formats up to 2 MB.' &&
      (await button('Run').count()) === 0,
    JSON.stringify({ afterCancel, afterEscape, refused }),
  );

  // Pathological inputs: nested parentheses and subqueries (live: they are small) up to past the parser's stack in a
  // worker, one enormous IN list by Run (its 200 007 lines are a summary).
  await choose('Dialect', 'Standard SQL');
  const deep = {};
  const putDeep = (kind, d) =>
    page.evaluate(
      ([k, n]) => {
        let text = 'select 1';
        if (k === 'parentheses') text = `select ${'('.repeat(n)}1${')'.repeat(n)}`;
        else for (let i = 0; i < n; i++) text = `select * from (${text}) t${i}`;
        const field = document.querySelector('#sql-format-input');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, text);
        field.dispatchEvent(new Event('input', { bubbles: true }));
      },
      [kind, d],
    );
  for (const [kind, depth] of [
    ['parentheses', 100],
    ['parentheses', 200],
    ['parentheses', 400],
    ['parentheses', 1000],
    ['parentheses', 5000],
    ['subqueries', 100],
    ['subqueries', 200],
    ['subqueries', 400],
  ]) {
    await put('');
    await putDeep(kind, depth);
    deep[`${depth} ${kind}`] = await runOn(null, '');
  }
  await put(`select * from t where id in (${Array.from({ length: 200_000 }, (_, i) => i).join(', ')})`);
  await said(LARGE);
  const inList = await runOn('Run', LARGE);
  const TOO_DEEP = 'the query is nested too deeply to lay out';
  // Deeper than MAX_NESTING (200) brackets is refused before the library, at the 201st bracket (docs/tools/limits.md):
  // the parser costs about the square of the depth (1,000 levels took 14 s) and overflows its stack.
  const NESTED = /^Line 1, column \d+: brackets nest more than 200 levels deep: the formatter would take too long$/;
  const formattedOrRefused = Object.values(deep).every(
    r => r.lines > 1 || NESTED.test(r.status) || r.status === TOO_DEEP,
  );
  check(
    `${T}: pathological inputs — nesting up to 200 brackets formats, deeper is refused in words at once (MAX_NESTING), never a crash; 200 nested subqueries (§12) format; an IN list of 200 000 values formats by Run into a summary; the page never stalls`,
    formattedOrRefused &&
      deep['100 parentheses'].lines > 100 &&
      deep['200 subqueries'].lines > 200 &&
      deep['200 parentheses'].lines > 1 &&
      NESTED.test(deep['400 parentheses'].status) &&
      NESTED.test(deep['1000 parentheses'].status) &&
      NESTED.test(deep['5000 parentheses'].status) &&
      NESTED.test(deep['400 subqueries'].status) &&
      /^Result: [\d.]+ MB, 200,007 lines\. Too large to show here\.$/.test(inList.summary) &&
      Math.max(inList.longest, ...Object.values(deep).map(r => r.longest)) < 1_500,
    `${Object.entries(deep)
      .map(
        ([k, r]) =>
          `${k}: ${r.elapsed} ms, ${r.lines > 1 ? `${r.lines} lines` : `"${r.status}"`} (longest task ${r.longest} ms)`,
      )
      .join(
        '; ',
      )}; IN (200 000 values, 1.4 MB): ${inList.elapsed} ms, ${inList.summary} (longest ${inList.longest} ms)`,
  );
  await put('');

  // §7: SQL pasted into the start page's field opens the tool with it; prose does not.
  const paste = async text => {
    await go('#/start');
    const field = page.getByRole('combobox', { name: 'Find a tool or search the web' });
    await field.waitFor();
    await field.focus();
    await page.evaluate(value => {
      const data = new DataTransfer();
      data.setData('text/plain', value);
      document.activeElement.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    }, text);
  };
  await paste('select id, name from users where id = 1');
  await page.waitForFunction(() => location.hash === '#/tools/sql-format', null, { timeout: 5_000 }).catch(() => {});
  await input.waitFor({ timeout: 5_000 }).catch(() => {});
  const opened = {
    hash: await page.evaluate(() => location.hash),
    input: await input.inputValue().catch(() => null),
    result: await result(lines('SELECT', '  id,', '  name', 'FROM', '  users', 'WHERE', '  id = 1')),
  };
  check(
    `${T}: §7 SQL pasted into the start page opens the tool with it, formatted`,
    opened.hash === '#/tools/sql-format' &&
      opened.input === 'select id, name from users where id = 1' &&
      opened.result === lines('SELECT', '  id,', '  name', 'FROM', '  users', 'WHERE', '  id = 1'),
    JSON.stringify(opened),
  );
  const elsewhere = [];
  for (const text of ['Select the file from the list', 'Update the docs, then set a reminder', 'a,b\n1,2\n3,4']) {
    await paste(text);
    await sleep(300);
    if ((await page.evaluate(() => location.hash)) === '#/tools/sql-format') elsewhere.push(text);
  }
  check(`${T}: §7 prose and CSV do not open it`, elsewhere.length === 0, elsewhere.join(' | '));

  // D17: a copied result is in the tool's history and opens back with its dialect and options; a query with a password
  // is not kept without a master password.
  await go('#/tools/sql-format');
  await input.waitFor();
  await choose('Dialect', 'SQL Server');
  await radio('Preserve').click();
  await choose('Indent', '4 spaces');
  await input.fill('select top 10 [Order Id] from t where a = 1');
  const kept = await result(lines('select', '    top 10 [Order Id]', 'from', '    t', 'where', '    a = 1'));
  await button('Copy').click();
  await page.getByRole('button', { name: 'Copied', exact: true }).waitFor({ timeout: 2_000 });
  const record = await waitForHistoryRecord(page, 'sql-format', r => r.label?.endsWith('copied')).catch(() => null);
  await input.fill("create user app identified by 'pw'");
  await result(lines('create user app identified BY', "  'pw'")).catch(() => {});
  await button('Copy')
    .click()
    .catch(() => {});
  await sleep(1_000);
  await page.reload();
  await input.waitFor();
  const recent = page.locator('.kit-tool-history-recent');
  await recent.locator('summary').waitFor({ timeout: 5_000 });
  await recent.locator('summary').click();
  const label = 'SQL Server · Preserve · 4 spaces · 43 characters · copied';
  const entry = recent.locator('.kit-history-entry', { hasText: label }).first();
  const listed = await entry.count();
  const secretListed = await recent.locator('.kit-history-entry', { hasText: 'With credentials' }).count();
  if (listed) await entry.getByRole('button', { name: 'Open' }).click();
  await page
    .locator('[data-restored]')
    .waitFor({ timeout: 5_000 })
    .catch(() => {});
  const restored = {
    record: record?.kind ?? null,
    listed,
    secretListed,
    input: await input.inputValue(),
    dialect: await page.getByLabel('Dialect', { exact: true }).innerText(),
    preserve: await radio('Preserve').getAttribute('aria-checked'),
    indent: await page.getByLabel('Indent', { exact: true }).innerText(),
    result: await result(kept ?? ''),
  };
  check(
    `${T}: a copied result is in the tool's history and opens back with its dialect, keyword case and indent; a query with a password is not kept without a master password`,
    restored.record === 'format' &&
      restored.listed > 0 &&
      restored.secretListed === 0 &&
      restored.input === 'select top 10 [Order Id] from t where a = 1' &&
      restored.dialect.includes('SQL Server') &&
      restored.preserve === 'true' &&
      restored.indent.includes('4 spaces') &&
      restored.result === kept,
    JSON.stringify(restored),
  );

  // Saved parameters (D21): the options chosen above (SQL Server, Preserve, 4 spaces) are kept, and so is a Layout
  // chosen now (written 400 ms after the change); the page opened again shows them, with an empty field. Then they are
  // forgotten: the light and dark screenshots open with the defaults, as before.
  const stored = () =>
    page.evaluate(async () => (await chrome.storage.local.get('toolSettings')).toolSettings?.params?.['sql-format']);
  await choose('Layout', 'Tabular left');
  for (let i = 0; i < 25 && (await stored())?.values?.layout !== 'tabularLeft'; i++) await sleep(200);
  await page.reload();
  await input.waitFor();
  const reopened = {
    dialect: await page.getByLabel('Dialect', { exact: true }).innerText(),
    preserve: await radio('Preserve').getAttribute('aria-checked'),
    indent: await page.getByLabel('Indent', { exact: true }).innerText(),
    layout: await page.getByLabel('Layout', { exact: true }).innerText(),
    input: await input.inputValue(),
  };
  check(
    `${T}: SQL Server, Preserve, 4 spaces and Tabular left chosen, the page opened again — as left, the field empty (saved parameters)`,
    reopened.dialect.includes('SQL Server') &&
      reopened.preserve === 'true' &&
      reopened.indent.includes('4 spaces') &&
      reopened.layout.includes('Tabular left') &&
      reopened.input === '',
    JSON.stringify({ reopened, stored: await stored() }),
  );
  await forgetSavedParameters(page, 'sql-format');

  // The page in the light and the dark theme (entered afresh).
  await page.reload();
  await input.waitFor();
  const sample = lines(
    '-- orders of the last week',
    "select u.id, u.name, count(o.id) as orders from users u left join orders o on o.user_id = u.id where o.created_at > now() - interval '7 days' group by u.id, u.name having count(o.id) > 5 order by orders desc;",
  );
  await choose('Dialect', 'PostgreSQL');
  await input.fill(sample);
  await page
    .waitForFunction(() => document.querySelector('#sql-format-output')?.value.startsWith('-- orders'), null, {
      timeout: 8_000,
    })
    .catch(() => {});
  await settledShot(shoot, page, 'tool-sql-format-05-postgresql-light.png');
  await inDarkTheme(ctx, base, page, async () => {
    await sleep(300);
    await settledShot(shoot, page, 'tool-sql-format-06-postgresql-dark.png');
    await choose('Layout', 'Tabular right');
    await sleep(500);
    await settledShot(shoot, page, 'tool-sql-format-07-tabular-dark.png');
    await choose('Layout', 'Standard');
    await choose('Dialect', 'Standard SQL');
    await input.fill('select created::date, [Order Id] from orders');
    await said(
      'Line 1, column 15: unexpected "::date, [O". Standard SQL doesn\'t have this syntax; try PostgreSQL, Redshift, DuckDB, Snowflake.',
    );
    await settledShot(shoot, page, 'tool-sql-format-08-error-dark.png');
  });

  await input.fill('');
  // The options the screenshots chose are saved parameters (written 400 ms after the change): the next module opens the
  // tool with its defaults.
  await sleep(500);
  await forgetSavedParameters(page, 'sql-format');
  await clipboard.restore();
  page.off('request', onRequest);
  page.off('worker', onWorker);
};
