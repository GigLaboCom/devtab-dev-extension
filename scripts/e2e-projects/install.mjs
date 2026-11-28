// The installation's number the page says to the companion in `hello.install` (D42, the companion's step O3), checked
// in the built extension against the fake host (./fake-host.mjs logs what each `hello` said): made once and kept as a
// plain string in chrome.storage.local under `companionInstall`; the same in every handshake and after a reload; a new
// one after the storage is cleared; a malformed value replaced; nowhere else — not in the page, its other storage or
// its console. Run by scripts/e2e-projects.mjs on a page connected to the companion; `installsOf(origin)` is also what
// it checks the free build's page with.

/* global document, window, chrome, location -- page.evaluate callbacks run in the page */

/** The contract's shape of `hello.install`. */
export const SHAPE = /^[A-Za-z0-9_-]{16,64}$/;

/** What each `hello` said in `install`, oldest first, with the origin of the host that heard it. */
export const installsOf = logOf => {
  const origins = new Map(
    logOf()
      .filter(r => r.event === 'start')
      .map(r => [r.pid, r.origin]),
  );
  return logOf()
    .filter(r => r.event === 'in' && r.type === 'hello')
    .map(r => ({ install: r.install ?? null, origin: origins.get(r.pid) ?? null, pid: r.pid }));
};

export const runCompanionInstall = async ({ page, origin, check, command, logOf, waitState }) => {
  const ours = () => installsOf(logOf).filter(h => h.origin === origin);
  const stored = () => page.evaluate(async () => (await chrome.storage.local.get('companionInstall')).companionInstall);
  /** The next handshake of a new host, after `act`. */
  const nextHello = async act => {
    const before = ours().length;
    await act();
    const deadline = Date.now() + 20_000;
    while (ours().length === before && Date.now() < deadline) await new Promise(r => setTimeout(r, 200));
    await waitState(page, 'ready');
    return ours().at(-1)?.install ?? null;
  };
  const consoleSaid = [];
  const listen = m => consoleSaid.push(m.text());
  page.on('console', listen);

  // ---- made at the first connection, the same in every handshake since ----------------------------------------------
  const said = ours().map(h => h.install);
  const number = await stored();
  check(
    'companion install: made at the first connection, kept as a plain string, said in every `hello` since',
    typeof number === 'string' && SHAPE.test(number) && said.length >= 3 && said.every(n => n === number),
    `${said.length} hellos, ${new Set(said).size} number(s); stored ${typeof number}`,
  );

  // ---- a reload: the same --------------------------------------------------------------------------------------------
  const afterReload = await nextHello(() => page.reload());
  check(
    'companion install: the page reloaded → the same number in the new handshake',
    afterReload === number,
    `${afterReload === number ? 'same' : 'differs'}`,
  );

  // ---- the storage cleared: a new one ---------------------------------------------------------------------------------
  const afterClear = await nextHello(async () => {
    await page.evaluate(() => chrome.storage.local.remove('companionInstall'));
    command({ exit: true });
  });
  const keptAfterClear = await stored();
  check(
    'companion install: the storage cleared → a new number, kept and said',
    typeof afterClear === 'string' && SHAPE.test(afterClear) && afterClear !== number && keptAfterClear === afterClear,
    `${afterClear === number ? 'same as before' : 'new'}; ${keptAfterClear === afterClear ? 'kept' : 'not kept'}`,
  );

  // ---- a malformed value: replaced -----------------------------------------------------------------------------------
  const afterBad = await nextHello(async () => {
    await page.evaluate(() => chrome.storage.local.set({ companionInstall: 'not a number!' }));
    command({ exit: true });
  });
  const keptAfterBad = await stored();
  check(
    'companion install: a malformed value → replaced by a new number, kept and said',
    typeof afterBad === 'string' && SHAPE.test(afterBad) && afterBad !== afterClear && keptAfterBad === afterBad,
    `${keptAfterBad === afterBad ? 'replaced' : String(keptAfterBad)}`,
  );

  // ---- nowhere else --------------------------------------------------------------------------------------------------
  const elsewhere = await page.evaluate(
    numbers => {
      const local = Object.entries(window.localStorage).map(([k, v]) => `${k}=${v}`);
      const html = document.documentElement.outerHTML;
      return chrome.storage.local.get(null).then(all => {
        const other = Object.entries(all)
          .filter(([k]) => k !== 'companionInstall')
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`);
        const places = {
          page: html,
          localStorage: local.join('\n'),
          storage: other.join('\n'),
          address: location.href,
        };
        return Object.entries(places)
          .filter(([, text]) => numbers.some(n => text.includes(n)))
          .map(([where]) => where);
      });
    },
    [number, afterClear, afterBad],
  );
  page.off('console', listen);
  const inConsole = consoleSaid.some(text => [number, afterClear, afterBad].some(n => text.includes(n)));
  check(
    'companion install: the number is nowhere else — not in the page, its address, its other storage or its console',
    elsewhere.length === 0 && !inConsole,
    `${[...elsewhere, ...(inConsole ? ['console'] : [])].join(', ') || 'nowhere'}`,
  );
  return afterBad;
};
