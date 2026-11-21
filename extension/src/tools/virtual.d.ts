/** Modules the build makes (vite.config.ts and vitest.config.ts serve them). */
declare module 'virtual:tool-catalogue' {
  import type { CatalogueEntry } from './catalogue';

  /** build/toolCatalogue.ts: the tools' entries as data, in their order. */
  export const CATALOGUE: readonly CatalogueEntry[];
}
