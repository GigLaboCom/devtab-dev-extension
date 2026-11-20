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
        // The extension's build configs live in tsconfig.node.json, outside the app's tsconfig.json.
        projectService: { allowDefaultProject: ['extension/*.config.ts'] },
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
