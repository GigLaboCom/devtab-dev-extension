/**
 * Seam `Edition` — what differs between the free version and Pro (D21; docs/replaceable-behaviors.md). Every tool works
 * in full in both; Pro is the product's memory. What this seam decides today: where the tools' chosen parameters are
 * kept (`ToolHost.settings`, docs/tools/settings.md) — in storage, so a tool opens with what the person chose last
 * time (Pro), or in the page's memory, so it opens with its defaults on every visit (free) — and whether a tool's page
 * offers "Reset settings". The tools never see it: they get settings from their host either way (D14).
 *
 * The composition root (index.ts) picks one. There is no payment or licence check: the root names the variant, and
 * the free build is that one line changed (docs/defaults.md §2). The history (D17) is Pro too by D21, but it is not
 * behind this seam yet: every build records as before.
 */
import type { ToolSettingsArea } from '@workspace/tools-host';

export interface Edition {
  /** For reports and tests. */
  readonly id: 'free' | 'pro';
  /**
   * Is this Pro? The one answer for the pieces that show or hide something by it — today the reset control of a tool's
   * page. What is kept where is not decided by it but by `parameters`.
   */
  readonly pro: boolean;
  /** Where the tools' saved parameters are kept, given the area that keeps the other per-tool settings. */
  parameters(settings: ToolSettingsArea): ToolSettingsArea;
}
