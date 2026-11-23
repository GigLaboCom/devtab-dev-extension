/**
 * The composition root of the edition: the one place that says which edition is in force — seam `EditionSource`
 * (./source.ts). Today a fixed source: Pro, chosen at build time (./fixedPro.ts); the other is the free version
 * (./fixedFree.ts) — to switch, export it here instead. The host (src/history/behaviors.ts) turns the source's state
 * into an `Edition` (./inForce.ts) — what stands behind the tools' saved parameters (seam `ParameterStorage`, D23), the
 * tool history (D25) and automatic copying (D24), each edition naming its own (./pro.ts, ./free.ts) — and follows it.
 * There is no payment or licence check yet: Pro is selected so the features can be seen (an implementer's choice,
 * docs/defaults.md §2). The e2e builds the free one without editing this file (DEVTAB_VARIANT=edition:fixedFree,
 * extension/vite.config.ts).
 */
export { fixedPro as editionSource } from './fixedPro';
