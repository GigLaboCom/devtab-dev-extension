/**
 * Seam `OptionsPage`: the shared contract, run against every implementation — the address is the main page's settings
 * route with the options flag (never a new tab's address), the manifest's `options_ui` follows the definition, and a page
 * shown in Chrome's dialog asks for no frame.
 */
import { optionsEmbedded } from './optionsEmbedded';
import { optionsInTab } from './optionsInTab';
import { optionsUiOf } from './optionsPage';
import { isBare, isNewTabLoad, parseRoute } from '@src/app/route';
import { APP_PAGE, OPTIONS_FLAG, hasFlag } from '@src/shared/pages';
import { describe, expect, it } from 'vitest';
import type { OptionsPage } from './optionsPage';

const IMPLEMENTATIONS: readonly OptionsPage[] = [optionsInTab, optionsEmbedded];

const parts = (page: string) => {
  const url = new URL(page, 'chrome-extension://test/');
  return { path: url.pathname.slice(1), search: url.search, hash: url.hash };
};

describe.each(IMPLEMENTATIONS.map(o => [o.id, o] as const))('OptionsPage %s', (_id, options) => {
  it('is the main page’s settings route, with the options flag (so Chrome never takes a new tab of ours for it)', () => {
    const { path, search, hash } = parts(options.page);
    expect(path).toBe(APP_PAGE);
    expect(parseRoute(hash)).toEqual({ section: 'settings' });
    expect(hasFlag(search, OPTIONS_FLAG)).toBe(true);
    expect(isNewTabLoad({ search, hash: '' })).toBe(false);
  });

  it('the manifest’s options_ui follows the definition', () => {
    expect(optionsUiOf(options)).toEqual({ page: options.page, open_in_tab: options.openInTab });
  });

  it('in Chrome’s dialog the settings come without the app’s frame; in a tab, with it', () => {
    expect(isBare(parts(options.page).search)).toBe(!options.openInTab);
  });
});
