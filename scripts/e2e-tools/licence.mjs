// The licence and the Pro plans in a build that follows a licence (pro-entitlement §8.5 E1–E13, E15; pro-plans-and-
// payment §8.5 P-E1…P-E14). Run by scripts/e2e-tools.mjs like the tools' modules (`pnpm test:e2e -- --only=licence`),
// but on a build and a browser of its own, as the free part of saved-settings.mjs:
//
//   1. the test key (scripts/licence-test-key.mjs, made once into .state/licence-test/) and the build
//      DEVTAB_VARIANT=edition:licensed,licence:test into .state/e2e/dist-licence (log: .state/e2e/licence-build.log);
//   2. Chrome for Testing headless with a profile of its own (.state/e2e/profiles/licence-*), the network journal of
//      Chromium (--log-net-log) to .state/e2e/licence-netlog-*.json;
//   3. each state is put into chrome.storage.local BEFORE the pages under test open — from one control page of the
//      extension, opened while the profile had no licence record: the records `entitlement` and `licence`, the fake
//      server's script `licenceFakeServer` (src/background/licence/scriptedFetch.ts) and the plans record `plans`, with
//      tokens signed here in Node with the test key's private half, from the real clock with an offset. The browser's
//      clock is never moved: "clock back" and "clock ahead" are a `seen` mark in the future (§4.1, rows 18 and 20);
//   4. before each scenario the licence's records are removed and the pages of the one before are closed; at the end
//      everything this module put is removed and the profile deleted.
//
// The fake server is a script in storage: the browser's fetch is never called, the test build's CSP is
// `connect-src 'self'`, and nothing here needs `pnpm mock:backend`. The links that open the site are fulfilled by
// Playwright (`context.route('https://web.example.invalid/**')`) with an empty page — no real site, no checkout, no
// payment, nothing handed to a program outside the browser.
//
// Row 7.1 — can the network journal see the service worker's requests? The probe below fetches the extension's own
// manifest from the service worker and from a page, then reads the journal. Found on Chrome for Testing 159
// (2026-11-24, NETLOG_FINDING): the journal (default capture) holds only the network service's own events — about two
// dozen, no URL request at all; the extension's files never pass through it, and the test build cannot send an http(s)
// request (`connect-src 'self'`). So whether a service worker's request would show with the extension as its initiator
// stays unproven, and the journal's check is the stronger "no http(s) or ws request at all". "Not one request to the
// server" rests on the fake server's `calls` and on the test build's CSP: a request to another origin would be refused
// before it left the browser.
//
// Then the build check: the test build and the plans' placeholder variant (DEVTAB_VARIANT=plans:samplePlans, into
// .state/e2e/dist-sample-plans) are both refused by scripts/validate-build.sh, naming Check 17 (E15, P-E14).

/* global chrome, getComputedStyle, IDBFactory -- page.evaluate callbacks run in the pages and the service worker */

import { spawnSync } from 'node:child_process';
import { webcrypto } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { historyRecords, waitForHistoryRecord } from '../e2e-helpers.mjs';

const T = 'Licence';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const STATE = join(ROOT, '.state/e2e');
const DIST = join(STATE, 'dist-licence');
const SAMPLE_DIST = join(STATE, 'dist-sample-plans');
const KEY_DIR = join(ROOT, '.state/licence-test');
const { subtle } = webcrypto;

/** What the netlog probe found (row 7.1); the run reports it again in its check. */
const NETLOG_FINDING =
  'the journal lists no chrome-extension:// fetch (neither the service worker’s nor the page’s) and no URL request at all; ' +
  'a service worker’s http(s) request cannot be attributed from it, so "not one request" rests on the fake server’s calls and the CSP';

// ---- The fixtures: placeholders only (XTS, .invalid), never the product's prices or hosts. ----
const INST = 'e2eInstTEST00000000000';
const LID = 'lic_E2E0000000000001';
const SECRET = `e2eSecret${'A'.repeat(32)}`;
const KEY = 'DTD-TEST-AAAA-BBBB-CCCC-DDDD';
const LICENCE_HOST = 'licence-fake.invalid';
const SITE = 'https://web.example.invalid';
const CATALOG = {
  v: 1,
  catalog: 'e2e-1',
  maxAge: 86_400,
  manageUrl: `${SITE}/pro/manage/`,
  plans: [
    {
      id: 'free',
      kind: 'free',
      term: null,
      name: 'Free',
      summary: 'Every tool, in full.',
      includes: ['Placeholder line'],
      price: null,
      priceNote: null,
      badge: null,
      checkoutUrl: null,
      until: null,
    },
    {
      id: 'pro-monthly',
      kind: 'paid',
      term: 'month',
      name: 'Monthly',
      summary: 'Billed every month.',
      includes: ['Placeholder line'],
      price: { amount: 1111, currency: 'XTS' },
      priceNote: 'Placeholder note.',
      badge: null,
      checkoutUrl: `${SITE}/pro/checkout/?plan=pro-monthly`,
      until: null,
    },
    {
      id: 'pro-annual',
      kind: 'paid',
      term: 'year',
      name: 'Annually',
      summary: 'Billed once a year.',
      includes: ['Everything in Monthly'],
      price: { amount: 11110, currency: 'XTS' },
      priceNote: 'Placeholder note.',
      badge: 'Placeholder badge',
      checkoutUrl: `${SITE}/pro/checkout/?plan=pro-annual`,
      until: null,
    },
  ],
};

// ---- The words the pages must show, exactly (src/app/settings/proTexts.ts, planTexts.ts; excluded.ts). ----
const DAY = 86_400_000;
const date = ms => new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(ms);
const time = ms => new Intl.DateTimeFormat('en-US', { timeStyle: 'short' }).format(ms);
const TEXT = {
  intro:
    'Every tool works in full in this version. Pro adds memory: the tool history and its archive, tools that remember your options, and copying automatically after generating.',
  alreadyBought: 'Already bought Pro? Paste your licence key.',
  disclosure: `Activating sends this key to ${LICENCE_HOST} to check it. After that, about once a week while you use the extension, it sends this installation’s random number and a secret issued for it — nothing about what you do in the tools.`,
  idle: `See the Pro plans and their prices. This downloads the list from ${LICENCE_HOST}; nothing about you is sent.`,
  active: 'Pro is active in this browser.',
  grace: (checked, valid) => `Couldn’t check your licence since ${date(checked)}. Pro stays until ${date(valid)}.`,
  expired: checked =>
    `Pro is paused: the licence couldn’t be checked since ${date(checked)}. Connect to the internet, check that your computer’s clock is right, and press Check now.`,
  ended: paid => `Your Pro subscription ended on ${date(paid)}. If you renewed it, press Check now.`,
  seatLimit:
    'This licence is active in as many browsers as it allows, so Pro is off here. Deactivate it in another browser, then activate here again.',
  invalid: 'The licence stored in this browser couldn’t be verified, so Pro is off. Activate your key again.',
  confirm: 'Deactivate Pro in this browser? Your history and saved options stay in this browser.',
  deactivated: 'Deactivated in this browser.',
  checked: 'Checked just now.',
  keyUnknown: 'This licence key isn’t known. Check that you copied all of it.',
  inactive: 'This licence isn’t active: the subscription ended or the purchase was refunded.',
  unreached: 'Couldn’t reach the licence server. Check your connection and try again.',
  busy: at => `The licence server is busy. Try again after ${time(at)}.`,
  badAnswer: 'The licence server’s answer couldn’t be verified, so nothing was changed. Try again later.',
  plansOffline: 'Couldn’t load the plans. Check your connection and try again.',
  plansStale: at => `These plans are from ${date(at)}. Couldn’t update them, so prices aren’t shown.`,
  plansUnsupported:
    'This version of the extension can’t read the current plans. Update the extension, or see the plans on web.example.invalid.',
  historyFree: 'History is part of Pro: nothing is kept.',
  historySection: 'History is part of Pro. Nothing you do in the tools is kept in this version.',
  historyOn: 'History is on: this tool’s work is kept in this browser.',
};

// ---- Tokens, signed here with the test key (§3.1: alg, kid, typ; ES256 over the two parts). ----
const b64u = bytes => Buffer.from(bytes).toString('base64url');
const encode = value => b64u(JSON.stringify(value));
const importSigner = jwk => subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
const signWith = async (signer, claims) => {
  const signed = `${encode({ alg: 'ES256', kid: signer.kid, typ: 'devtab-licence' })}.${encode(claims)}`;
  const signature = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signer.key, Buffer.from(signed));
  return `${signed}.${b64u(signature)}`;
};
const S = 1000;
/** An active token issued at `atMs` with the usual spans (7 / 23 / 30 days); `over` replaces fields. */
const claimsAt = (atMs, over = {}) => {
  const iat = Math.floor(atMs / S);
  return {
    v: 1,
    lid: LID,
    inst: INST,
    plan: 'pro',
    status: 'active',
    iat,
    chk: iat + 7 * 86_400,
    warn: iat + 23 * 86_400,
    exp: iat + 30 * 86_400,
    paid: null,
    ...over,
  };
};
/** An `ended` or `revoked` token: the server says "no" at the moment it signs (warn = exp = iat ≤ chk). */
const closedAt = (atMs, over) => {
  const iat = Math.floor(atMs / S);
  return claimsAt(atMs, { warn: iat, exp: iat, chk: iat + 7 * 86_400, ...over });
};

// ---- The network journal. ----
/** The requests in a journal: url, method, initiator. A journal cut short (the browser closed hard) is closed here. */
const journal = file => {
  if (!existsSync(file)) return { ok: false, requests: [] };
  const text = readFileSync(file, 'utf8');
  let log;
  try {
    log = JSON.parse(text);
  } catch {
    try {
      log = JSON.parse(`${text.replace(/,\s*$/, '')}]}`);
    } catch {
      return { ok: false, requests: [] };
    }
  }
  const types = log.constants?.logEventTypes ?? {};
  const wanted = new Set([types.URL_REQUEST_START_JOB, types.REQUEST_ALIVE].filter(v => v !== undefined));
  const requests = [];
  for (const event of log.events ?? [])
    if (wanted.has(event.type) && typeof event.params?.url === 'string')
      requests.push({ url: event.params.url, method: event.params.method, initiator: event.params.initiator });
  return { ok: true, requests };
};

export default async ({ check, shoot, report }) => {
  const watch = page => {
    page.on('console', m => {
      if (m.type() === 'error' || m.type() === 'warning')
        report.console.push({ type: m.type(), text: m.text(), url: m.location().url });
    });
    page.on('pageerror', e => report.console.push({ type: 'pageerror', text: String(e) }));
  };
  const poll = async (read, test, timeout = 10_000) => {
    const until = Date.now() + timeout;
    let last;
    for (;;) {
      last = await read();
      if (test(last) || Date.now() > until) return last;
      await new Promise(r => setTimeout(r, 100));
    }
  };

  // ---- 1. The key and the build. ----
  mkdirSync(STATE, { recursive: true });
  if (!existsSync(join(KEY_DIR, 'private.json'))) {
    const made = spawnSync(process.execPath, [join(ROOT, 'scripts/licence-test-key.mjs')], { encoding: 'utf8' });
    if (!check(`${T}: the test key is made (scripts/licence-test-key.mjs)`, made.status === 0, made.stderr)) return;
  }
  const build = (variant, out, log) => {
    const built = spawnSync('pnpm', ['exec', 'vite', 'build'], {
      cwd: join(ROOT, 'extension'),
      env: { ...process.env, CLI_CEB_DEV: 'false', DEVTAB_VARIANT: variant, DEVTAB_OUT_DIR: out },
      encoding: 'utf8',
      timeout: 600_000,
    });
    writeFileSync(join(STATE, log), `${built.stdout ?? ''}\n${built.stderr ?? ''}`);
    return check(`${T}: the build DEVTAB_VARIANT=${variant} is made`, built.status === 0, `exit ${built.status}`);
  };
  if (!build('edition:licensed,licence:test', DIST, 'licence-build.log')) return;

  const privateKey = JSON.parse(readFileSync(join(KEY_DIR, 'private.json'), 'utf8'));
  const signer = { kid: privateKey.kid, key: await importSigner(privateKey.jwk) };
  const other = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  const stranger = { kid: privateKey.kid, key: other.privateKey };
  const sign = claims => signWith(signer, claims);

  let chromium;
  for (const dir of [process.env.PLAYWRIGHT_DIR, join(STATE, 'node')].filter(Boolean)) {
    try {
      ({ chromium } = createRequire(join(resolve(dir), 'package.json'))('playwright'));
      break;
    } catch {
      // the next place
    }
  }
  mkdirSync(join(STATE, 'profiles'), { recursive: true });
  const profile = mkdtempSync(join(STATE, 'profiles/licence-'));
  const launch = netlog =>
    chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: true,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [
        `--disable-extensions-except=${DIST}`,
        `--load-extension=${DIST}`,
        '--lang=en-US',
        `--log-net-log=${netlog}`,
      ],
      viewport: { width: 1440, height: 900 },
      colorScheme: 'light',
    });
  const workerOf = async context => {
    let [sw] = context.serviceWorkers();
    sw ??= await context.waitForEvent('serviceworker');
    return sw;
  };

  const firstJournal = join(STATE, 'licence-netlog-1.json');
  const secondJournal = join(STATE, 'licence-netlog-2.json');
  rmSync(firstJournal, { force: true });
  rmSync(secondJournal, { force: true });
  let ctx = await launch(firstJournal);
  let sw = await workerOf(ctx);
  const id = new URL(sw.url()).host;
  const base = `chrome-extension://${id}/src/app/index.html`;
  const extOrigin = `chrome-extension://${id}`;

  const pages = [];
  const open = async hash => {
    const page = await ctx.newPage();
    watch(page);
    await page.goto(`${base}${hash}`);
    pages.push(page);
    return page;
  };
  const closePages = async () => {
    for (const page of pages.splice(0)) await page.close().catch(() => undefined);
  };
  // The control page: opened while the profile has no licence record, so its own opening asked nothing.
  let control;
  const openControl = async () => {
    control = await ctx.newPage();
    watch(control);
    await control.goto(`${base}#/start`);
  };
  const storage = keys => control.evaluate(k => chrome.storage.local.get(k), keys);
  const put = rows => control.evaluate(r => chrome.storage.local.set(r), rows);
  const RECORDS = ['entitlement', 'licence', 'licenceFakeServer', 'plans'];
  const reset = async () => {
    await closePages();
    await control.evaluate(keys => chrome.storage.local.remove(keys), RECORDS);
  };
  const calls = async () => (await storage('licenceFakeServer')).licenceFakeServer?.calls ?? [];
  const script = replies => ({ licenceFakeServer: { replies, calls: [] } });
  const entitlement = (token, seen = 0) => ({ entitlement: { v: 1, inst: INST, token, seen } });
  const licenceRecord = (attempts = { failures: 0 }) => ({
    licence: { v: 1, inst: INST, lid: LID, secret: SECRET, attempts },
  });
  /** A plans list fetched just now: fresh, so no page asks for it. */
  const fresh = () => ({ plans: { v: 1, fetchedAt: Date.now(), body: CATALOG, attempts: { failures: 0 } } });
  /**
   * No automatic request while a scenario is prepared: a check failed two minutes ago (the urgent pause is an hour; the
   * button is allowed after a minute) and a fresh plans list (Settings opening with a licence asks only for a stale one).
   */
  const quiet = () => ({ ...licenceRecord({ failures: 1, last: Date.now() - 2 * 60_000 }), ...fresh() });
  const reply = (endpoint, status, body, headers) => ({
    endpoint,
    status,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...(headers ? { headers } : {}),
  });

  // Reading the pages.
  const pro = page => page.locator('[data-settings="pro"]');
  const lineOf = page => pro(page).locator('[data-licence-line]');
  const textOf = async locator =>
    (await locator.count()) ? ((await locator.first().textContent()) ?? '').trim() : null;
  const waitLine = (page, expected) =>
    poll(
      () => textOf(lineOf(page)),
      text => text === expected,
    );
  const plansLine = page => textOf(pro(page).locator('[data-plans] [role="status"]'));
  const cardNames = page =>
    pro(page)
      .locator('article h3')
      .evaluateAll(hs => hs.map(h => h.firstChild?.textContent ?? ''));
  const settingsReady = async page => {
    await pro(page).waitFor({ timeout: 15_000 });
    return page;
  };
  const settings = async () => settingsReady(await open('#/settings'));
  // `\s` takes the no-break space Intl puts between a currency and its amount.
  /** The same fields with the same values, in any order (the worker writes its body in its own order). */
  const sameFields = (a, b) =>
    JSON.stringify(Object.entries(a ?? {}).sort()) === JSON.stringify(Object.entries(b ?? {}).sort());
  const normal = s => (s ?? '').replace(/\s+/g, ' ').trim();

  const cleanups = [];
  try {
    await openControl();

    // ---- E1 / P-E1: no record. ----
    const s1 = await settings();
    const e1 = {
      intro: await textOf(pro(s1).locator('.kit-settings-intro')),
      plans: await plansLine(s1),
      seePlans: await pro(s1).getByRole('button', { name: 'See plans', exact: true }).count(),
      alreadyBought: await pro(s1).getByText(TEXT.alreadyBought, { exact: true }).count(),
      label: await pro(s1).getByLabel('Licence key', { exact: true }).count(),
      disclosure: await textOf(pro(s1).locator('#settings-pro-disclosure')),
      activateDisabled: await pro(s1).getByRole('button', { name: 'Activate', exact: true }).isDisabled(),
      toolsGroup: await s1.locator('[data-settings="tools"]').count(),
    };
    check(
      `${T} E1, P-E1: Settings → Pro without a licence — the introduction, the plans' line and See plans, the field, what activating sends to ${LICENCE_HOST}, Activate disabled; no Settings → Tools`,
      e1.intro === TEXT.intro &&
        e1.plans === TEXT.idle &&
        e1.seePlans === 1 &&
        e1.alreadyBought === 1 &&
        e1.label === 1 &&
        e1.disclosure === TEXT.disclosure &&
        e1.activateDisabled &&
        e1.toolsGroup === 0,
      JSON.stringify(e1),
    );
    const j1 = await open('#/tools/json');
    await j1.locator('#json-input').waitFor({ timeout: 15_000 });
    await j1.getByRole('radio', { name: 'Minify', exact: true }).click();
    const freeJson = {
      line: await textOf(j1.locator('.kit-tool-history-line')),
      reset: await poll(
        () => j1.getByRole('button', { name: 'Reset settings', exact: true }).count(),
        n => n > 0,
        1_500,
      ),
    };
    check(
      `${T} E1: the JSON tool's line is the free one and a changed option offers no "Reset settings"`,
      freeJson.line === TEXT.historyFree && freeJson.reset === 0,
      JSON.stringify(freeJson),
    );
    // P-E1: a new tab, Tools and Settings opened — no plans asked for, no call at all.
    await open('');
    await open('#/tools');
    await settings();
    const e1Calls = await calls();
    const e1Plans = (await storage('plans')).plans;
    check(
      `${T} E1, P-E1: without pressing See plans — new tab, Tools, Settings opened — the fake server has no call and there is no plans record`,
      e1Calls.length === 0 && e1Plans === undefined,
      JSON.stringify({ calls: e1Calls, plans: e1Plans ?? null }),
    );
    // Row 7.1, the probe: the service worker and a page fetch the extension's own manifest.
    const probe = {
      worker: await sw.evaluate(() => fetch(chrome.runtime.getURL('manifest.json')).then(r => r.status)),
      page: await control.evaluate(() => fetch('/manifest.json').then(r => r.status)),
    };
    await closePages();
    await ctx.close();
    const first = journal(firstJournal);
    const manifestSeen = first.requests.filter(r => r.url === `${extOrigin}/manifest.json`);
    // Not only the extension's (the journal may not name a service worker as the initiator): no request at all.
    const network = first.requests.filter(r => /^(https?|wss?):/.test(r.url));
    check(
      `${T} 7.1: the network journal probe — ${manifestSeen.length ? 'it lists the extension’s own fetches' : NETLOG_FINDING}`,
      first.ok && probe.worker === 200 && probe.page === 200,
      JSON.stringify({
        journal: first.ok,
        requests: first.requests.length,
        manifest: manifestSeen.map(r => r.initiator ?? null),
        probe,
      }),
    );
    check(
      `${T} E1, P-E1: the network journal holds no http(s) or ws request at all`,
      first.ok && network.length === 0,
      JSON.stringify(network.slice(0, 5)),
    );

    // The browser closed and opened again with the same profile (onStartup).
    ctx = await launch(secondJournal);
    sw = await workerOf(ctx);
    await openControl();
    const s2 = await settings();
    const restart = { calls: await calls(), plans: await plansLine(s2) };
    check(
      `${T} E1, P-E1: after the browser starts again with the same profile, still no call; the plans' line is the idle one`,
      restart.calls.length === 0 && restart.plans === TEXT.idle,
      JSON.stringify(restart),
    );
    await ctx.route(`${SITE}/**`, route => route.fulfill({ status: 200, contentType: 'text/html', body: '' }));

    // ---- E2: activation, the tabs follow. ----
    await reset();
    const activeToken = await sign(claimsAt(Date.now()));
    await put({
      licence: { v: 1, inst: INST, attempts: { failures: 0 } },
      ...script([reply('activate', 200, { token: activeToken, secret: SECRET })]),
    });
    const jsonTab = await open('#/tools/json');
    await jsonTab.locator('#json-input').waitFor({ timeout: 15_000 });
    await jsonTab.getByRole('radio', { name: 'Minify', exact: true }).click();
    const s3 = await settings();
    await pro(s3).getByLabel('Licence key', { exact: true }).fill(KEY);
    await pro(s3).getByRole('button', { name: 'Activate', exact: true }).click();
    const e2Line = await waitLine(s3, TEXT.active);
    const e2Calls = await calls();
    // Everything the extension stored (the fake server's own record keeps what it was sent: not the extension's).
    const everything = JSON.stringify({ ...(await storage(null)), licenceFakeServer: null });
    const jsonLine = await poll(
      () => textOf(jsonTab.locator('.kit-tool-history-line > span')),
      t => t === TEXT.historyOn,
    );
    const saved = await poll(
      async () => (await storage('toolSettings')).toolSettings?.params?.json ?? null,
      p => p?.values?.mode === 'minify',
    );
    const toolsGroup = await poll(
      () => s3.locator('[data-settings="tools"]').count(),
      n => n === 1,
    );
    check(
      `${T} E2: Activate → "${TEXT.active}"; the request carries exactly { key, inst }; the key is stored nowhere`,
      e2Line === TEXT.active &&
        e2Calls.length === 1 &&
        sameFields(e2Calls[0].body, { key: KEY, inst: INST }) &&
        !everything.includes(KEY),
      JSON.stringify({ line: e2Line, calls: e2Calls.map(c => c.body) }),
    );
    check(
      `${T} E2: the JSON tab opened before shows the Pro history line without a reload, its choice (Minify) is saved, Settings → Tools appears`,
      jsonLine === TEXT.historyOn && saved?.values?.mode === 'minify' && toolsGroup === 1,
      JSON.stringify({ jsonLine, saved, toolsGroup }),
    );
    cleanups.push(() => control.evaluate(() => chrome.storage.local.remove('toolSettings')));

    // ---- E3: refusals of the activation. ----
    const busyAnswer = { at: 0 };
    const refusals = [
      ['404 key-unknown', reply('activate', 404, { error: 'key-unknown', message: 'x' }), () => TEXT.keyUnknown],
      [
        '403 licence-inactive',
        reply('activate', 403, { error: 'licence-inactive', message: 'x' }),
        () => TEXT.inactive,
      ],
      ['400 bad-request', reply('activate', 400, { error: 'bad-request', message: 'x' }), () => TEXT.unreached],
      [
        '503 with Retry-After',
        reply('activate', 503, { error: 'unavailable', message: 'x' }, { 'Retry-After': '120' }),
        () => TEXT.busy(busyAnswer.at + 120_000),
      ],
      ['offline', { endpoint: 'activate', offline: true }, () => TEXT.unreached],
      [
        '200 signed with another key',
        reply('activate', 200, { token: await signWith(stranger, claimsAt(Date.now())), secret: SECRET }),
        () => TEXT.badAnswer,
      ],
      [
        '200 with HTML',
        reply('activate', 200, '<!doctype html><title>Sign in to the network</title>'),
        () => TEXT.unreached,
      ],
    ];
    for (const [name, answer, expected] of refusals) {
      await reset();
      await put({ licence: { v: 1, inst: INST, attempts: { failures: 0 } }, ...script([answer]) });
      const page = await settings();
      await pro(page).getByLabel('Licence key', { exact: true }).fill(KEY);
      const before = Date.now();
      await pro(page).getByRole('button', { name: 'Activate', exact: true }).click();
      busyAnswer.at = before;
      const alert = await poll(
        () => textOf(pro(page).getByRole('alert')),
        t => t !== null,
      );
      // A time in words may fall on the next minute while the request ran.
      const after = Date.now();
      const wanted = [expected()];
      if (name.startsWith('503')) {
        busyAnswer.at = after;
        wanted.push(expected());
      }
      const rows = await storage(['entitlement', 'licence']);
      check(
        `${T} E3: activation answered ${name} — its words, no entitlement, the pending mark removed`,
        wanted.includes(alert) && rows.entitlement === undefined && rows.licence?.pending === undefined,
        JSON.stringify({ alert, licence: rows.licence ?? null }),
      );
    }

    // ---- E4: grace. ----
    await reset();
    const graceAt = Date.now() - 25 * DAY;
    const grace = claimsAt(graceAt);
    await put({ ...entitlement(await sign(grace)), ...quiet() });
    const s4 = await settings();
    const graceText = TEXT.grace(grace.iat * S, grace.exp * S);
    const e4Line = await waitLine(s4, graceText);
    const h4 = await open('#/history');
    const notice = await poll(
      () => textOf(h4.locator('[data-licence-notice]')),
      t => t !== null,
    );
    const j4 = await open('#/tools/json');
    await j4.locator('#json-input').waitFor({ timeout: 15_000 });
    await j4.locator('#json-input').fill('{"probe":"LICENCEGRACE"}');
    const recorded = await waitForHistoryRecord(j4, 'json', () => true).then(
      () => true,
      () => false,
    );
    await j4.getByRole('radio', { name: 'Minify', exact: true }).click();
    const reset4 = await poll(
      () => j4.getByRole('button', { name: 'Reset settings', exact: true }).count(),
      n => n > 0,
    );
    check(
      `${T} E4: grace — Settings → Pro and the line over History say "${graceText}"; the history records; "Reset settings" is there`,
      e4Line === graceText && notice === `${graceText}Open Settings` && recorded && reset4 === 1,
      JSON.stringify({ e4Line, notice, recorded, reset4 }),
    );

    // ---- E5: expired; the history database is never opened. ----
    await reset();
    const recordsBefore = (await historyRecords(control, 'json')).length;
    await ctx.addInitScript(() => {
      const open = IDBFactory.prototype.open;
      IDBFactory.prototype.open = function (name, version) {
        const seen = JSON.parse(sessionStorage.getItem('e2eOpenedDatabases') ?? '[]');
        sessionStorage.setItem('e2eOpenedDatabases', JSON.stringify([...seen, name]));
        return version === undefined ? open.call(this, name) : open.call(this, name, version);
      };
    });
    const expiredAt = Date.now() - 31 * DAY;
    const expired = claimsAt(expiredAt);
    await put({ ...entitlement(await sign(expired)), ...quiet() });
    const s5 = await settings();
    const expiredText = TEXT.expired(expired.iat * S);
    const e5Line = await waitLine(s5, expiredText);
    const j5 = await open('#/tools/json');
    await j5.locator('#json-input').waitFor({ timeout: 15_000 });
    await j5.locator('#json-input').fill('{"probe":"LICENCEEXPIRED"}');
    const e5 = {
      line: await poll(
        () => textOf(j5.locator('.kit-tool-history-line')),
        t => t === TEXT.historyFree,
      ),
      tools: await s5.locator('[data-settings="tools"]').count(),
    };
    const h5 = await open('#/history');
    await h5.locator('[data-page="history"]').waitFor({ timeout: 15_000 });
    const e5Notice = await poll(
      () => textOf(h5.locator('[data-licence-notice]')),
      t => t !== null,
    );
    const opened5 = [];
    for (const page of [s5, j5, h5])
      opened5.push(...(await page.evaluate(() => JSON.parse(sessionStorage.getItem('e2eOpenedDatabases') ?? '[]'))));
    const recordsAfter = (await historyRecords(control, 'json')).length;
    check(
      `${T} E5: expired — "${expiredText}"; Pro is off (the free tool line, no Settings → Tools, the line over History); no page opens the history database, which keeps its ${recordsBefore} record(s)`,
      e5Line === expiredText &&
        e5.line === TEXT.historyFree &&
        e5.tools === 0 &&
        e5Notice === `${expiredText}Open Settings` &&
        !opened5.includes('tool-history') &&
        recordsBefore >= 1 &&
        recordsAfter === recordsBefore,
      JSON.stringify({ e5Line, ...e5, e5Notice, opened5, recordsBefore, recordsAfter }),
    );

    // ---- E6: expired, Check now → active in every open tab. ----
    await reset();
    await put({
      ...entitlement(await sign(claimsAt(Date.now() - 31 * DAY))),
      ...quiet(),
      ...script([reply('refresh', 200, { token: await sign(claimsAt(Date.now())) })]),
    });
    const s6a = await settings();
    const s6b = await settings();
    await pro(s6a).getByRole('button', { name: 'Check now', exact: true }).click();
    const checked = await poll(
      () => pro(s6a).getByText(TEXT.checked, { exact: true }).count(),
      n => n === 1,
    );
    const e6 = {
      a: await waitLine(s6a, TEXT.active),
      b: await waitLine(s6b, TEXT.active),
      calls: await calls(),
      said: await pro(s6a).locator('[role="status"], [role="alert"]').allTextContents(),
    };
    check(
      `${T} E6: Check now → "${TEXT.checked}", active in both open tabs; the request carries { lid, inst, secret }`,
      checked === 1 &&
        e6.a === TEXT.active &&
        e6.b === TEXT.active &&
        e6.calls.length === 1 &&
        e6.calls[0].endpoint === 'refresh' &&
        sameFields(e6.calls[0].body, { lid: LID, inst: INST, secret: SECRET }),
      JSON.stringify({ ...e6, calls: e6.calls.map(c => [c.endpoint, c.body]) }),
    );

    // ---- E7: ended. ----
    await reset();
    const ended = closedAt(Date.now(), {
      status: 'ended',
      paid: Math.floor((Date.now() - 2 * DAY) / S),
      term: 'month',
      renews: false,
    });
    await put({ ...entitlement(await sign(ended)), ...quiet() });
    const s7 = await settings();
    const endedText = TEXT.ended(ended.paid * S);
    const e7 = { line: await waitLine(s7, endedText), tools: await s7.locator('[data-settings="tools"]').count() };
    check(
      `${T} E7: ended — "${endedText}"; Pro is off (no Settings → Tools)`,
      e7.line === endedText && e7.tools === 0,
      JSON.stringify(e7),
    );

    // ---- E8: revoked (seat-limit); Remove from this browser. ----
    await reset();
    await put({
      ...entitlement(await sign(closedAt(Date.now(), { status: 'revoked', reason: 'seat-limit' }))),
      ...quiet(),
      ...script([]),
    });
    const s8 = await settings();
    const e8Line = await waitLine(s8, TEXT.seatLimit);
    await pro(s8).getByRole('button', { name: 'Remove from this browser', exact: true }).click();
    const freeAgain = await poll(
      () => pro(s8).getByText(TEXT.alreadyBought, { exact: true }).count(),
      n => n === 1,
    );
    const e8Rows = await storage(['entitlement', 'licence']);
    const e8Calls = await calls();
    check(
      `${T} E8: revoked (seat-limit) — its words; Remove from this browser → the free state, both records removed, no call`,
      e8Line === TEXT.seatLimit &&
        freeAgain === 1 &&
        e8Rows.entitlement === undefined &&
        e8Rows.licence === undefined &&
        e8Calls.length === 0,
      JSON.stringify({ e8Line, freeAgain, rows: Object.keys(e8Rows), calls: e8Calls }),
    );

    // ---- E9: a token whose signature was changed. ----
    await reset();
    const good = await sign(claimsAt(Date.now()));
    const at = good.lastIndexOf('.') + 10;
    const broken = `${good.slice(0, at)}${good[at] === 'A' ? 'B' : 'A'}${good.slice(at + 1)}`;
    await put({ ...entitlement(broken), ...quiet() });
    const s9 = await settings();
    const e9 = { line: await waitLine(s9, TEXT.invalid), tools: await s9.locator('[data-settings="tools"]').count() };
    check(
      `${T} E9: a changed signature — "${TEXT.invalid}"; Pro is off`,
      e9.line === TEXT.invalid && e9.tools === 0,
      JSON.stringify(e9),
    );

    // ---- E10: the clock mark ahead (rows 18, 20), then Check now. ----
    await reset();
    const now10 = Date.now();
    await put({
      ...entitlement(await sign(claimsAt(now10)), now10 + 40 * DAY),
      ...quiet(),
      ...script([reply('refresh', 200, { token: await sign(claimsAt(Date.now())) })]),
    });
    const s10 = await settings();
    const e10Expired = await poll(
      () => textOf(lineOf(s10)),
      t => t?.startsWith('Pro is paused:'),
    );
    await pro(s10).getByRole('button', { name: 'Check now', exact: true }).click();
    const e10Active = await waitLine(s10, TEXT.active);
    const e10Record = (await storage('entitlement')).entitlement;
    const newIat = e10Record ? JSON.parse(Buffer.from(e10Record.token.split('.')[1], 'base64url')).iat * S : null;
    check(
      `${T} E10: a clock mark 40 days ahead — expired first; Check now → active, and the mark is the new token's iat`,
      e10Expired?.startsWith('Pro is paused:') && e10Active === TEXT.active && e10Record?.seen === newIat,
      JSON.stringify({ e10Expired, e10Active, seen: e10Record?.seen, newIat }),
    );

    // ---- E11: Deactivate while the server cannot be reached. ----
    await reset();
    await put({
      ...entitlement(await sign(claimsAt(Date.now()))),
      ...quiet(),
      ...script([{ endpoint: 'deactivate', offline: true }]),
    });
    const s11 = await settings();
    await waitLine(s11, TEXT.active);
    await pro(s11).getByRole('button', { name: 'Deactivate in this browser', exact: true }).click();
    const confirmText = await textOf(pro(s11).locator('#settings-pro-confirm'));
    await pro(s11).getByRole('button', { name: 'Deactivate', exact: true }).click();
    const deactivated = await poll(
      () => pro(s11).getByText(TEXT.deactivated, { exact: true }).count(),
      n => n === 1,
    );
    const e11Rows = await storage(['entitlement', 'licence']);
    const e11Free = await pro(s11).getByText(TEXT.alreadyBought, { exact: true }).count();
    check(
      `${T} E11: Deactivate is asked in words, then "${TEXT.deactivated}" — records removed, the free state, although the server is unreachable`,
      confirmText === TEXT.confirm &&
        deactivated === 1 &&
        e11Rows.entitlement === undefined &&
        e11Rows.licence === undefined &&
        e11Free === 1,
      JSON.stringify({ confirmText, deactivated, rows: Object.keys(e11Rows), e11Free }),
    );

    // ---- E12: a check is due; one request for many tabs. ----
    await reset();
    await put({
      ...entitlement(await sign(claimsAt(Date.now() - 8 * DAY))),
      ...licenceRecord(),
      ...script([reply('refresh', 200, { token: await sign(claimsAt(Date.now())) })]),
    });
    await open('');
    const e12First = await poll(calls, list => list.length >= 1);
    const markBefore = (await storage('entitlement')).entitlement?.seen ?? 0;
    const opening = Date.now();
    for (let i = 0; i < 5; i++) await open('');
    // Each opening moves the clock mark: once it has moved past the openings, every tab was heard.
    await poll(
      async () => (await storage('entitlement')).entitlement?.seen ?? 0,
      seen => seen >= opening && seen > markBefore,
    );
    const e12After = await calls();
    check(
      `${T} E12: a check due — a new tab makes exactly one refresh; five more tabs within a minute make none`,
      e12First.length === 1 && e12First[0].endpoint === 'refresh' && e12After.length === 1,
      JSON.stringify({ first: e12First.map(c => c.endpoint), after: e12After.map(c => c.endpoint) }),
    );

    // ---- E13: answers that are not a token change nothing. ----
    await reset();
    const due = await sign(claimsAt(Date.now() - 8 * DAY));
    const failures = [
      ['500', reply('refresh', 500, { error: 'internal', message: 'x' }), { failures: 0 }],
      ['200 with HTML', reply('refresh', 200, '<!doctype html><title>portal</title>'), null],
      ['401 without a body', reply('refresh', 401, ''), null],
    ];
    await put({ ...entitlement(due), ...licenceRecord() });
    for (const [index, [name, answer, attempts]] of failures.entries()) {
      // Past the pause of the failures before: the next tab may ask again.
      const record = (await storage('licence')).licence;
      await put({
        ...licenceRecord(attempts ?? { failures: record.attempts.failures, last: Date.now() - 13 * 60 * 60_000 }),
        ...script([answer]),
      });
      await open('');
      const asked = await poll(calls, list => list.length >= 1);
      const after = await poll(
        async () => (await storage(['licence', 'entitlement'])) ?? {},
        rows => rows.licence?.attempts?.failures === index + 1,
      );
      const markBefore13 = after.entitlement?.seen ?? 0;
      const opening13 = Date.now();
      await open('');
      await poll(
        async () => (await storage('entitlement')).entitlement?.seen ?? 0,
        seen => seen >= opening13 && seen > markBefore13,
      );
      const later = await calls();
      check(
        `${T} E13: refresh answered ${name} — the token is unchanged, the failures count ${index + 1}, the next tab asks nothing`,
        asked.length === 1 &&
          after.entitlement?.token === due &&
          after.licence?.attempts?.failures === index + 1 &&
          later.length === 1,
        JSON.stringify({ asked: asked.length, failures: after.licence?.attempts, later: later.length }),
      );
    }

    // ---- P-E2: See plans, one request, the cards in every open tab. ----
    await reset();
    await put(script([reply('plans', 200, CATALOG)]));
    const before2 = await settings();
    const s12 = await settings();
    await pro(s12).getByRole('button', { name: 'See plans', exact: true }).click();
    const names = await poll(
      () => cardNames(s12),
      list => list.length === 3,
    );
    const prices = (await pro(s12).locator('.kit-plan-card-price').allTextContents()).map(normal);
    const pe2 = {
      names,
      prices,
      badge: normal(await textOf(pro(s12).locator('#plan-pro-annual-name'))),
      freeMark: await textOf(pro(s12).locator('article').first().locator('.kit-plan-card-mark')),
      calls: await calls(),
      other: await poll(
        () => cardNames(before2),
        list => list.length === 3,
      ),
    };
    pe2.callsAfter = await calls();
    check(
      `${T} P-E2: See plans → one GET of the plans; three cards in the catalog's order, XTS 11.11 per month and XTS 111.10 per year, the badge, Free current; a tab opened before shows them without a request`,
      JSON.stringify(names) === JSON.stringify(['Free', 'Monthly', 'Annually']) &&
        prices[1] === 'XTS 11.11 per month' &&
        prices[2] === 'XTS 111.10 per year' &&
        pe2.badge === 'Annually, Placeholder badge' &&
        pe2.freeMark === 'Current plan' &&
        pe2.calls.length === 1 &&
        JSON.stringify(pe2.calls[0] && [pe2.calls[0].endpoint, pe2.calls[0].method, pe2.calls[0].body]) ===
          JSON.stringify(['plans', 'GET', null]) &&
        pe2.other.length === 3 &&
        pe2.callsAfter.length === 1,
      JSON.stringify({ ...pe2, calls: pe2.calls.length, callsAfter: pe2.callsAfter.length }),
    );

    // ---- P-E3: offline. ----
    await reset();
    await put(script([{ endpoint: 'plans', offline: true }]));
    const s13 = await settings();
    await pro(s13).getByRole('button', { name: 'See plans', exact: true }).click();
    const pe3 = {
      line: await poll(
        () => plansLine(s13),
        t => t === TEXT.plansOffline,
      ),
      prices: await pro(s13).getByText(/XTS/).count(),
      tryAgainDisabled: await pro(s13).getByRole('button', { name: 'Try again', exact: true }).isDisabled(),
    };
    check(
      `${T} P-E3: offline — "${TEXT.plansOffline}", no price, Try again disabled for the next minute`,
      pe3.line === TEXT.plansOffline && pe3.prices === 0 && pe3.tryAgainDisabled,
      JSON.stringify(pe3),
    );

    // ---- P-E4: a stale list; Try again brings the prices. ----
    await reset();
    const staleAt = Date.now() - 2 * DAY;
    await put({
      plans: { v: 1, fetchedAt: staleAt, body: CATALOG, attempts: { failures: 0 } },
      ...script([reply('plans', 200, CATALOG)]),
    });
    const s14 = await settings();
    const pe4 = {
      line: await poll(
        () => plansLine(s14),
        t => t === TEXT.plansStale(staleAt),
      ),
      missing: await pro(s14).getByText('Price not shown', { exact: true }).count(),
      calls: (await calls()).length,
    };
    await pro(s14).getByRole('button', { name: 'Try again', exact: true }).click();
    pe4.priced = await poll(
      () => pro(s14).getByText(/XTS/).count(),
      n => n === 2,
    );
    check(
      `${T} P-E4: a list two days old — without a press: the cards without prices ("Price not shown" on each paid one), the line with its date; Try again → the prices`,
      pe4.line === TEXT.plansStale(staleAt) && pe4.missing === 2 && pe4.calls === 0 && pe4.priced === 2,
      JSON.stringify(pe4),
    );

    // ---- P-E5: a list older than 30 days is not shown. ----
    await reset();
    await put({ plans: { v: 1, fetchedAt: Date.now() - 31 * DAY, body: CATALOG, attempts: { failures: 0 } } });
    const s15 = await settings();
    const pe5 = { line: await plansLine(s15), cards: await pro(s15).locator('article').count() };
    check(
      `${T} P-E5: a list 31 days old — the idle view, not one card of it`,
      pe5.line === TEXT.idle && pe5.cards === 0,
      JSON.stringify(pe5),
    );

    // ---- P-E6: a catalog of another version. ----
    await reset();
    await put(script([reply('plans', 200, { ...CATALOG, v: 2 })]));
    const s16 = await settings();
    await pro(s16).getByRole('button', { name: 'See plans', exact: true }).click();
    const pe6 = {
      line: await poll(
        () => plansLine(s16),
        t => t === TEXT.plansUnsupported,
      ),
      body: (await storage('plans')).plans?.body ?? null,
    };
    check(
      `${T} P-E6: a catalog with v: 2 — "${TEXT.plansUnsupported}", nothing cached`,
      pe6.line === TEXT.plansUnsupported && pe6.body === null,
      JSON.stringify(pe6),
    );

    // ---- P-E7: a checkout address on another host drops that plan. ----
    await reset();
    const foreign = structuredClone(CATALOG);
    foreign.plans[2].checkoutUrl = 'https://shop.example.invalid/checkout/?plan=pro-annual';
    await put(script([reply('plans', 200, foreign)]));
    const s17 = await settings();
    await pro(s17).getByRole('button', { name: 'See plans', exact: true }).click();
    const pe7 = {
      names: await poll(
        () => cardNames(s17),
        list => list.length >= 2,
      ),
      href: await pro(s17)
        .getByRole('link', { name: /^Choose Monthly/ })
        .getAttribute('href'),
    };
    check(
      `${T} P-E7: Annually's checkout on a foreign host — two cards (Free, Monthly), Monthly's link on web.example.invalid`,
      JSON.stringify(pe7.names) === JSON.stringify(['Free', 'Monthly']) &&
        new URL(pe7.href).host === 'web.example.invalid',
      JSON.stringify(pe7),
    );

    // ---- P-E8 … P-E10: the cards by the licence. ----
    const paidUntil = Math.floor((Date.now() + 20 * DAY) / S);
    await reset();
    await put({
      ...entitlement(await sign(claimsAt(Date.now(), { paid: paidUntil, term: 'month', renews: true }))),
      ...quiet(),
      ...fresh(),
      ...script([]),
    });
    const s18 = await settings();
    await waitLine(s18, TEXT.active);
    const monthly = pro(s18).locator('article', { has: s18.locator('#plan-pro-monthly-name') });
    const pe8 = {
      mark: await textOf(monthly.locator('.kit-plan-card-mark')),
      state: await textOf(monthly.locator('.kit-plan-card-state')),
      manage: await monthly.getByRole('link', { name: /^Manage subscription/ }).getAttribute('href'),
      switchTo: await pro(s18)
        .getByRole('link', { name: /^Switch to Annually/ })
        .getAttribute('href'),
    };
    check(
      `${T} P-E8: active monthly — Monthly current, "Renews on …", Manage subscription to manageUrl; Switch to Annually with ?plan=pro-annual`,
      pe8.mark === 'Current plan' &&
        pe8.state === `Renews on ${date(paidUntil * S)}.` &&
        pe8.manage === `${SITE}/pro/manage/` &&
        pe8.switchTo === `${SITE}/pro/manage/?plan=pro-annual`,
      JSON.stringify(pe8),
    );
    await reset();
    await put({
      ...entitlement(await sign(claimsAt(Date.now(), { paid: paidUntil, term: 'month', renews: false }))),
      ...quiet(),
      ...fresh(),
      ...script([]),
    });
    const s19 = await settings();
    const pe9 = await poll(
      () => textOf(pro(s19).locator('#plan-pro-monthly-state')),
      t => t !== null,
    );
    check(
      `${T} P-E9: cancelled but paid — "Cancelled. Pro stays until …"`,
      pe9 === `Cancelled. Pro stays until ${date(paidUntil * S)}.`,
      JSON.stringify(pe9),
    );
    await reset();
    const endedPaid = Math.floor((Date.now() - 2 * DAY) / S);
    await put({
      ...entitlement(
        await sign(closedAt(Date.now(), { status: 'ended', paid: endedPaid, term: 'month', renews: false })),
      ),
      ...quiet(),
      ...fresh(),
      ...script([]),
    });
    const s20 = await settings();
    const pe10 = {
      free: await poll(
        () => textOf(pro(s20).locator('article').first().locator('.kit-plan-card-mark')),
        t => t !== null,
      ),
      state: await textOf(pro(s20).locator('#plan-pro-monthly-state')),
      renew: await pro(s20)
        .getByRole('link', { name: /^Renew Monthly/ })
        .count(),
    };
    check(
      `${T} P-E10: ended — Free current; Monthly "Ended on …" and Renew Monthly`,
      pe10.free === 'Current plan' && pe10.state === `Ended on ${date(endedPaid * S)}.` && pe10.renew === 1,
      JSON.stringify(pe10),
    );

    // ---- P-E11: with a licence, Settings opening asks for a list that is not fresh. ----
    await reset();
    await put({
      ...entitlement(await sign(claimsAt(Date.now(), { paid: paidUntil, term: 'month', renews: true }))),
      ...quiet(),
      plans: { v: 1, fetchedAt: Date.now() - 2 * DAY, body: CATALOG, attempts: { failures: 0 } },
      ...script([reply('plans', 200, CATALOG)]),
    });
    await settings();
    const pe11 = await poll(calls, list => list.length >= 1);
    check(
      `${T} P-E11: an active licence and a stale list — opening Settings makes one plans request`,
      pe11.length === 1 && pe11[0].endpoint === 'plans',
      JSON.stringify(pe11.map(c => c.endpoint)),
    );

    // ---- P-E12: Choose Monthly opens the checkout in a new tab — fulfilled here, nothing leaves. ----
    await reset();
    await put(fresh());
    const visits = [];
    await ctx.unroute(`${SITE}/**`);
    await ctx.route(`${SITE}/**`, route => {
      visits.push({ url: route.request().url(), headers: route.request().headers() });
      return route.fulfill({ status: 200, contentType: 'text/html', body: '' });
    });
    const s21 = await settings();
    const choose = pro(s21).getByRole('link', { name: /^Choose Monthly/ });
    await choose.waitFor({ timeout: 10_000 });
    const [tab] = await Promise.all([ctx.waitForEvent('page'), choose.click()]);
    await tab.waitForLoadState('domcontentloaded').catch(() => undefined);
    pages.push(tab);
    const visit = visits[0];
    const pe12 = {
      url: tab.url(),
      visit: visit?.url ?? null,
      referer: visit?.headers?.referer ?? null,
      leaks: visit
        ? [...new URL(visit.url).searchParams].flatMap(([name, value]) =>
            ['inst', 'lid', 'key'].includes(name) || [INST, LID, KEY].includes(value) ? [name] : [],
          )
        : [],
    };
    check(
      `${T} P-E12: Choose Monthly → a new tab at exactly the checkout address; no installation, licence or key in it; no Referer`,
      pe12.url === `${SITE}/pro/checkout/?plan=pro-monthly` &&
        pe12.visit === pe12.url &&
        pe12.referer === null &&
        pe12.leaks.length === 0,
      JSON.stringify(pe12),
    );

    // ---- P-E13: the narrow window — one column. ----
    await reset();
    await put(fresh());
    const s22 = await settings();
    await s22.setViewportSize({ width: 600, height: 800 });
    await pro(s22).locator('article').first().waitFor({ timeout: 10_000 });
    const columns = await pro(s22)
      .locator('.kit-plans-list')
      .evaluate(list => getComputedStyle(list).gridTemplateColumns.split(' ').length);
    await shoot(s22, 'licence-plans-narrow.png');
    check(`${T} P-E13: a window 600 × 800 — the cards in one column`, columns === 1, `columns ${columns}`);
  } catch (error) {
    check(`${T}: the scenarios ran to the end`, false, String(error?.stack ?? error));
  } finally {
    try {
      await reset();
      for (const cleanup of cleanups) await cleanup();
    } catch {
      // The profile goes below anyway.
    }
    await ctx.close().catch(() => undefined);
    rmSync(profile, { recursive: true, force: true });
  }

  // ---- E15, P-E14: the build check refuses the test build and the plans' placeholder variant. ----
  /** Without the colours of the script's output. */
  const plain = line => line.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '');
  const refused = dist => {
    const run = spawnSync('bash', [join(ROOT, 'scripts/validate-build.sh'), dist], { encoding: 'utf8' });
    const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    const failed = out.split('\n').filter(l => l.includes('FAILED'));
    return { status: run.status, check17: failed.some(l => l.includes('Check 17')), failed };
  };
  const e15 = refused(DIST);
  check(
    `${T} E15: scripts/validate-build.sh refuses the test build, naming Check 17`,
    e15.status !== 0 && e15.check17,
    JSON.stringify({ status: e15.status, failed: e15.failed.map(l => plain(l).slice(0, 160)) }),
  );
  if (build('plans:samplePlans', SAMPLE_DIST, 'sample-plans-build.log')) {
    const pe14 = refused(SAMPLE_DIST);
    check(
      `${T} P-E14: scripts/validate-build.sh refuses the build with plans:samplePlans, naming Check 17`,
      pe14.status !== 0 && pe14.check17,
      JSON.stringify({ status: pe14.status, failed: pe14.failed.map(l => plain(l).slice(0, 160)) }),
    );
  }
};
