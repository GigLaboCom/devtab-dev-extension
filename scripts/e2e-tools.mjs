// The tools' own e2e checks, run by scripts/e2e-check.mjs in its step 3: every module in scripts/e2e-tools/ (one per
// tool, named after its id; scripts/new-tool.mjs writes the first one), in name order, on the main page of the built
// extension. Adding a tool's checks adds a file there and edits nothing here or in e2e-check.mjs.
//
// A module's default export is called with:
//   page    the main page (its console errors and page errors already count against the run)
//   base    chrome-extension://<id>/src/app/index.html — a tool's page is `${base}#/tools/<tool id>`
//   check   (name, ok, detail?) → ok; name each check after the tool: 'Base64: …'
//   shoot   (target, file) → a screenshot when the run was given --shots=<dir>; name files `tool-<id>-NN-….png`
//   sleep   (ms) → a promise
//   ctx     the browser context (a second page, a file chooser), report the run's JSON report
// It must leave the page where any page may go next (no dialog open, no route it changed for good).

/* global chrome -- page.evaluate callbacks run in the pages */

import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'e2e-tools');

export const toolCheckModules = () =>
  readdirSync(DIR)
    .filter(name => name.endsWith('.mjs'))
    .sort();

/** What Chrome has recorded for the extension so far (chrome://extensions → Errors). */
const recordedErrors = async ({ ctx, id }) => {
  const tab = await ctx.newPage();
  try {
    await tab.goto('chrome://extensions/');
    return await tab.evaluate(async extId => {
      const all = await chrome.developerPrivate.getExtensionsInfo({ includeDisabled: true });
      return (all.find(x => x.id === extId)?.runtimeErrors ?? []).map(e => e.message);
    }, id);
  } catch {
    return undefined; // the question itself must never fail a run
  } finally {
    await tab.close();
  }
};

/**
 * Runs every tool's module, or only those named in `args.only` (tool ids: `pnpm test:e2e --only=<id>`). After each
 * module it asks what Chrome recorded for the extension, so that an error found at the end of a long run is named with
 * the module it appeared in (`report.runtimeErrorsByModule`, and a line in the output).
 */
export const runToolChecks = async args => {
  const ran = [];
  let known = (await recordedErrors(args))?.length ?? 0;
  for (const name of toolCheckModules().filter(n => !args.only || args.only.includes(n.replace(/\.mjs$/, '')))) {
    const module = await import(pathToFileURL(join(DIR, name)).href);
    if (typeof module.default !== 'function') {
      args.check(
        `tool checks ${name}: a default export to run`,
        false,
        'export default async ({ page, base, check }) => …',
      );
      continue;
    }
    await module.default(args);
    ran.push(name.replace(/\.mjs$/, ''));
    const now = await recordedErrors(args);
    if (now && now.length > known) {
      const added = now.slice(known);
      (args.report.runtimeErrorsByModule ??= {})[ran.at(-1)] = added;
      console.log(
        `  (Chrome recorded ${added.length} error(s) during ${ran.at(-1)}: ${added.join(' | ').slice(0, 300)})`,
      );
    }
    known = now?.length ?? known;
  }
  args.report.toolChecks = ran;
  return ran;
};
