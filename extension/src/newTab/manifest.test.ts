// @vitest-environment node
/**
 * The manifest and the chosen entry pages hold together: manifest.config.ts derives `chrome_url_overrides` from the
 * New Tab override (src/newTab/index.ts) and `options_ui` from the options page (src/options/index.ts).
 * scripts/validate-build.sh holds the built manifest to the same choices (scripts/entry-pages.mjs). Node, not jsdom: the
 * manifest's module loads the crxjs plugin.
 */
import { newTab } from '.';
import exported from '../../manifest.config';
import { optionsPage } from '../options';
import { describe, expect, it } from 'vitest';

const manifest = exported as chrome.runtime.ManifestV3;

describe('the manifest and the entry pages', () => {
  it('overrides the New Tab page exactly as the chosen override says', () => {
    expect(manifest.chrome_url_overrides ?? null).toEqual(newTab.newtab ? { newtab: newTab.newtab } : null);
  });

  it('names the chosen options page', () => {
    expect(manifest.options_ui).toEqual({ page: optionsPage.page, open_in_tab: optionsPage.openInTab });
  });
});
