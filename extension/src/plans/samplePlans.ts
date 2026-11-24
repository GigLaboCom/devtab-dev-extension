/**
 * DEVTAB_LICENCE_TEST — the file the variant `plans:samplePlans` names: DEVTAB_VARIANT rewrites the root's line to
 * `export { samplePlans as planSource } from './samplePlans';` (extension/vite.config.ts), so the variant needs a module
 * of its own name. The placeholder source itself is ./sample.ts; never in a store build.
 */
export { samplePlans } from './sample';
