/**
 * The composition root of the edition (seam `Edition`, ./edition.ts; D21): the one place that says whether the build is
 * the free version or Pro. The tools' host (src/history/behaviors.ts: where the tools' parameters are kept) and the
 * tool's page (src/app/sections/ToolsPage.tsx: "Reset settings") read this choice. The other implementation is `free`
 * (./free.ts) — to switch, export it here instead. There is no payment or licence check yet: Pro is selected so the
 * feature can be seen (an implementer's choice, docs/defaults.md §2). The e2e builds the free one without editing this
 * file (DEVTAB_VARIANT=edition:free, extension/vite.config.ts).
 */
export { pro as edition } from './pro';
