/**
 * `EditionSource`: the free version, chosen at build time — what the e2e builds next to the default one without
 * editing the root (DEVTAB_VARIANT=edition:fixedFree, extension/vite.config.ts).
 */
import { fixedSource } from './fixed';
import type { EditionSourceFactory } from './source';

export const fixedFree: EditionSourceFactory = Object.assign(() => fixedSource('free'), { id: 'fixedFree' as const });
