/**
 * Seam `Edition` — what differs between the free version and Pro (D21; docs/replaceable-behaviors.md). Every tool works
 * in full in both; Pro is the product's memory. An edition is the list of what that memory is made of: for each thing
 * the product remembers, the implementation this edition gets. Today the list has one line — what keeps the tools'
 * saved parameters (seam `ParameterStorage`, D23; docs/tools/settings-storage.md): the browser's storage, so a tool
 * opens with what the person chose last time (Pro), or nothing, so it opens with its defaults on every visit (free).
 * Whether a tool's page offers "Reset settings" follows from that storage (it says whether it keeps anything), not from
 * a question "is this Pro?" asked somewhere else. The tools never see any of it: they get settings from their host
 * either way (D14).
 *
 * The composition root (index.ts) picks one. There is no payment or licence check: the root names the variant, and
 * the free build is that one line changed (docs/defaults.md §2). The history (D17) is Pro too by D21, but it is not
 * behind this seam yet: every build records as before (the proposal: docs/tools/settings-storage.md §9).
 */
import type { BrowserStorage } from '../tools/settings';
import type { ParameterStorage } from '@workspace/tools-host';

export interface Edition {
  /** For reports and tests. */
  readonly id: 'free' | 'pro';
  /** Seam `ParameterStorage`: what keeps the tools' saved parameters in this edition, given the browser's storage. */
  parameters(browser: BrowserStorage): ParameterStorage;
}
