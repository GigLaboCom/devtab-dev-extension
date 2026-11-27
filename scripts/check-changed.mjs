#!/usr/bin/env node
// Which checks a change needs, from the files it touches — and, with --run, those checks and no others.
//
// `pnpm check` and the whole `pnpm test:e2e` prove everything every time: the tests of a hundred packages and every
// end-to-end step, whatever changed. That is right before a release and wasteful after a change to one section. This
// script reads the changed files and chooses:
//
//   nothing      documents only (*.md, docs/, LICENSE)
//   lint, format only the changed files
//   type-check   whenever code changed (turbo caches it per package)
//   unit tests   the packages that changed and the packages that depend on them (turbo's `...<package>` filter)
//   build and validate:build    whenever something that ships changed; validate:growth only for what the start route
//                               reads (it builds the extension twice)
//   e2e          only the steps of the sections touched (RULES below), a tool's own module for a tool
//   everything   what no rule can vouch for: dependencies, the lockfile, build configuration, the manifest, the
//                editor's Rust code — and any path no rule knows. Unknown means everything. A change to the e2e
//                harness itself runs every e2e step, with the unit tests the other files choose.
//
// The full run stays the gate before anything is published: `pnpm check && pnpm test:e2e`.
//
// Usage: node scripts/check-changed.mjs [--base=<git ref>] [--files=<a,b,…>] [--run] [--json]
//   --base   compare with this commit instead of HEAD (e.g. --base=origin/init for everything not pushed yet);
//            uncommitted and untracked files are always included
//   --files  the changed files given directly (no git)
//   --run    run the plan, one command after another, stopping at the first failure
//   --json   print the plan as JSON
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Documents: nothing to check. */
const DOCUMENT = /(^|\/)(LICENSE[^/]*|[^/]+\.md)$|^docs\//;

/** A change no rule can vouch for: everything runs. First match wins; the text says why. */
const EVERYTHING = [
  [
    /^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.npmrc|\.nvmrc|turbo\.json|eslint\.config\.js)$/,
    'dependencies or tooling',
  ],
  [/(^|\/)package\.json$/, "a package's dependencies or scripts"],
  [/^patches\//, 'a patched dependency'],
  [/^packages\/(tsconfig|env|hmr)\//, 'build tooling'],
  [/^(crates|vendor)\//, "the editor's Rust code (rebuild the module first: crates/review-wasm/build.sh)"],
  [/^packages\/review-wasm\//, 'the editor module'],
  [
    /^extension\/(manifest\.config\.ts|product\.json|vite\.config\.ts|vitest\.config\.ts|tsconfig[^/]*\.json)$/,
    'the manifest or the build',
  ],
  [/^extension\/(build|public|icons-src)\//, 'the build'],
  [/^extension\/src\/(background|test)\//, 'the service worker or the test setup'],
  [/^scripts\/validate-build\./, 'the checks of the build'],
  [/^bash-scripts\//, 'build scripts'],
];

/** The end-to-end harness: every step runs, the unit tests stay as the other files choose. */
const E2E_HARNESS = /^scripts\/(e2e-check\.mjs|e2e-helpers\.mjs|e2e-setup\.sh)$/;

/** This script and its test: the test is the check. */
const SELF = /^scripts\/check-changed\./;

/** Path → the end-to-end steps that exercise it (the names `pnpm test:e2e -- --only=` takes). */
const EDITOR_USERS = ['compare', 'projects-demo', 'projects', 'scratches', 'project-keys'];
const RULES = [
  [/^extension\/src\/[^/]+\.test\.ts$/, []],
  [/^extension\/src\/(viewer|highlighter)\//, EDITOR_USERS],
  [/^extension\/src\/shared\/viewerProtocol\.ts$/, EDITOR_USERS],
  [/^extension\/src\/compare\//, ['compare', 'scratches']],
  [/^extension\/src\/app\/sections\/ComparePage/, ['compare']],
  [/^extension\/src\/app\/handoff\.ts$/, ['compare', 'history']],
  [/^extension\/src\/projects\/scratch\//, ['scratches', 'project-keys']],
  [/^extension\/src\/app\/projects\/(Scratch|DeleteScratch|LanguagePicker|scratches)/, ['scratches', 'project-keys']],
  [/^extension\/src\/(projects|app\/projects)\//, ['projects-demo', 'projects', 'scratches', 'project-keys']],
  [/^extension\/src\/app\/sections\/ProjectsPage/, ['projects-demo', 'projects', 'scratches', 'project-keys']],
  [/^extension\/src\/app\/sectionPermissions\.ts$/, ['projects-demo', 'projects', 'shell']],
  [/^extension\/src\/(start|newTab)\//, ['start', 'own-page']],
  [/^extension\/src\/app\/(start\/|useStart\.ts|sections\/StartPage)/, ['start', 'own-page']],
  [/^extension\/src\/(toolbar|popup)\//, ['toolbar']],
  [/^extension\/src\/tools\//, ['tools']],
  [/^extension\/src\/app\/(tools\/|sections\/ToolsPage)/, ['tools']],
  [/^extension\/src\/(history|app\/history)\//, ['history']],
  [/^extension\/src\/(edition|licence|plans)\//, ['history', 'licence', 'shell', 'scratches']],
  [/^extension\/src\/app\/(editionWait|useHostEdition)\.ts$/, ['history', 'licence', 'shell', 'scratches']],
  [/^packages\/licence\//, ['licence']],
  [/^extension\/src\/(shell|shortcuts|options)\//, ['shell', 'start', 'project-keys']],
  [/^extension\/src\/shared\/(keys|keyLabels|destinations|pages|finder)\.ts$/, ['shell', 'start', 'project-keys']],
  [
    /^extension\/src\/app\/(shell\/|finder\/|settings\/|Shell\.tsx|shell\.css|route\.|destinationIcons|sections\/(Settings|Shortcut))/,
    ['shell'],
  ],
  [/^extension\/src\/app\/(App\.|main\.tsx|index\.html|app\.css)/, ['shell', 'start']],
  [/^extension\/src\/shared\/theme\//, ['themes']],
  [/^extension\/src\/app\/(useTheme\.ts|ThemePicker\.tsx)$/, ['themes']],
  [/^packages\/(dna|theme|ui)\//, ['themes', 'shell']],
  [/^packages\/tools\/shared\//, ['tools']],
  [/^scripts\/e2e-(start|start-assembly)\.mjs$/, ['start']],
  [/^scripts\/e2e-own-page\.mjs$/, ['own-page']],
  [/^scripts\/e2e-toolbar\.mjs$/, ['toolbar']],
  [/^scripts\/e2e-compare\.mjs$/, ['compare']],
  [/^scripts\/e2e-(tools\.mjs|grammars)/, ['tools']],
  [/^scripts\/e2e-shell\.mjs$/, ['shell']],
  [/^scripts\/e2e-theme\.mjs$/, ['themes']],
  [/^scripts\/e2e-history\.mjs$/, ['history']],
  [/^scripts\/e2e-scratches\.mjs$/, ['scratches']],
  [/^scripts\/e2e-keys\.mjs$/, ['project-keys']],
  [/^scripts\/e2e-projects-demo\.mjs$/, ['projects-demo']],
  [/^scripts\/e2e-projects(\.mjs|\/)/, ['projects']],
];

/** What the start route reads: a change here also needs validate:growth. */
const START_ROUTE =
  /^extension\/src\/(start|newTab|shortcuts|shared|tools)\/|^extension\/src\/app\/(start\/|useStart)|^scripts\/start-route/;

/** Scripts that are neither shipped nor a check of the build: linted and formatted, nothing else. */
const PLAIN_SCRIPT =
  /^scripts\/(defaults|licences-check|new-tool|adapt-tool|bench-tools|history-measure|docs-checkout|install-hooks|toolbar-button|read-definitions|generate-icons|contract-sync|package)\./;

const isTest = file => /\.test\.[cm]?tsx?$/.test(file) || /(^|\/)(tests?|__tests__)\//.test(file);
const isCode = file => /\.[cm]?[jt]sx?$/.test(file);

/** The workspace package a file belongs to: the name in the nearest package.json below the root. */
const packageOf = (file, root = ROOT) => {
  for (let dir = dirname(file); dir !== '.' && dir !== '/'; dir = dirname(dir)) {
    const manifest = join(root, dir, 'package.json');
    if (existsSync(manifest)) return JSON.parse(readFileSync(manifest, 'utf8')).name;
  }
  return undefined;
};

/**
 * The plan for a list of changed files (paths from the repository's root). `options.toolModule(id)` says whether a
 * tool has an e2e module of its own; `options.packageOf(file)` names a file's workspace package.
 */
export const planFor = (files, options = {}) => {
  const toolModule = options.toolModule ?? (id => existsSync(join(ROOT, 'scripts', 'e2e-tools', `${id}.mjs`)));
  const pkgOf = options.packageOf ?? packageOf;
  const plan = {
    files: files.length,
    full: [],
    lint: [],
    format: [],
    typeCheck: false,
    packages: [],
    mockBackend: false,
    self: false,
    allE2e: false,
    build: false,
    growth: false,
    e2e: [],
    why: {},
  };
  const steps = new Set();
  const packages = new Set();
  const note = (key, file) => ((plan.why[key] ??= []).length < 3 ? plan.why[key].push(file) : undefined);
  for (const file of files) {
    if (DOCUMENT.test(file)) continue;
    const everything = EVERYTHING.find(([pattern]) => pattern.test(file));
    if (everything) {
      plan.full.push(`${file}: ${everything[1]}`);
      continue;
    }
    plan.format.push(file);
    if (isCode(file)) plan.lint.push(file);
    if (/^scripts\/mock-backend\//.test(file)) {
      plan.mockBackend = true;
      continue;
    }
    if (SELF.test(file)) {
      plan.self = true;
      continue;
    }
    if (E2E_HARNESS.test(file)) {
      plan.allE2e = true;
      plan.build = true;
      continue;
    }
    if (PLAIN_SCRIPT.test(file)) continue;
    const tool = /^packages\/tools\/(logic|ui)\/([^/]+)\//.exec(file);
    // A test file proves itself in the unit run of its package, whatever section it sits in.
    if (isTest(file) && !tool && /^(extension|packages)\//.test(file)) {
      plan.typeCheck = true;
      const owner = pkgOf(file);
      if (owner) packages.add(owner);
      continue;
    }
    const toolE2e = /^scripts\/e2e-tools\/([^/]+)\.mjs$/.exec(file);
    const rule = RULES.find(([pattern]) => pattern.test(file));
    if (!tool && !toolE2e && !rule) {
      plan.full.push(`${file}: no rule knows this path`);
      continue;
    }
    if (toolE2e) {
      steps.add(toolE2e[1]);
      note(toolE2e[1], file);
      continue;
    }
    plan.typeCheck = true;
    const name = pkgOf(file);
    if (name) packages.add(name);
    // The extension's own tests read every tool's definition (src/tools/*.test.ts) without depending on the package.
    if (tool) packages.add('extension');
    const shipped = !isTest(file) && !file.startsWith('scripts/');
    if (shipped) plan.build = true;
    if (shipped && START_ROUTE.test(file)) plan.growth = true;
    if (shipped && tool && tool[1] === 'ui') plan.growth = true;
    // A test file proves itself in the unit run; an e2e script and shipped code need the browser.
    if (isTest(file)) continue;
    for (const step of tool ? [toolModule(tool[2]) ? tool[2] : 'tools'] : rule[1]) {
      steps.add(step);
      note(step, file);
    }
  }
  plan.packages = [...packages].sort();
  plan.e2e = [...steps].sort();
  if (plan.e2e.length > 0) plan.build = true;
  return plan;
};

/** The commands of a plan, in order. */
export const commandsFor = plan => {
  if (plan.full.length > 0)
    return [
      ['pnpm', ['check']],
      ['pnpm', ['test:e2e']],
    ];
  const commands = [];
  if (plan.lint.length > 0) commands.push(['pnpm', ['exec', 'eslint', ...plan.lint]]);
  if (plan.format.length > 0)
    commands.push(['pnpm', ['exec', 'prettier', '--check', '--ignore-unknown', ...plan.format]]);
  if (plan.typeCheck) commands.push(['pnpm', ['type-check']]);
  if (plan.packages.length > 0)
    commands.push([
      'pnpm',
      ['exec', 'turbo', 'test', '--concurrency=6', ...plan.packages.map(name => `--filter=...${name}`)],
    ]);
  if (plan.mockBackend) commands.push(['pnpm', ['test:mock-backend']]);
  if (plan.self) commands.push(['pnpm', ['test:check-changed']]);
  if (plan.build) commands.push(['pnpm', ['build']], ['pnpm', ['validate:build']]);
  if (plan.growth) commands.push(['pnpm', ['validate:growth']]);
  if (plan.allE2e) return [...commands, ['pnpm', ['test:e2e']]];
  // The licence step builds its own variant of the extension, so it runs apart from the others.
  const steps = plan.e2e.filter(step => step !== 'licence');
  if (steps.length > 0) commands.push(['pnpm', ['test:e2e', '--', `--only=${steps.join(',')}`]]);
  if (plan.e2e.includes('licence')) commands.push(['pnpm', ['test:e2e', '--', '--only=licence']]);
  return commands;
};

const changedFiles = base => {
  const git = (...args) =>
    execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' })
      .split('\0')
      .filter(Boolean);
  // Deleted files are left out of lint and format, but still choose the checks of their section.
  return [
    ...new Set([...git('diff', '--name-only', '-z', base), ...git('ls-files', '--others', '--exclude-standard', '-z')]),
  ];
};

/**
 * Whether a changed package.json differs from the base only in its `scripts`: new or renamed commands change no
 * dependency and nothing that is built, so they do not run everything (the commands they name have rules of their own).
 */
const onlyScriptsChanged = (file, base) => {
  const withoutScripts = text => JSON.stringify({ ...JSON.parse(text), scripts: undefined });
  try {
    const before = execFileSync('git', ['-C', ROOT, 'show', `${base}:${file}`], { encoding: 'utf8' });
    return withoutScripts(before) === withoutScripts(readFileSync(join(ROOT, file), 'utf8'));
  } catch {
    return false;
  }
};

const main = () => {
  const flag = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const base = flag('base') ?? 'HEAD';
  const given = flag('files')?.split(',').filter(Boolean);
  const all = given ?? changedFiles(base);
  const scriptsOnly = given
    ? []
    : all.filter(file => /(^|\/)package\.json$/.test(file) && onlyScriptsChanged(file, base));
  const files = all.filter(file => !scriptsOnly.includes(file));
  const plan = planFor(files);
  plan.format.push(...scriptsOnly);
  for (const key of ['lint', 'format']) plan[key] = plan[key].filter(file => existsSync(join(ROOT, file)));
  const commands = commandsFor(plan);
  if (process.argv.includes('--json')) {
    console.log(
      JSON.stringify({ ...plan, commands: commands.map(([cmd, args]) => [cmd, ...args].join(' ')) }, null, 2),
    );
    return;
  }
  console.log(`check-changed: ${all.length} changed file(s)`);
  for (const file of scriptsOnly) console.log(`  ${file}: only its scripts changed`);
  if (plan.full.length > 0) {
    console.log('  everything runs, because of:');
    for (const reason of plan.full.slice(0, 8)) console.log(`    ${reason}`);
    if (plan.full.length > 8) console.log(`    … and ${plan.full.length - 8} more`);
  } else if (commands.length === 0) {
    console.log('  documents only: nothing to check');
  } else {
    if (plan.packages.length > 0) console.log(`  unit tests: ${plan.packages.join(', ')} and what depends on them`);
    if (plan.allE2e) console.log('  e2e: every step, because the harness itself changed');
    for (const step of plan.allE2e ? [] : plan.e2e)
      console.log(`  e2e ${step}: ${plan.why[step].join(', ')}${plan.why[step].length === 3 ? ', …' : ''}`);
    if (plan.build && !plan.growth)
      console.log('  validate:growth is not needed: nothing the start route reads changed');
  }
  for (const [cmd, args] of commands) console.log(`  $ ${[cmd, ...args].join(' ')}`);
  if (!process.argv.includes('--run')) return;
  for (const [cmd, args] of commands) {
    console.log(`\n=== ${[cmd, ...args].join(' ')}`);
    const { status } = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
    if (status !== 0) {
      console.error(`=== FAILED (exit ${status}): ${[cmd, ...args].join(' ')}`);
      process.exit(status ?? 1);
    }
  }
  console.log('\ncheck-changed: all of the plan passed');
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
