// The Subnet Calculator in the built extension (docs/tools/specs/subnet.md): its scenarios (§2) the way a person does
// them — the page's real controls — run by scripts/e2e-tools.mjs. Measured here (§12): splitting /8 into /24s and /48
// into /64s (the page of 1,000 rows, the longest frame, Copy subnets of 65,536 rows), a split over the copy limit, and
// summarizing 100,000 blocks in the worker. No request may leave the extension while addresses and host-looking text are
// typed into every field (Playwright's context and the page's CDP Network domain both listen). Also a block pasted into
// the start page, an entry of the tool history opened back, and the task and Split by kept as saved parameters (D21).
// Copies are caught in the page (stubClipboard).

/* global chrome, document, window, location, requestAnimationFrame, HTMLTextAreaElement, HTMLInputElement, DataTransfer, ClipboardEvent -- page.evaluate callbacks run in the page */

import {
  forgetSavedParameters,
  inDarkTheme,
  settledShot,
  stubClipboard,
  waitForHistoryRecord,
} from '../e2e-helpers.mjs';

const T = 'Subnet Calculator';

/** Frame watch in the page: the longest gap between animation frames, and the longest task. */
const watchFrames = page =>
  page.evaluate(() => {
    const w = { max: 0, last: performance.now(), on: true, longest: 0 };
    window.__subnetFrames = w;
    const tick = t => {
      if (!w.on) return;
      w.max = Math.max(w.max, t - w.last);
      w.last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    w.observer = new PerformanceObserver(list => {
      for (const e of list.getEntries()) w.longest = Math.max(w.longest, e.duration);
    });
    w.observer.observe({ type: 'longtask', buffered: false });
  });

const stopFrames = page =>
  page.evaluate(() => {
    const w = window.__subnetFrames;
    w.on = false;
    w.observer.disconnect();
    return { max: Math.round(w.max), longest: Math.round(w.longest) };
  });

export default async args => {
  let cleanup = null;
  try {
    cleanup = await run(args);
  } finally {
    // The page stays for the next modules: the stand-in for the clipboard and the listeners go.
    await args.page.evaluate(() => delete navigator.clipboard.writeText).catch(() => undefined);
    await cleanup?.().catch(() => undefined);
    // The task the steps chose is a saved parameter (written 400 ms after the change): the next module opens the tool
    // with its defaults.
    await args.sleep(500);
    await forgetSavedParameters(args.page, 'subnet').catch(() => undefined);
  }
};

const run = async ({ ctx, page, base, check, shoot, sleep, report }) => {
  // `new URL(base).origin` is "null" in Node for a chrome-extension: address — the origin is built from the id.
  const origin = /^chrome-extension:\/\/[^/]+/.exec(base)?.[0] ?? new URL(base).origin;
  const outside = [];
  const onRequest = request => {
    const url = request.url();
    if (!url.startsWith(origin) && !url.startsWith('devtools:')) outside.push(url);
  };
  ctx.on('request', onRequest);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  const cdpOutside = [];
  const onCdp = e => {
    if (!e.request.url.startsWith(origin) && !e.request.url.startsWith('devtools:')) cdpOutside.push(e.request.url);
  };
  cdp.on('Network.requestWillBeSent', onCdp);
  const workers = [];
  page.on('worker', w => workers.push(w.url()));

  const open = async hash => {
    if (page.url().startsWith(base)) await page.evaluate(url => location.replace(url), `${base}${hash}`);
    else await page.goto(`${base}${hash}`);
  };
  await open('#/tools/subnet');
  const block = page.locator('#subnet-block');
  // An element of this tool (not the heading): the page shows "Loading…" until its history is open.
  await block.waitFor({ timeout: 15_000 });
  const clipboard = await stubClipboard(page);
  const copied = async () => (await clipboard.copied()).at(-1);
  const task = name => page.getByRole('radio', { name, exact: true }).click();
  const button = name => page.getByRole('button', { name, exact: true });
  const message = field => page.locator(`[data-field="${field}"]`).innerText();
  const detail = id => page.locator(`[aria-label="Block details"] [data-row="${id}"] output`).innerText();
  const tableRows = name =>
    page
      .getByRole('table', { name, exact: true })
      .locator('tbody tr')
      .evaluateAll(trs => trs.map(tr => [...tr.cells].map(td => td.innerText)));
  /** Sets a field as a paste would (React hears the input event); no typing of megabytes. */
  const setValue = (selector, text) =>
    page.evaluate(
      ([s, t]) => {
        const el = document.querySelector(s);
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, t);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      },
      [selector, text],
    );
  const shootAll = async name => {
    const size = page.viewportSize();
    await page.setViewportSize({ width: size.width, height: 1_300 });
    await page.locator('[data-slot="tool-page"]').evaluate(el => el.scrollIntoView({ block: 'start' }));
    await settledShot(shoot, page, name);
    await page.setViewportSize(size);
  };

  check(
    `${T}: opens in Explain, empty — no rows, no message`,
    (await page.getByRole('radio', { name: 'Explain', exact: true }).getAttribute('aria-checked')) === 'true' &&
      (await block.inputValue()) === '' &&
      (await page.locator('[aria-label="Block details"]').count()) === 0 &&
      (await message('block')).trim() === '',
  );

  // §2.1: an interface address with host bits.
  await block.fill('10.0.12.5/22');
  await page.locator('[data-row="kind"]').waitFor();
  const explained = {
    note: (await message('block')).trim(),
    network: await detail('network'),
    broadcast: await detail('broadcast'),
    hosts: await detail('hosts'),
    count: await detail('host-count'),
    binary: await page.locator('[data-part="network-bits"]').innerText(),
    kind: await detail('kind'),
  };
  await button('Copy usable host count').click();
  const hostCount = await copied();
  check(
    `${T}: §2.1 10.0.12.5/22 — the host-bits note, the rows, the network bits marked; a count copies without groups`,
    explained.note === 'Host bits are set: 10.0.12.5/22 is the address 10.0.12.5 in the block 10.0.12.0/22.' &&
      explained.network === '10.0.12.0/22' &&
      explained.broadcast === '10.0.15.255' &&
      explained.hosts === '10.0.12.1 – 10.0.15.254' &&
      explained.count === '1,022' &&
      explained.binary === '00001010.00000000.000011' &&
      explained.kind === 'Private-Use' &&
      hostCount === '1022',
    JSON.stringify({ ...explained, hostCount }),
  );
  await shootAll('tool-subnet-01-explain-light.png');

  // §2.4 and §6: the forms programs read differently are refused with words.
  const refusals = [];
  for (const [text, want] of [
    [
      '010.0.0.1',
      'Column 1: Part 1 "010" has a leading zero, which some programs read as octal: write it without the zero (10), or as 8 if octal was meant.',
    ],
    [
      '10.1',
      'Column 1: An IPv4 address has four parts; "10.1" has 2. Some programs fill in zeros and read 10.0.0.1: write all four parts.',
    ],
    [
      '10.0.0.0 255.0.255.0',
      'Column 10: The mask 255.0.255.0 is not contiguous: a netmask is ones then zeros (255.255.0.0), a wildcard mask zeros then ones (0.0.255.255).',
    ],
    ['1::2::3', 'Column 5: "::" may appear only once.'],
  ]) {
    await block.fill(text);
    await page
      .locator('[data-field="block"] .kit-tool-message, [data-field="block"] [data-slot="tool-message"]')
      .first()
      .waitFor()
      .catch(() => undefined);
    const got = (await message('block')).trim();
    refusals.push(got === want ? 'ok' : `${text}: ${got}`);
  }
  check(
    `${T}: §6 the octal trap and other ambiguous forms are refused with words and a column`,
    refusals.every(r => r === 'ok'),
    refusals.join(' | '),
  );
  await shootAll('tool-subnet-02-error-light.png');

  // §2.3: IPv6 /48, exact counts.
  await block.fill('2001:db8::/48');
  await page.locator('[data-row="networks64"]').waitFor();
  const v6 = { addresses: await detail('addresses'), networks: await detail('networks64'), kind: await detail('kind') };
  check(
    `${T}: §2.3 2001:db8::/48 — exact counts with powers and words, no broadcast row, Documentation`,
    v6.addresses === '1,208,925,819,614,629,174,706,176 (2^80, about 1.2 septillion)' &&
      v6.networks === '65,536 (2^16)' &&
      v6.kind === 'Documentation' &&
      (await page.locator('[data-row="broadcast"]').count()) === 0,
    JSON.stringify(v6),
  );

  // §2.6: Split.
  await block.fill('10.0.0.0/24');
  await task('Split');
  await page.locator('#subnet-prefix').fill('26');
  await page.locator('[data-status="split"]').waitFor();
  const small = await tableRows('Subnets');
  await button('Copy subnets').click();
  check(
    `${T}: §2.6 10.0.0.0/24 into /26 — four rows, Copy subnets copies them by line`,
    (await page.locator('[data-status="split"]').innerText()) ===
      '4 subnets /26 · 64 addresses each · 62 usable hosts each' &&
      small.length === 4 &&
      small[3].join('|') === '4|10.0.0.192/26|10.0.0.192|10.0.0.255' &&
      (await copied()) === '10.0.0.0/26\n10.0.0.64/26\n10.0.0.128/26\n10.0.0.192/26',
    JSON.stringify(small),
  );

  // §12: large splits — time to the full page of 1,000 rows, the longest frame, the last page, Copy subnets.
  const bigSplit = async (cidr, prefix) => {
    await block.fill(cidr);
    await page.locator('#subnet-prefix').fill('');
    await watchFrames(page);
    const shown = await page.evaluate(async q => {
      const el = document.querySelector('#subnet-prefix');
      const start = performance.now();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, q);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      const rows = () => document.querySelectorAll('[aria-label="Subnets"] tbody tr').length;
      while (rows() < 1_000 && performance.now() - start < 20_000) await new Promise(r => requestAnimationFrame(r));
      return Math.round(performance.now() - start);
    }, String(prefix));
    const frames = await stopFrames(page);
    const pager = (await page.locator('[data-part="pager"] span').first().innerText()).trim();
    await button('Last').click();
    // The last page is complete when its row count is what the pager says (rows are built a chunk per frame).
    await page.waitForFunction(() => {
      const m = /^Subnets ([\d,]+)–([\d,]+) of \2$/.exec(
        document.querySelector('[data-part="pager"] span')?.textContent ?? '',
      );
      if (!m) return false;
      const n = BigInt(m[2].replaceAll(',', '')) - BigInt(m[1].replaceAll(',', '')) + 1n;
      return BigInt(document.querySelectorAll('[aria-label="Subnets"] tbody tr').length) === n;
    });
    const last = (await tableRows('Subnets')).at(-1);
    const copy = await page.evaluate(async () => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent === 'Copy subnets');
      if (!b || b.disabled) return { ms: -1 };
      const start = performance.now();
      b.click();
      while (![...document.querySelectorAll('button')].some(x => x.textContent === 'Copied'))
        await new Promise(r => requestAnimationFrame(r));
      return { ms: Math.round(performance.now() - start) };
    });
    const text = copy.ms >= 0 ? await copied() : '';
    return { shown, frames, pager, last, copyMs: copy.ms, copiedRows: text ? text.split('\n').length : 0 };
  };
  const s8 = await bigSplit('10.0.0.0/8', 24);
  check(
    `${T}: §12 /8 into /24 — 1,000 rows a chunk per frame, the last page, Copy subnets copies all 65,536`,
    s8.pager === 'Subnets 1–1,000 of 65,536' &&
      s8.last?.join('|') === '65,536|10.255.255.0/24|10.255.255.0|10.255.255.255' &&
      s8.copiedRows === 65_536 &&
      s8.frames.max < 200,
    `1,000 rows ${s8.shown} ms, longest frame gap ${s8.frames.max} ms, longest task ${s8.frames.longest} ms; Copy subnets ${s8.copyMs} ms, ${s8.copiedRows} rows`,
  );
  const s48 = await bigSplit('2001:db8::/48', 64);
  check(
    `${T}: §12 /48 into /64 — the same, IPv6`,
    s48.pager === 'Subnets 1–1,000 of 65,536' &&
      s48.last?.join('|') === '65,536|2001:db8:0:ffff::/64|2001:db8:0:ffff::|2001:db8:0:ffff:ffff:ffff:ffff:ffff' &&
      s48.copiedRows === 65_536 &&
      s48.frames.max < 200,
    `1,000 rows ${s48.shown} ms, longest frame gap ${s48.frames.max} ms, longest task ${s48.frames.longest} ms; Copy subnets ${s48.copyMs} ms, ${s48.copiedRows} rows`,
  );
  const s32 = await bigSplit('10.0.0.0/8', 32);
  check(
    `${T}: §12 /8 into /32 (16,777,216 subnets) — pages work, copying is off and says why`,
    s32.pager === 'Subnets 1–1,000 of 16,777,216' &&
      s32.last?.[1] === '10.255.255.255/32' &&
      s32.copyMs === -1 &&
      (await page.locator('[data-copy-limit]').innerText()).trim() ===
        'Copying takes up to 65,536 subnets; this split has 16,777,216.',
    `1,000 rows ${s32.shown} ms, longest frame gap ${s32.frames.max} ms`,
  );
  const s0 = await bigSplit('::/0', 128);
  check(
    `${T}: ::/0 into /128 — 2^128 subnets, the last page is the last address`,
    s0.pager === 'Subnets 1–1,000 of 340,282,366,920,938,463,463,374,607,431,768,211,456' &&
      s0.last?.[1] === 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff/128',
    `${s0.pager}; last ${s0.last?.[1]}`,
  );
  await block.fill('10.0.0.0/24');
  await page.locator('#subnet-prefix').fill('26');
  await page.locator('[data-status="split"]').waitFor();
  await shootAll('tool-subnet-03-split-light.png');

  // §2.5: Match.
  await task('Match');
  await setValue('#subnet-addresses', '10.0.12.77\n192.168.1.10\n2001:db8::1');
  await setValue('#subnet-blocks', '10.0.0.0/8\n10.0.12.0/22\n2001:db8::/32');
  await page.locator('[data-status="match"]').waitFor();
  const matches = await tableRows('Matches');
  await button('Copy outside').click();
  check(
    `${T}: §2.5 three addresses against three blocks — the narrowest block and how many; Copy outside`,
    (await page.locator('[data-status="match"]').innerText()) === '2 of 3 addresses are in a block.' &&
      matches.map(r => r.slice(1).join('|')).join(' / ') ===
        '10.0.12.77|10.0.12.0/22|2 / 192.168.1.10|—|0 / 2001:db8::1|2001:db8::/32|1' &&
      (await copied()) === '192.168.1.10',
    JSON.stringify(matches),
  );
  await shootAll('tool-subnet-04-match-light.png');

  // §2.8: Summarize.
  await task('Summarize');
  await setValue('#subnet-list', '10.0.0.0/24\n10.0.1.0/24\n10.0.2.0/23\n10.0.4.0/24\n192.168.0.5 - 192.168.0.20');
  await page.locator('[data-status="summarize"]').waitFor();
  const summary = await page.locator('#subnet-summary').inputValue();
  check(
    `${T}: §2.8 four blocks and a range → the fewest blocks`,
    summary ===
      '10.0.0.0/22\n10.0.4.0/24\n192.168.0.5/32\n192.168.0.6/31\n192.168.0.8/29\n192.168.0.16/30\n192.168.0.20/32' &&
      (await page.locator('[data-status="summarize"]').innerText()) === '5 entries → 7 blocks · 1,296 addresses',
    JSON.stringify(summary),
  );
  await shootAll('tool-subnet-05-summarize-light.png');

  // §12: 100,000 blocks — the worker takes over above 2,000 entries; the time to the answer and the longest frame.
  const hundredK = await page.evaluate(async () => {
    let seed = 7;
    const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0);
    const lines = [];
    for (let i = 0; i < 100_000; i++) lines.push(`${rnd() % 224}.${rnd() % 256}.${rnd() % 256}.0/${16 + (rnd() % 17)}`);
    const text = lines.join('\n');
    const el = document.querySelector('#subnet-list');
    const start = performance.now();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const field = performance.now() - start;
    const done = () =>
      /^100,000 entries → /.test(document.querySelector('[data-status="summarize"]')?.textContent ?? '');
    window.__subnetFrames = null;
    return { chars: text.length, field: Math.round(field), started: start, done: done() };
  });
  await watchFrames(page);
  const answered = await page.evaluate(async started => {
    const done = () =>
      /^100,000 entries → /.test(document.querySelector('[data-status="summarize"]')?.textContent ?? '');
    while (!done() && performance.now() - started < 30_000) await new Promise(r => requestAnimationFrame(r));
    return {
      ms: Math.round(performance.now() - started),
      status: document.querySelector('[data-status="summarize"]')?.textContent,
    };
  }, hundredK.started);
  const hkFrames = await stopFrames(page);
  report.subnet = { s8, s48, s32, hundredK: { ...hundredK, ...answered, frames: hkFrames } };
  check(
    `${T}: §12 Summarize 100,000 blocks — in the module worker from the package's own file; the page keeps drawing`,
    answered.status?.startsWith('100,000 entries → ') &&
      workers.some(w => w.startsWith(origin) && /\/assets\/subnet\.worker-[\w-]+\.js(\?|$)/.test(w)) &&
      hkFrames.max < 200,
    `workers ${workers.join(', ')}; ${hundredK.chars} characters: text box ${hundredK.field} ms; answer ${answered.ms} ms after the edit (300 ms of it the wait); longest frame gap after the text box ${hkFrames.max} ms, longest task ${hkFrames.longest} ms; ${answered.status}`,
  );

  // No network: host-looking text in every field.
  const before = { pw: outside.length, cdp: cdpOutside.length };
  await task('Explain');
  for (const text of [
    'example.com/24',
    'localhost',
    'https://10.0.0.1/8',
    '[2001:db8::1]:443',
    '8.8.8.8',
    'fe80::1%eth0',
    'www.google.com',
    '1.1.1.1:53',
  ])
    await block.fill(text);
  await task('Match');
  await setValue('#subnet-addresses', '8.8.8.8\n1.1.1.1\nexample.com\n[2606:4700::1111]:443');
  await setValue('#subnet-blocks', '8.8.8.0/24\nlocalhost\nhttps://example.com/');
  await task('Summarize');
  await setValue('#subnet-list', '8.8.8.8\nexample.org\n1.0.0.0/24, 1.1.1.0/24');
  await page.waitForTimeout(800);
  check(
    `${T}: §11 no request leaves the extension while addresses and host-looking text are typed in every task`,
    outside.length === before.pw && cdpOutside.length === before.cdp && outside.length === 0 && cdpOutside.length === 0,
    `${[...outside, ...cdpOutside].join(', ') || 'none'} (in this module so far: ${outside.length} by Playwright, ${cdpOutside.length} by CDP)`,
  );

  // Dark theme screenshots.
  await inDarkTheme(ctx, base, page, async () => {
    await task('Explain');
    await block.fill('10.0.12.5/22');
    await page.locator('[data-row="kind"]').waitFor();
    await shootAll('tool-subnet-01-explain-dark.png');
    await task('Split');
    await block.fill('10.0.0.0/24');
    await page.locator('#subnet-prefix').fill('26');
    await page.locator('[data-status="split"]').waitFor();
    await shootAll('tool-subnet-03-split-dark.png');
    await task('Match');
    await setValue('#subnet-addresses', '10.0.12.77\n192.168.1.10\n2001:db8::1');
    await setValue('#subnet-blocks', '10.0.0.0/8\n10.0.12.0/22\n2001:db8::/32');
    await page.locator('[data-status="match"]').waitFor();
    await shootAll('tool-subnet-04-match-dark.png');
    await task('Summarize');
    await setValue('#subnet-list', '10.0.0.0/24\n10.0.1.0/24\n10.0.2.0/23\n10.0.4.0/24\n192.168.0.5 - 192.168.0.20');
    await page.locator('[data-status="summarize"]').waitFor();
    await shootAll('tool-subnet-05-summarize-dark.png');
  });

  // History: an edit is kept in clear and opens back.
  await task('Explain');
  await block.fill('172.16.5.4/20');
  await page.locator('[data-row="kind"]').waitFor();
  await open('#/tools');
  const entry = await waitForHistoryRecord(
    page,
    'subnet',
    r => r.label === '172.16.5.4/20 · 172.16.0.0/20 · Private-Use',
  ).catch(() => null);
  check(
    `${T}: an Explain edit is recorded in clear with the block and its kind`,
    !!entry && !entry.sealed && entry.kind === 'explain',
    entry ? `${entry.kind}: ${entry.label}` : 'no record',
  );
  await open('#/tools/subnet');
  await block.waitFor();
  await page.getByText('Recent entries').click();
  await page.locator('.kit-history-entry').first().waitFor();
  await page
    .locator('.kit-history-entry')
    .filter({ hasText: '172.16.5.4/20 · 172.16.0.0/20 · Private-Use' })
    .first()
    .getByRole('button', { name: 'Open' })
    .click();
  await page
    .getByText('Opened from History: 172.16.5.4/20 · 172.16.0.0/20 · Private-Use.')
    .waitFor({ timeout: 10_000 });
  check(
    `${T}: the entry opens back into Explain with the block`,
    (await block.inputValue()) === '172.16.5.4/20' && (await detail('network')) === '172.16.0.0/20',
  );

  // Saved parameters (D21): the task and Split by a person chose are written 400 ms after the change; the tool opened
  // again shows them, its fields empty. Then they are forgotten: the start page's pastes below choose for their visit.
  const stored = () =>
    page.evaluate(async () => (await chrome.storage.local.get('toolSettings')).toolSettings?.params?.subnet);
  await forgetSavedParameters(page, 'subnet');
  await task('Split');
  await page.getByRole('radio', { name: 'Number of subnets', exact: true }).click();
  await page.locator('#subnet-count').fill('3');
  for (let i = 0; i < 25 && (await stored())?.values?.by !== 'count'; i++) await sleep(200);
  await open('#/tools');
  await open('#/tools/subnet');
  await block.waitFor();
  const keptTask = {
    split: await page.getByRole('radio', { name: 'Split', exact: true }).getAttribute('aria-checked'),
    count: await page.getByRole('radio', { name: 'Number of subnets', exact: true }).getAttribute('aria-checked'),
    block: await block.inputValue(),
    subnets: await page.locator('#subnet-count').inputValue(),
  };
  check(
    `${T}: Split by Number of subnets chosen, the tool opened again — as left, its fields empty (saved parameters)`,
    keptTask.split === 'true' && keptTask.count === 'true' && keptTask.block === '' && keptTask.subnets === '',
    JSON.stringify({ keptTask, stored: await stored() }),
  );
  await forgetSavedParameters(page, 'subnet');

  // §7: a block pasted into the start page opens this tool in Explain; a column opens Summarize; a bare address does not.
  const paste = async text => {
    await open('#/start');
    const box = page.getByRole('combobox', { name: 'Find a tool or search the web' });
    await box.waitFor();
    await box.focus();
    await page.evaluate(value => {
      const data = new DataTransfer();
      data.setData('text/plain', value);
      document.activeElement.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    }, text);
  };
  await paste('10.0.0.0/8');
  await page.waitForFunction(() => location.hash === '#/tools/subnet', null, { timeout: 5_000 }).catch(() => {});
  await block.waitFor({ timeout: 10_000 }).catch(() => {});
  const one = { hash: await page.evaluate(() => location.hash), block: await block.inputValue().catch(() => null) };
  await paste('10.0.0.0/25\n10.0.0.128/25');
  await page.waitForFunction(() => location.hash === '#/tools/subnet', null, { timeout: 5_000 }).catch(() => {});
  await page
    .locator('#subnet-summary')
    .waitFor({ timeout: 10_000 })
    .catch(() => {});
  const column = await page
    .locator('#subnet-summary')
    .inputValue()
    .catch(() => null);
  await paste('1.2.3.4');
  await page.waitForTimeout(600);
  const bare = await page.evaluate(() => location.hash);
  check(
    `${T}: §7 a pasted block opens Explain with it, a column opens Summarize, a bare address does not open this tool`,
    one.hash === '#/tools/subnet' &&
      one.block === '10.0.0.0/8' &&
      column === '10.0.0.0/24' &&
      bare !== '#/tools/subnet',
    `${JSON.stringify(one)} column → ${JSON.stringify(column)}; 1.2.3.4 → ${bare}`,
  );

  return async () => {
    ctx.off('request', onRequest);
    cdp.off('Network.requestWillBeSent', onCdp);
    await cdp.detach().catch(() => undefined);
    await clipboard.restore();
  };
};
