// The e2e checks of the mixed tree-sitter highlighter (DEVTAB_VARIANT=highlighter:treeSitter), run by
// scripts/e2e-check.mjs after «Compare code» when the build under test is that one — what the split table
// crates/review-wasm/grammars.json says, seen on the real editor page:
//   - a language whose grammar is a file is plain while the file is on its way (the test holds it back) and coloured
//     once it arrives, both sides, without another request from the page; the module says it repainted;
//   - the file is fetched once for the page however many texts and languages follow, the index once, and everything
//     the pages fetch is the extension's own (nothing from elsewhere);
//   - every other language the package ships as a file (not in the compare page's list) is coloured, and a language
//     the table has no grammar for is plain — the same pixel method as the list's (scripts/e2e-compare.mjs), on the
//     samples of scripts/e2e-grammars/;
//   - Chrome records no error for the extension meanwhile.
// Screenshots: grammar-file-before-light.png / grammar-file-after-light.png (a file-loaded language before and after
// its grammar arrives), grammar-none-light.png (a language left plain).

/* global document, location, addEventListener -- page.evaluate callbacks run in the pages */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { colourDifference } from './e2e-compare.mjs';
import { recordedErrors } from './e2e-tools.mjs';
import { readTable } from '../crates/review-wasm/grammars/build.mjs';
import { at, readDefinitions, ROOT } from './read-definitions.mjs';

const SAMPLES = join(ROOT, 'scripts/e2e-grammars');
const EXAMPLES = join(ROOT, 'extension/src/compare/examples');

/** The compare page's example pair of a language: before and after. */
const examplePair = language => {
  const files = readdirSync(join(EXAMPLES, language));
  const read = side =>
    readFileSync(
      join(
        EXAMPLES,
        language,
        files.find(f => f.startsWith(`${side}.`)),
      ),
      'utf8',
    );
  return {
    path: files.find(f => f.startsWith('after.')).replace(/\.txt$/, ''),
    oldText: read('before'),
    newText: read('after'),
  };
};

/** A sample of a language outside the list, on both sides. */
const samplePair = language => {
  const file = readdirSync(SAMPLES).find(f => f.replace(/\.[^.]+$/, '') === language);
  if (!file) return null;
  const text = readFileSync(join(SAMPLES, file), 'utf8');
  return { path: file, oldText: text, newText: text };
};

/** Holds the editor page's fetches of grammar files until the test releases them (only in that page's frames). */
const HOLD_GRAMMARS = () => {
  if (!location.pathname.includes('/src/viewer/')) return;
  const original = globalThis.fetch;
  let release;
  const released = new Promise(resolve => (release = resolve));
  globalThis.__releaseGrammars = () => release();
  globalThis.fetch = (input, init) => {
    const url = String(input?.url ?? input);
    return /\/grammars\/[^/]+\.wasm$/.test(url) ? released.then(() => original(input, init)) : original(input, init);
  };
};

export const runGrammarChecks = async ({ ctx, id, check, shoot, report, sleep }) => {
  const base = `chrome-extension://${id}/src/app/index.html`;
  const table = readTable();
  const listed = (
    await readDefinitions(
      `import { LANGUAGES } from ${at('extension/src/compare/languages.ts')}; export default LANGUAGES;`,
    )
  ).map(l => l.id);
  report.grammars = {};
  const errorsBefore = (await recordedErrors({ ctx, id }))?.length ?? 0;

  const page = await ctx.newPage();
  const requests = [];
  page.on('request', request => requests.push(request.url()));
  page.on('console', m => {
    if (m.type() === 'error' || m.type() === 'warning')
      report.console.push({ type: m.type(), text: m.text(), url: m.location().url });
  });
  page.on('pageerror', e => report.console.push({ type: 'pageerror', text: String(e) }));
  await page.addInitScript(HOLD_GRAMMARS);
  try {
    await page.goto(`${base}#/compare`);
    await page.waitForFunction(
      () => {
        const el = document.querySelector('.kit-compare-counts');
        return el?.dataset.viewerState === 'ready' && Number(el.dataset.shown) > 0;
      },
      null,
      { timeout: 45_000 },
    );
    await page.evaluate(() => {
      globalThis.__answers = [];
      addEventListener('message', e => globalThis.__answers.push({ ...e.data, at: Date.now() }));
    });
    const frame = page.locator('iframe.kit-compare-frame');
    const viewer = () => page.frames().find(f => f.url().endsWith('/src/viewer/index.html'));
    let probe = 6_000_000;
    /** Sends two texts as the page sends them; resolves with a screenshot of the editor once it answered. */
    const show = async (pair, language) => {
      const requestId = ++probe;
      await page.evaluate(
        ({ requestId, request }) =>
          document
            .querySelector('iframe.kit-compare-frame')
            .contentWindow.postMessage({ type: 'viewer/compare', id: requestId, request }, location.origin),
        { requestId, request: { ...pair, language } },
      );
      await page.waitForFunction(n => globalThis.__answers.some(m => m.id === n), requestId, { timeout: 15_000 });
      await sleep(350);
      return frame.screenshot();
    };
    /** The editor page's note for a language's grammar file, once it came. */
    const noteOf = async (language, timeout = 20_000) => {
      await page
        .waitForFunction(
          l => globalThis.__answers.some(m => m.type === 'viewer/grammar' && m.language === l),
          language,
          {
            timeout,
          },
        )
        .catch(() => {});
      return page.evaluate(
        l => globalThis.__answers.find(m => m.type === 'viewer/grammar' && m.language === l),
        language,
      );
    };

    // ---- a file-loaded language: plain while its file is held back, coloured once it arrives ----------------------
    const language = table.languages.find(e => e.grammar === 'file' && listed.includes(e.id)).id;
    const pair = examplePair(language);
    const plain = await show(pair, 'text');
    const held = await show(pair, language);
    await shoot(frame, 'grammar-file-before-light.png');
    const before = await colourDifference(ctx, held, plain);
    const fetchedWhileHeld = requests.filter(u => u.includes('/grammars/')).map(u => u.replace(/^.*\/grammars\//, ''));
    await viewer().evaluate(() => globalThis.__releaseGrammars());
    const note = await noteOf(language);
    await sleep(350);
    const arrived = await frame.screenshot();
    await shoot(frame, 'grammar-file-after-light.png');
    const after = await colourDifference(ctx, arrived, plain);
    report.grammars.heldBack = { language, before, after, note, fetchedWhileHeld };
    check(
      `grammars: ${language} (a grammar file) is plain while its file is on its way and coloured once it arrives — the open text repainted, both sides`,
      before.vivid <= 500 && after.vivid > 500 && note?.state === 'loaded' && note.repainted === true,
      `strongly coloured pixels: ${before.vivid} held back, ${after.vivid} after; ${JSON.stringify(note)}`,
    );

    // The same language again, other texts, a swap of languages and back: no second fetch.
    await show({ ...pair, oldText: pair.newText, newText: pair.oldText }, language);
    await show(pair, 'rust');
    await show(pair, language);
    const fetches = name => requests.filter(u => u.endsWith(`/grammars/${name}`)).length;
    const { file } = JSON.parse(
      readFileSync(join(ROOT, 'packages/review-wasm/pkg-tree-sitter/grammars/index.json'), 'utf8'),
    ).grammars[language];
    const indexFetches = fetches('index.json');
    check(
      `grammars: the grammar file is fetched once for the page (${file}), the index once`,
      fetches(file) === 1 && indexFetches === 1,
      `grammars/${file} ${fetches(file)}×, grammars/index.json ${indexFetches}×`,
    );

    // ---- every other language the package ships as a file, and one with no grammar --------------------------------
    const others = table.languages.filter(e => !listed.includes(e.id) && e.grammar !== 'builtIn');
    const colours = {};
    for (const entry of others) {
      const sample = samplePair(entry.id);
      if (!sample) {
        colours[entry.id] = { grammar: entry.grammar, missing: 'no sample in scripts/e2e-grammars/' };
        continue;
      }
      const plainShot = await show(sample, 'text');
      let shot = await show(sample, entry.id);
      let loaded = null;
      if (entry.grammar === 'file') {
        loaded = await noteOf(entry.id);
        await sleep(350);
        shot = await frame.screenshot();
      } else await shoot(frame, `grammar-none-light.png`);
      colours[entry.id] = { grammar: entry.grammar, ...(await colourDifference(ctx, shot, plainShot)), note: loaded };
    }
    report.grammars.others = colours;
    const wrong = Object.entries(colours).filter(
      ([, c]) =>
        c.missing || (c.grammar === 'file') !== c.vivid > 500 || (c.grammar === 'file' && c.note?.state !== 'loaded'),
    );
    check(
      `grammars: the other languages shipped as files are coloured, one with no grammar is plain (${others.length}: ${others
        .map(e => `${e.id} ${e.grammar}`)
        .join(', ')})`,
      wrong.length === 0,
      Object.entries(colours)
        .map(([l, c]) => `${l} ${c.missing ?? c.vivid}`)
        .join(', '),
    );

    // ---- what the pages fetched, and what Chrome recorded ---------------------------------------------------------
    const outside = requests.filter(u => !u.startsWith(`chrome-extension://${id}/`));
    report.grammars.requests = { total: requests.length, outside };
    check(
      'grammars: everything the pages fetched is the extension’s own (no network, no other origin)',
      outside.length === 0,
      outside.length ? outside.slice(0, 5).join(' ') : `${requests.length} requests, all chrome-extension://${id}/`,
    );
    const errorsAfter = await recordedErrors({ ctx, id });
    const added = (errorsAfter ?? []).slice(errorsBefore);
    check(
      'grammars: no runtime error recorded for the extension',
      errorsAfter !== undefined && added.length === 0,
      added.join(' | '),
    );
  } finally {
    await page.close();
  }
};
