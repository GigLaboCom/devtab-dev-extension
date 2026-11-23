/**
 * The composition root of the edition (seam `Edition`, ./edition.ts; D21): the one place that says whether the build is
 * the free version or Pro — and so what stands behind each thing an edition decides: the storage of the tools' saved
 * parameters (seam `ParameterStorage`, D23), the tool history (D25) and automatic copying (D24); each edition names its
 * own (./pro.ts, ./free.ts). The tools' host (src/history/behaviors.ts) reads this choice and nothing else does. The
 * other implementation is `free` — to switch, export it here instead. There is no payment or licence check yet: Pro is
 * selected so the features can be seen (an implementer's choice, docs/defaults.md §2). The e2e builds the free one
 * without editing this file (DEVTAB_VARIANT=edition:free, extension/vite.config.ts).
 */
export { pro as edition } from './pro';
