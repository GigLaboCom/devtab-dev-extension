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
  assert.deepEqual(p.e2e, ['editor-strip', 'project-keys', 'scratches']);
  assert.deepEqual(p.packages, ['extension']);
  assert.equal(p.build, true);
  assert.equal(p.growth, false);
  assert.deepEqual(commandsFor(p).at(-1), ['pnpm', ['test:e2e', '--', '--only=editor-strip,project-keys,scratches']]);
});

test('the editor page runs every step that shows the editor', () => {
  assert.deepEqual(plan('extension/src/viewer/main.ts').e2e, [
    'compare',
    'editor-settings',
    'editor-strip',
    'project-keys',
    'projects',
    'projects-demo',
    'scratches',
  ]);
});

test('the editor’s settings run every step with an editor and their own; Settings → Editor its step and the shell’s', () => {
  const editors = [
    'compare',
    'editor-settings',
    'editor-strip',
    'project-keys',
    'projects',
    'projects-demo',
    'scratches',
  ];
  assert.deepEqual(plan('extension/src/editorSettings/resolve.ts').e2e, editors);
  assert.deepEqual(plan('extension/src/app/editor/IndentIndicator.tsx').e2e, editors);
  assert.deepEqual(plan('extension/src/app/settings/EditorSettingsGroup.tsx').e2e, ['editor-settings', 'shell']);
  assert.deepEqual(plan('scripts/e2e-editor-settings.mjs').e2e, ['editor-settings']);
  assert.deepEqual(plan('scripts/e2e-editor-strip.mjs').e2e, ['editor-strip']);
  assert.deepEqual(plan('extension/src/app/editor/EditorStrip.tsx').e2e, editors);
  assert.deepEqual(plan('extension/src/app/projects/EditorPane.tsx').e2e, [
    'editor-strip',
    'project-keys',
    'projects',
    'projects-demo',
    'scratches',
  ]);
  assert.equal(plan('extension/src/editorSettings/resolve.ts').growth, false);
});

test('profiles and a project’s .editorconfig (D39): the edition, its host and the demo’s data run the editor’s step too', () => {
  const editors = [
    'compare',
    'editor-settings',
    'editor-strip',
    'project-keys',
    'projects',
    'projects-demo',
    'scratches',
  ];
  assert.deepEqual(plan('extension/src/editorSettings/editorconfig/glob.ts').e2e, editors);
  assert.deepEqual(plan('extension/src/app/settings/EditorSettingsProfiles.tsx').e2e, ['editor-settings', 'shell']);
  assert.ok(plan('extension/src/edition/free.ts').e2e.includes('editor-settings'));
  assert.ok(plan('extension/src/app/useHostEdition.ts').e2e.includes('editor-settings'));
  assert.ok(!plan('extension/src/licence/client.ts').e2e.includes('editor-settings'));
  assert.deepEqual(plan('extension/src/history/behaviors.ts').e2e, ['editor-settings', 'history']);
  assert.deepEqual(plan('extension/src/history/idbStore.ts').e2e, ['history']);
  assert.deepEqual(plan('extension/src/projects/demo/data.ts').e2e, [
    'editor-settings',
    'editor-strip',
    'project-keys',
    'projects',
    'projects-demo',
    'scratches',
  ]);
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
  assert.ok(all.includes('pnpm test:e2e -- --only=editor-settings,history,scratches,shell'));
  assert.ok(all.includes('pnpm test:e2e -- --only=licence'));
});

test('what no rule can vouch for runs everything', () => {
  for (const file of [
    'pnpm-lock.yaml',
    'packages/tools/logic/jwt/package.json',
    'packages/review-wasm/package.json',
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

test('the editor runs the sections that hold one and leaves the tools alone', () => {
  for (const file of [
    'crates/review-view/src/view.rs',
    'vendor/gpui-kit/pin.json',
    'packages/review-wasm/lib/host.ts',
  ]) {
    const p = plan(file);
    assert.deepEqual(p.full, [], file);
    for (const step of [
      'compare',
      'projects',
      'scratches',
      'editor-settings',
      'own-page',
      'shell',
      'themes',
      'history',
    ])
      assert.ok(p.e2e.includes(step), `${file}: ${step}`);
    for (const step of ['tools', 'start', 'toolbar', 'licence']) assert.ok(!p.e2e.includes(step), `${file}: ${step}`);
    assert.deepEqual(p.packages, ['@extension/review-wasm']);
    assert.equal(p.build, true);
    assert.equal(p.growth, false);
    const all = commandsFor(p).map(([cmd, args]) => [cmd, ...args].join(' '));
    assert.ok(!all.includes('pnpm check') && !all.includes('pnpm test:e2e'), file);
    assert.ok(
      all.some(line => line.includes('--filter=...@extension/review-wasm')),
      file,
    );
  }
  // Rust is neither linted nor formatted here, and the plan says what it does not do.
  const rust = plan('crates/review-view/src/view.rs');
  assert.deepEqual([rust.lint, rust.format], [[], []]);
  assert.equal(rust.notes.length, 1);
  const ts = plan('packages/review-wasm/lib/host.ts');
  assert.deepEqual(
    [ts.lint, ts.format, ts.notes],
    [['packages/review-wasm/lib/host.ts'], ['packages/review-wasm/lib/host.ts'], []],
  );
  // A test of the module proves itself in the unit run.
  assert.deepEqual(plan('packages/review-wasm/lib/controller.test.ts').e2e, []);
  // With a tool touched as well, the tool's own checks join; nothing else of the tools does.
  assert.deepEqual(
    plan('crates/review-view/src/view.rs', 'packages/tools/ui/jwt/src/Jwt.tsx').e2e.filter(
      s => s === 'jwt' || s === 'tools',
    ),
    ['jwt'],
  );
});

test('the script that orders the steps runs every step but the tools, and one tool as a proof', () => {
  const all = lines('scripts/e2e-check.mjs', 'extension/src/projects/scratch/store.ts');
  assert.deepEqual(all.slice(-2), ['pnpm test:e2e -- --skip=tools', 'pnpm test:e2e -- --only=jwt']);
  assert.ok(!all.includes('pnpm check') && !all.includes('pnpm test:e2e'));
  // A tool changed with it: that tool is the proof. All the tools asked for by a rule: every step.
  assert.deepEqual(lines('scripts/e2e-check.mjs', 'packages/tools/ui/jwt/src/Jwt.tsx').slice(-2), [
    'pnpm test:e2e -- --skip=tools',
    'pnpm test:e2e -- --only=jwt',
  ]);
  assert.equal(lines('scripts/e2e-check.mjs', 'packages/tools/shared/src/x.ts').at(-1), 'pnpm test:e2e');
});

test('the e2e harness runs every step and only the unit tests the other files choose', () => {
  const all = lines('scripts/e2e-helpers.mjs', 'extension/src/projects/scratch/store.ts');
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
