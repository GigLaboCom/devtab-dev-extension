/**
 * The composition root of the edition (seam `Edition`, ./edition.ts; D21): the one place that says whether the build is
 * the free version or Pro — and so which implementation of seam `ParameterStorage` keeps the tools' saved parameters
 * (D23): each edition names its own (./pro.ts: the browser's storage; ./free.ts: none). The tools' host
 * (src/history/behaviors.ts) reads this choice and nothing else does. The other implementation is `free` — to switch,
 * export it here instead. There is no payment or licence check yet: Pro is selected so the feature can be seen (an
 * implementer's choice, docs/defaults.md §2). The e2e builds the free one without editing this file
 * (DEVTAB_VARIANT=edition:free, extension/vite.config.ts).
 */
export { pro as edition } from './pro';
