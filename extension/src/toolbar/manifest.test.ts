// @vitest-environment node
/**
 * The manifest and the chosen toolbar button hold together: manifest.config.ts derives `action.default_popup` from the
 * definition in index.ts. scripts/validate-build.sh holds the built manifest and the shipped pages to the same choice
 * (scripts/toolbar-button.mjs). Node, not jsdom: the manifest's module loads the crxjs plugin.
 */
import { toolbarButton } from '.';
import exported from '../../manifest.config';
import { describe, expect, it } from 'vitest';

const manifest = exported as chrome.runtime.ManifestV3;

describe('the manifest and the toolbar button', () => {
  it('names the chosen button’s popup page, or none', () => {
    expect(manifest.action?.default_popup).toBe(toolbarButton.popup);
  });

  it('keeps the button’s title and icons whichever is chosen', () => {
    expect(manifest.action?.default_title).toBe(manifest.name);
    expect(Object.keys(manifest.action?.default_icon ?? {})).toEqual(['16', '32']);
  });
});
