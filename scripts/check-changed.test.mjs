// The choices of scripts/check-changed.mjs: what a change runs, and that a path no rule knows runs everything.
import { commandsFor, planFor } from './check-changed.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const options = {
  toolModule: id => id === 'jwt',
  packageOf: file =>
    file.startsWith('extension/')
      ? 'extension'
      : /^packages\/tools\/(logic|ui)\/([^/]+)\//.exec(file)?.slice(1).join('-'),
};
const plan = (...files) => planFor(files, options);
const lines = (...files) => commandsFor(plan(...files)).map(([cmd, args]) => [cmd, ...args].join(' '));

test('documents need nothing', () => {
  assert.deepEqual(lines('README.md', 'docs/decisions.md', 'LICENSE.md', 'packages/dna/README.md'), []);
});

test('a section runs its own steps, its unit tests and the build, not the growth check', () => {
  const p = plan('extension/src/app/projects/ScratchView.tsx', 'extension/src/projects/scratch/store.ts');
  assert.deepEqual(p.full, []);
  assert.deepEqual(p.e2e, ['project-keys', 'scratches']);
  assert.deepEqual(p.packages, ['extension']);
  assert.equal(p.build, true);
  assert.equal(p.growth, false);
  assert.deepEqual(commandsFor(p).at(-1), ['pnpm', ['test:e2e', '--', '--only=project-keys,scratches']]);
});

test('the editor page runs every step that shows the editor', () => {
  assert.deepEqual(plan('extension/src/viewer/main.ts').e2e, [
    'compare',
    'editor-settings',
    'project-keys',
    'projects',
    'projects-demo',
    'scratches',
  ]);
});

test('the editor’s settings run every step with an editor and their own; Settings → Editor its step and the shell’s', () => {
  const editors = ['compare', 'editor-settings', 'project-keys', 'projects', 'projects-demo', 'scratches'];
  assert.deepEqual(plan('extension/src/editorSettings/resolve.ts').e2e, editors);
  assert.deepEqual(plan('extension/src/app/editor/IndentIndicator.tsx').e2e, editors);
  assert.deepEqual(plan('extension/src/app/settings/EditorSettingsGroup.tsx').e2e, ['editor-settings', 'shell']);
  assert.deepEqual(plan('scripts/e2e-editor-settings.mjs').e2e, ['editor-settings']);
  assert.equal(plan('extension/src/editorSettings/resolve.ts').growth, false);
});

test('what the start route reads also runs the growth check', () => {
  const p = plan('extension/src/shortcuts/actions.ts');
  assert.equal(p.growth, true);
  assert.deepEqual(p.e2e, ['project-keys', 'shell', 'start']);
});

test('a tool runs its own module when it has one, the tools step otherwise', () => {
  assert.deepEqual(plan('packages/tools/logic/jwt/src/decode.ts').e2e, ['jwt']);
  assert.deepEqual(plan('packages/tools/ui/case/src/CaseTool.tsx').e2e, ['tools']);
  assert.deepEqual(plan('packages/tools/logic/jwt/src/decode.ts').packages, ['extension', 'logic-jwt']);
});

test('a test file runs unit tests only', () => {
  assert.deepEqual(plan('extension/src/shared/anything.test.ts').full, []);
  const p = plan('extension/src/app/route.test.ts');
  assert.deepEqual(p.e2e, []);
  assert.equal(p.build, false);
  assert.deepEqual(p.packages, ['extension']);
});

test('an e2e script runs its step with a build and no unit tests', () => {
  const p = plan('scripts/e2e-scratches.mjs');
  assert.deepEqual(p.e2e, ['scratches']);
  assert.equal(p.build, true);
  assert.deepEqual(p.packages, []);
});

test('the licence step runs apart from the others', () => {
  const all = lines('extension/src/edition/pro.ts');
  assert.ok(all.includes('pnpm test:e2e -- --only=history,scratches,shell'));
  assert.ok(all.includes('pnpm test:e2e -- --only=licence'));
});

test('what no rule can vouch for runs everything', () => {
  for (const file of [
    'pnpm-lock.yaml',
    'packages/tools/logic/jwt/package.json',
    'crates/review-wasm/src/lib.rs',
    'extension/manifest.config.ts',
    'extension/src/background/index.ts',
    'scripts/validate-build.sh',
    'extension/src/somewhere/new.ts',
    'scripts/some-new-script.mjs',
    'a-new-top-level-file.ts',
  ]) {
    assert.deepEqual(lines(file), ['pnpm check', 'pnpm test:e2e'], file);
  }
});

test('the e2e harness runs every step and only the unit tests the other files choose', () => {
  const all = lines('scripts/e2e-check.mjs', 'extension/src/projects/scratch/store.ts');
  assert.equal(all.at(-1), 'pnpm test:e2e');
  assert.ok(!all.includes('pnpm check'));
  assert.ok(all.some(line => line.includes('--filter=...extension')));
});

test('this script is checked by its own test', () => {
  assert.deepEqual(
    lines('scripts/check-changed.mjs', 'scripts/check-changed.test.mjs').at(-1),
    'pnpm test:check-changed',
  );
});

test('one unknown path among known ones still runs everything', () => {
  assert.deepEqual(lines('extension/src/app/projects/ScratchView.tsx', 'extension/src/unknown/x.ts'), [
    'pnpm check',
    'pnpm test:e2e',
  ]);
});
