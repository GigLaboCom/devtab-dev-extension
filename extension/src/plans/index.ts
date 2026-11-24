/**
 * The composition root of the plans list — seam `PlanSource` (./source.ts): the record the service worker writes from
 * the licence server's `GET /v1/plans` (./remote.ts). Everything about the plans comes from the server; a build whose
 * licence configuration has no server shows none. Screenshots of the showcase read the placeholder variant without
 * editing this file (DEVTAB_VARIANT=…,plans:samplePlans, extension/vite.config.ts), which a store build never carries.
 */
export { remotePlans as planSource } from './remote';
