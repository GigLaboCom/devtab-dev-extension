// The start page assembled from what is kept (D16, docs/research/start-route-budget.md), run by scripts/e2e-start.mjs:
//   - what a new tab loads after its first load: only the code of the parts that are on (`<id>.run`) and what they
//     import, the shortcut listener and — when pasted text may need them — the tools' `detect`; never the shell, the
//     tools' definitions or components, a part that is off, the editor or the wasm;
//   - when: the parts' code (performance marks `start-part-<id>`) against the first paint; the `idle` parts (fuzzy
//     matching, opening a tool for pasted text) and the detectors only after it;
//   - no layout jump: the layout shifts of the first 1.5 s add up to 0 — with the default set, with everything off
//     but the field, with everything switched on;
//   - a paste at the very first moment, before the tools' `detect` has arrived, still opens the tool;
//   - Settings → Start page lists every piece, and an open start page follows a switch at once.
// Screenshots: start-dynamic-*.png (the default set, everything off, everything on, settings).

/* global document, window, location, chrome, DataTransfer, ClipboardEvent, MutationObserver -- page.evaluate callbacks run in the pages */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Chunks of dist/assets by name prefix, and what each imports statically. */
const chunkGraph = dist => {
  const dir = join(dist, 'assets');
  const files = readdirSync(dir).filter(f => f.endsWith('.js'));
  const imports = new Map(
    files.map(f => [
      f,
      [...readFileSync(join(dir, f), 'utf8').matchAll(/(?:from|import)\s*["']\.\/([^"']+\.js)["']/g)].map(m => m[1]),
    ]),
  );
  const named = prefix => files.filter(f => f.startsWith(`${prefix}-`));
  const reach = entries => {
    const seen = new Set();
    const queue = [...entries];
    while (queue.length) {
      const f = queue.shift();
      if (seen.has(f)) continue;
      seen.add(f);
      queue.push(...(imports.get(f) ?? []));
    }
    return seen;
  };
  return { files, named, reach };
};

const ALL_OFF_BUT_FIELD = parts => Object.fromEntries(parts.map(p => [p.id, false]));
const ALL_ON = parts => Object.fromEntries(parts.map(p => [p.id, true]));

export const runAssemblyChecks = async ({
  ctx,
  dist,
  base,
  newTab,
  field,
  region,
  loads,
  check,
  shoot,
  sleep,
  report,
}) => {
  const { parts } = JSON.parse(execFileSync('node', [join(HERE, 'start-parts.mjs')]).toString());
  const graph = chunkGraph(dist);

  // Layout shifts from before the first script; a paste at the first moment, when the address asks for it.
  await ctx.addInitScript(() => {
    if (!location.pathname.endsWith('/src/app/index.html')) return;
    window.__shifts = [];
    try {
      new PerformanceObserver(list => {
        for (const e of list.getEntries()) if (!e.hadRecentInput) window.__shifts.push(e.value);
      }).observe({ type: 'layout-shift', buffered: true });
    } catch {
      // no layout-shift entries in this browser: the check reports it
      window.__shifts = null;
    }
    const early = new URLSearchParams(location.search).get('e2e-early-paste');
    if (!early) return;
    const observer = new MutationObserver(() => {
      const input = document.querySelector('input[role="combobox"]');
      if (!input) return;
      observer.disconnect();
      input.focus();
      const data = new DataTransfer();
      data.setData('text/plain', early);
      window.__earlyPaste = {
        detectorsBefore: performance.getEntriesByName('tool-detectors').length,
        partBefore: performance.getEntriesByName('start-part-recognisePaste').length,
        at: performance.now(),
      };
      input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    observer.observe(document, { childList: true, subtree: true });
  });

  /** Writes the start page's settings through a page of ours, so the localStorage copy follows as it does for a person. */
  const setParts = async partsMap => {
    const p = await newTab();
    await p.evaluate(async value => {
      const { startSettings } = await chrome.storage.local.get('startSettings');
      await chrome.storage.local.set({
        startSettings: { ...(startSettings ?? {}), version: 2, parts: value, order: [] },
      });
    }, partsMap);
    await sleep(200);
    await p.close();
  };

  const measured = async p => {
    await sleep(1500);
    return p.evaluate(() => {
      const mark = name => performance.getEntriesByName(name)[0]?.startTime ?? null;
      const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null;
      return {
        fcp,
        shifts: window.__shifts,
        cls: window.__shifts ? +window.__shifts.reduce((a, b) => a + b, 0).toFixed(4) : null,
        parts: Object.fromEntries(
          performance
            .getEntriesByType('mark')
            .filter(m => m.name.startsWith('start-part-'))
            .map(m => [m.name.slice('start-part-'.length), +m.startTime.toFixed(1)]),
        ),
        detectors: mark('tool-detectors'),
        rows: [...document.querySelectorAll('.kit-tile-rows > [data-row]')].map(r => ({
          id: r.dataset.row,
          busy: r.getAttribute('aria-busy') === 'true',
          tiles: r.querySelectorAll('.kit-tile').length,
        })),
      };
    });
  };

  const lazyLoaded = p => {
    const lazy = new Set(graph.files);
    return (loads.get(p) ?? []).map(path => path.split('/').pop()).filter(f => lazy.has(f));
  };
  const runChunk = id => graph.named(`${id}.run`);
  /** What the start page may load after its first load, with these parts on. */
  const allowedWith = on =>
    graph.reach([
      ...on.flatMap(p => runChunk(p.id)),
      ...graph.named('startKeys'),
      ...(on.some(p => p.id === 'recognisePaste')
        ? [...graph.named('detectors'), ...graph.named('toolRecogniser')]
        : []),
    ]);
  const forbidden = f => /^(Shell|registry|behaviors|viewer)-|Tool-[\w-]{8}\.js$/.test(f) || f.endsWith('.wasm');

  // 1. The default set.
  await setParts({});
  const def = await newTab();
  const defaults = parts.filter(p => p.defaultOn);
  const defTiming = await measured(def);
  const defLoaded = lazyLoaded(def);
  const defAllowed = allowedWith(defaults);
  const offLoaded = parts.filter(p => !p.defaultOn).filter(p => runChunk(p.id).some(f => defLoaded.includes(f)));
  report.startAssembly = { default: { ...defTiming, lazyLoaded: defLoaded } };
  check(
    'default start page: after its first load only the code of the parts that are on, the shortcut listener and the tools’ detect',
    defLoaded.every(f => defAllowed.has(f)) && !defLoaded.some(forbidden) && offLoaded.length === 0,
    `${defLoaded.length} chunks: ${defLoaded.join(' ')}${offLoaded.length ? `; off but loaded: ${offLoaded.map(p => p.id)}` : ''}`,
  );
  const idle = defaults.filter(p => p.loadAt === 'idle');
  const startNow = defaults.filter(p => p.loadAt === 'start');
  check(
    'default start page: every part that is on has its code; the idle ones and the tools’ detect only after the first paint',
    defaults.every(p => typeof defTiming.parts[p.id] === 'number') &&
      idle.every(p => defTiming.parts[p.id] > defTiming.fcp) &&
      defTiming.detectors > defTiming.fcp,
    `first paint ${defTiming.fcp?.toFixed(1)} ms; ${startNow.map(p => `${p.id} ${defTiming.parts[p.id]}`).join(', ')}; ` +
      `idle: ${idle.map(p => `${p.id} ${defTiming.parts[p.id]}`).join(', ')}; detect ${defTiming.detectors?.toFixed(1)} ms`,
  );
  check(
    'default start page: no layout jump while the parts arrive (layout shifts add up to 0), the rows filled',
    defTiming.cls === 0 && defTiming.rows.every(r => !r.busy && r.tiles > 0),
    `CLS ${defTiming.cls}; rows ${JSON.stringify(defTiming.rows)}`,
  );
  await shoot(def, 'start-dynamic-01-default.png');

  // A paste at the very first moment: before the tools' detect has arrived, the paste waits and opens the tool.
  const json = '{"early":true,"paste":[1,2]}';
  const earlyPage = await ctx.newPage();
  await earlyPage.goto(`${base}?e2e-early-paste=${encodeURIComponent(json)}#/start`);
  await earlyPage.waitForFunction(() => location.hash === '#/tools/json', null, { timeout: 10_000 });
  await earlyPage.getByLabel('Input').waitFor({ timeout: 5_000 });
  const early = await earlyPage.evaluate(() => window.__earlyPaste);
  const earlyValue = await earlyPage.getByLabel('Input').inputValue();
  report.startAssembly.earlyPaste = early;
  check(
    'a paste before the tools’ detect has arrived (lazy) still opens the tool with the text',
    early?.detectorsBefore === 0 && earlyValue === json,
    JSON.stringify(early),
  );
  await earlyPage.close();

  // A paste once the detect is here is taken in its own event.
  const later = await newTab();
  await later.waitForFunction(() => performance.getEntriesByName('tool-detectors').length > 0, null, {
    timeout: 5_000,
  });
  const taken = await later.evaluate(() => {
    const input = document.querySelector('input[role="combobox"]');
    const data = new DataTransfer();
    data.setData('text/plain', '017F22E2-79B0-7CC3-98C4-DC0C0C07398F');
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    return { prevented: event.defaultPrevented, hash: location.hash };
  });
  check(
    'once the tools’ detect has arrived a paste is recognised in its own event',
    taken.prevented && taken.hash === '#/tools/uuid',
    JSON.stringify(taken),
  );
  await later.close();

  // 2. Everything off but the field.
  await setParts(ALL_OFF_BUT_FIELD(parts));
  const bare = await newTab();
  const bareTiming = await measured(bare);
  const bareLoaded = lazyLoaded(bare);
  const bareAllowed = allowedWith([]);
  await field(bare).fill('b64');
  const strictRows = await bare.getByRole('option').count();
  await field(bare).fill('json');
  const jsonRow = await bare.getByRole('option').first().innerText();
  await field(bare).fill('');
  const bareText = await bare.evaluate(() => {
    const input = document.querySelector('input[role="combobox"]');
    const data = new DataTransfer();
    data.setData('text/plain', '{"a":1}');
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    return { prevented: event.defaultPrevented, hash: location.hash };
  });
  report.startAssembly.allOff = { ...bareTiming, lazyLoaded: bareLoaded };
  check(
    'everything off but the field: no row, no part’s code, strict matching only, a paste is text, no layout jump',
    bareTiming.rows.length === 0 &&
      (await bare.getByText('Every row of the start page is off').isVisible()) &&
      bareLoaded.every(f => bareAllowed.has(f)) &&
      Object.keys(bareTiming.parts).length === 0 &&
      strictRows === 0 &&
      /JSON/.test(jsonRow) &&
      !bareText.prevented &&
      bareTiming.cls === 0,
    `${bareLoaded.join(' ') || 'no lazy chunk'}; 'b64' rows ${strictRows}; paste ${JSON.stringify(bareText)}; CLS ${bareTiming.cls}`,
  );
  await field(bare).fill('');
  await shoot(bare, 'start-dynamic-02-everything-off.png');

  // 3. Everything switched on (headless Chrome grants no optional permission: those rows say so in one line).
  await setParts(ALL_ON(parts));
  const all = await newTab();
  const allTiming = await measured(all);
  const rowIds = parts.filter(p => p.kind === 'row').map(p => p.id);
  const blocked = parts.filter(p => p.kind === 'row' && p.permissions.some(q => q.optional)).map(p => p.id);
  const blockedLines = await Promise.all(
    blocked.map(id => all.locator(`[data-row="${id}"]`).getByText('The permission this row needs was removed').count()),
  );
  report.startAssembly.allOn = { ...allTiming, lazyLoaded: lazyLoaded(all) };
  check(
    'everything on: every row in its place (those whose permission Chrome holds not say so), no layout jump',
    JSON.stringify(allTiming.rows.map(r => r.id)) === JSON.stringify(rowIds) &&
      blockedLines.every(n => n === 1) &&
      allTiming.cls === 0,
    `rows ${allTiming.rows.map(r => `${r.id}${r.busy ? ' (busy)' : ''}`).join(', ')}; CLS ${allTiming.cls}`,
  );
  await shoot(all, 'start-dynamic-03-everything-on.png');

  // 4. Settings list every piece; an open start page follows a switch at once.
  await setParts({});
  const watching = await newTab();
  const settings = await ctx.newPage();
  await settings.goto(`${base}#/settings`);
  await settings.getByRole('heading', { name: 'Start page', level: 2 }).waitFor();
  const switches = await Promise.all(
    parts.map(p => settings.getByRole('switch', { name: p.title, exact: true }).count()),
  );
  await shoot(settings, 'start-dynamic-04-settings.png');
  await watching.waitForFunction(() => performance.getEntriesByName('start-part-fuzzyMatching').length > 0, null, {
    timeout: 5_000,
  });
  await field(watching).fill('b64');
  const fuzzyOn = await watching.getByRole('option').first().innerText();
  await settings.getByRole('switch', { name: 'Fuzzy matching', exact: true }).click();
  await sleep(300);
  await field(watching).fill('');
  await field(watching).fill('b64');
  const fuzzyOff = await watching.getByRole('option').first().innerText();
  await settings.getByRole('switch', { name: 'Tools', exact: true }).click();
  await sleep(300);
  const toolsGone = (await region(watching, 'Tools').count()) === 0;
  await settings.getByRole('switch', { name: 'Tools', exact: true }).click();
  await settings.getByRole('switch', { name: 'Fuzzy matching', exact: true }).click();
  await region(watching, 'Tools').getByRole('link').first().waitFor({ timeout: 5_000 });
  check(
    'Settings → Start page lists every piece from the definitions; an open start page follows a switch at once',
    switches.every(n => n === 1) && /Base64/.test(fuzzyOn) && /Search the web/.test(fuzzyOff) && toolsGone,
    `${parts.map((p, i) => `${p.title}${switches[i] ? '' : ' (missing)'}`).join(', ')}; 'b64' with fuzzy: ${fuzzyOn.split('\n')[0]}, without: ${fuzzyOff.split('\n')[0]}`,
  );
  await settings.close();
  await watching.close();
};
