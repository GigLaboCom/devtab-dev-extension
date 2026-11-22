/*! @license MIT
prettier 3.9.10 (its modules ship beside this file, as published) — Copyright © James Long and contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

The licences of what Prettier's modules bundle are its THIRD-PARTY-NOTICES.md, shipped beside them.
*/
/**
 * Prettier's worker (docs/tools/specs/code-format.md §5 п. 8, §9): formats off the page's thread. It carries no library
 * itself: Prettier's modules are files of this package (the bundler copies them as they are published and gives their
 * addresses), and the worker imports a language's modules from those files the first time that language is asked
 * for — `standalone` and the shared plugins (babel, estree, postcss) once. A bundled worker is one file and cannot
 * split, so this is how only the chosen language's modules load. Loaded from its own file by `formatter.ts`, never from
 * `blob:` or `data:`; cancelling is the page terminating it.
 */
import { formatWithPrettier, PRETTIER_PLUGINS } from '@workspace/tool-logic-code-format';
// The bundler's `?url`: the file copied as published, its address the default export (import-x reads the module's
// own types, which have no default).
/* eslint-disable import-x/default */
import babel from 'prettier/plugins/babel?url';
import estree from 'prettier/plugins/estree?url';
import html from 'prettier/plugins/html?url';
import markdown from 'prettier/plugins/markdown?url';
import postcss from 'prettier/plugins/postcss?url';
import yaml from 'prettier/plugins/yaml?url';
import standalone from 'prettier/standalone?url';
import notices from 'prettier/THIRD-PARTY-NOTICES.md?url';
/* eslint-enable import-x/default */
import type { FormatJob, FormatReply } from './formatter';
import type { PrettierLanguage, PrettierLike, PrettierModule } from '@workspace/tool-logic-code-format';

export type FormatRequest = FormatJob & { id: number; language: PrettierLanguage };

/**
 * The modules by name — and, never imported, the notices of what they bundle (MIT, ISC, BSD, Apache-2.0, BlueOak): the
 * published files carry no banner, so Prettier's notices file ships beside them, kept in the package by being named
 * here.
 */
const FILES: Record<PrettierModule | 'notices', string> = {
  standalone,
  babel,
  estree,
  postcss,
  html,
  markdown,
  yaml,
  notices,
};

/** The worker's global scope, as much of it as is used here (the package compiles against the page's DOM types). */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<FormatRequest>) => void) | null;
  postMessage: (reply: FormatReply) => void;
};

const modules = new Map<PrettierModule, Promise<unknown>>();
const load = (name: PrettierModule): Promise<unknown> => {
  let module = modules.get(name);
  if (!module) {
    module = import(/* @vite-ignore */ FILES[name]);
    modules.set(name, module);
    // A module that failed to load is asked for again next time.
    module.catch(() => modules.delete(name));
  }
  return module;
};

scope.onmessage = async ({ data }) => {
  const { id, language, text, settings } = data;
  try {
    const names: PrettierModule[] = ['standalone', ...PRETTIER_PLUGINS[language]];
    if (names.some(name => !modules.has(name))) scope.postMessage({ id, loading: language });
    const [prettier, ...plugins] = await Promise.all(names.map(load));
    const started = performance.now();
    const result = await formatWithPrettier(prettier as PrettierLike, plugins, language, text, settings);
    scope.postMessage({ id, result, ms: performance.now() - started });
  } catch (error) {
    scope.postMessage({ id, failure: error instanceof Error ? error.message : String(error) });
  }
};
