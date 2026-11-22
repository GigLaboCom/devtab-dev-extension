/**
 * One module worker per family of clients, each a file of its own in this package (docs/tools/specs/curl-to-code.md
 * §12, §15). The bundler builds a worker as one file and cannot split it, so a worker that chose its writer at run time
 * would carry all seventeen; instead every family has its worker — the tool's core and that family's writers — and the
 * page starts the one the chosen client needs. Loaded from the package's files, never `blob:` or `data:`; the URLs
 * are written out one by one because the bundler finds workers only by a literal `new URL(…)`.
 */
import type { Family } from '@workspace/tool-logic-curl-to-code';

export const WORKERS: Readonly<Record<Family, () => Worker>> = {
  javascript: () =>
    new Worker(new URL('./families/javascript.worker.ts', import.meta.url), {
      type: 'module',
      name: 'curl-to-code-javascript',
    }),
  python: () =>
    new Worker(new URL('./families/python.worker.ts', import.meta.url), {
      type: 'module',
      name: 'curl-to-code-python',
    }),
  shell: () =>
    new Worker(new URL('./families/shell.worker.ts', import.meta.url), { type: 'module', name: 'curl-to-code-shell' }),
  java: () =>
    new Worker(new URL('./families/java.worker.ts', import.meta.url), { type: 'module', name: 'curl-to-code-java' }),
  csharp: () =>
    new Worker(new URL('./families/csharp.worker.ts', import.meta.url), {
      type: 'module',
      name: 'curl-to-code-csharp',
    }),
  php: () =>
    new Worker(new URL('./families/php.worker.ts', import.meta.url), { type: 'module', name: 'curl-to-code-php' }),
  powershell: () =>
    new Worker(new URL('./families/powershell.worker.ts', import.meta.url), {
      type: 'module',
      name: 'curl-to-code-powershell',
    }),
  go: () =>
    new Worker(new URL('./families/go.worker.ts', import.meta.url), { type: 'module', name: 'curl-to-code-go' }),
  rust: () =>
    new Worker(new URL('./families/rust.worker.ts', import.meta.url), { type: 'module', name: 'curl-to-code-rust' }),
  kotlin: () =>
    new Worker(new URL('./families/kotlin.worker.ts', import.meta.url), {
      type: 'module',
      name: 'curl-to-code-kotlin',
    }),
  dart: () =>
    new Worker(new URL('./families/dart.worker.ts', import.meta.url), { type: 'module', name: 'curl-to-code-dart' }),
  ruby: () =>
    new Worker(new URL('./families/ruby.worker.ts', import.meta.url), { type: 'module', name: 'curl-to-code-ruby' }),
  swift: () =>
    new Worker(new URL('./families/swift.worker.ts', import.meta.url), { type: 'module', name: 'curl-to-code-swift' }),
};
