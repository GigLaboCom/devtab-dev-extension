// ESLint flat config — the second sibling extension's (itself the reference boilerplate's eslint.config.ts rule set,
// minus the tailwind/prettier-as-eslint-rule parts): formatting is checked separately by
// `pnpm format:check`, and eslint-config-prettier turns off every stylistic rule that would fight it.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { flatConfigs as importX } from 'eslint-plugin-import-x';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import { config, configs as tsConfigs, parser as tsParser } from 'typescript-eslint';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The tools' packages (D14), read from the folders: one block per tool below lets it import its own logic and nothing
 * of another tool, so adding a tool edits no line here.
 */
const toolIds = layer => {
  const dir = join(import.meta.dirname, 'packages/tools', layer);
  return existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter(e => e.isDirectory() && !['shared', 'host'].includes(e.name))
        .map(e => e.name)
    : [];
};
/** What a tool's package never imports, whichever layer (D14). */
const NOT_THE_EXTENSION = { group: ['@extension/*', '@src/*'], message: 'Tools never import the extension (D14).' };
/** Globals of a page that tool logic does without (D14: no DOM unless the specification says so; then a parameter). */
const DOM_GLOBALS = ['window', 'document', 'navigator', 'location', 'localStorage', 'sessionStorage', 'indexedDB'];

export default config(
  {
    // spikes/, vendor/, .state/, docs/: research code, binaries and working state — not part of the workspace.
    // packages/review-wasm/pkg: the editor module's generated JS (wasm-bindgen).
    ignores: [
      '**/dist/**',
      '**/dist-zip/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '.state/**',
      'spikes/**',
      'vendor/**',
      'docs/**',
      'packages/review-wasm/pkg/**',
      // The Rust workspace: its target/, tools and the module's generated JS (crates/review-wasm/pkg).
      'crates/**',
    ],
  },
  js.configs.recommended,
  ...tsConfigs.recommended,
  importX.recommended,
  importX.typescript,
  {
    // TypeScript (and node's own resolution for .mjs tooling) already reports unresolved imports.
    rules: { 'import-x/no-unresolved': 'off' },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
  {
    // Plain scripts that run in a page before any module (theme-boot.js).
    files: ['extension/public/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser } },
    rules: { '@typescript-eslint/no-unused-vars': ['error', { caughtErrors: 'none' }] },
  },
  {
    // Dev-only reload clients: plain browser scripts wrapped in an IIFE that defines __HMR_ID and __HMR_URL.
    files: ['packages/hmr/injections/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser, chrome: 'readonly', __HMR_ID: 'readonly', __HMR_URL: 'readonly' },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { caughtErrors: 'none' }],
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    ...react.configs.flat.recommended,
    ...react.configs.flat['jsx-runtime'],
    ...jsxA11y.flatConfigs.recommended,
    plugins: {
      ...react.configs.flat.recommended.plugins,
      ...jsxA11y.flatConfigs.recommended.plugins,
      'react-hooks': reactHooks,
    },
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
        // The extension's build configs live in tsconfig.node.json, outside the app's tsconfig.json — except
        // manifest.config.ts, which a test of the app imports (src/start/parts/manifest.test.ts), so the app's project
        // already has it.
        projectService: { allowDefaultProject: ['extension/vite.config.ts', 'extension/vitest.config.ts'] },
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        chrome: 'readonly',
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'prefer-const': 'error',
      'no-var': 'error',
      'func-style': ['error', 'expression', { allowArrowFunctions: true }],
      'arrow-body-style': ['error', 'as-needed'],
      // Raw console.* is reserved for build tooling; extension code logs through @extension/logger.
      'no-console': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/consistent-type-exports': 'error',
      'import-x/order': [
        'error',
        {
          'newlines-between': 'never',
          alphabetize: { order: 'asc', caseInsensitive: true },
          groups: ['index', 'sibling', 'parent', 'internal', 'external', 'builtin', 'object', 'type'],
          pathGroups: [{ pattern: '@*/**', group: 'internal', position: 'before' }],
          pathGroupsExcludedImportTypes: ['type'],
        },
      ],
      'import-x/no-named-as-default': 'error',
      'import-x/no-named-as-default-member': 'error',
      'import-x/newline-after-import': 'error',
      'import-x/no-duplicates': ['error', { considerQueryString: true, 'prefer-inline': false }],
      'import-x/consistent-type-specifier-style': 'error',
      'import-x/first': 'error',
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },
  {
    // D14: a tool's logic is pure TypeScript — no React, no DOM, no UI layer, no other tool, nothing of the extension, no
    // chrome. `shared` is the pure code every tool may use (but not the history core: that is the host's).
    files: ['packages/tools/logic/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['react', 'react/*', 'react-dom', 'react-dom/*'], message: 'Tool logic has no React (D14).' },
            {
              group: ['@testing-library/*', 'radix-ui', '@radix-ui/*', 'lucide-react', 'jsdom'],
              message:
                'Tool logic uses no DOM or UI library (D14); a Document, if the specification needs one, is a parameter.',
            },
            {
              group: [
                '@workspace/tools-host',
                '@workspace/tool-ui-*',
                '@workspace/ui',
                '@workspace/ui/*',
                '@workspace/dna',
                '@workspace/dna/*',
              ],
              message: 'Tool logic never imports the ui layer (D14).',
            },
            { group: ['@workspace/tool-logic-*'], message: 'A tool never imports another tool (D14).' },
            NOT_THE_EXTENSION,
          ],
        },
      ],
      'no-restricted-globals': ['error', { name: 'chrome', message: 'Tools never touch chrome.* (D14).' }],
    },
  },
  {
    // The DOM stays out of a tool's logic (its tsconfig leaves the DOM library out too); its tests may build fixtures.
    files: ['packages/tools/logic/**/*.{ts,tsx}'],
    ignores: ['packages/tools/logic/shared/**', 'packages/tools/logic/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'chrome', message: 'Tools never touch chrome.* (D14).' },
        ...DOM_GLOBALS.map(name => ({
          name,
          message: 'Tool logic has no DOM (D14): take what you need as a parameter.',
        })),
      ],
    },
  },
  {
    // D14: a tool's component and the host contract — nothing of the extension, no chrome. A tool records through its
    // host (ToolHost.history), never through a store of its own (D17): only the host contract imports the history core.
    files: ['packages/tools/ui/**/*.{ts,tsx}', 'extension/src/tools/**/*.{ts,tsx}'],
    ignores: ['packages/tools/ui/host/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@workspace/tools-shared/history', '@src/history', '@src/history/*'],
              message: 'Record through ToolHost.history (@workspace/tools-host), never a store (D17).',
            },
            { group: ['@workspace/tool-ui-*'], message: 'A tool never imports another tool (D14).' },
          ],
        },
      ],
      'no-restricted-globals': ['error', { name: 'chrome', message: 'Tools never touch chrome.* (D14).' }],
    },
  },
  // One block per tool's component: its own logic, never another tool's; never the extension (D14, D17).
  ...toolIds('ui').map(id => ({
    files: [`packages/tools/ui/${id}/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@workspace/tools-shared/history'],
              message: 'Record through ToolHost.history (@workspace/tools-host), never a store (D17).',
            },
            {
              group: ['@workspace/tool-ui-*', '@workspace/tool-logic-*', `!@workspace/tool-logic-${id}`],
              message: `A tool never imports another tool (D14): ${id} imports only @workspace/tool-logic-${id}.`,
            },
            NOT_THE_EXTENSION,
          ],
        },
      ],
    },
  })),
  {
    files: ['packages/tools/ui/host/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@extension/*', '@src/*'], message: 'The host contract never imports the extension (D14).' },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'chrome', message: 'The host contract never touches chrome.* (D14).' },
      ],
    },
  },
  {
    // Node-side tooling and the logger implementation itself may use console directly.
    files: ['packages/hmr/lib/**/*.ts', 'packages/logger/lib/**/*.ts', '**/vite.config.ts', '**/vitest.config.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    // eslint-plugin-react-hooks is CommonJS; its default import works at runtime but has no ESM
    // default export for import-x to see.
    files: ['eslint.config.js'],
    rules: { 'import-x/default': 'off' },
  },
  prettier,
);
