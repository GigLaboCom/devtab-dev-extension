/**
 * Seam `NewTabOverride`: the shared contract, run against every implementation — what the manifest and the settings
 * derive from a definition is right for it, and its start entry reaches our start page: a new tab exactly when the
 * build is the New Tab page, otherwise the page by its address.
 */
import { browserNewTab } from './browserNewTab';
import { isNewTabPage, overridesOf } from './override';
import { ownNewTab } from './ownNewTab';
import { parseRoute } from '@src/app/route';
import { APP_PAGE } from '@src/shared/pages';
import { fakeTabs } from '@src/test/fakes';
import { reuseTab } from '@src/toolbar/reuseTab';
import { openTarget } from '@src/toolbar/target';
import { describe, expect, it } from 'vitest';
import type { NewTabOverride } from './override';

const IMPLEMENTATIONS: readonly NewTabOverride[] = [ownNewTab, browserNewTab];
const FROM = { id: 10, windowId: 1, index: 2, incognito: false };

describe.each(IMPLEMENTATIONS.map(o => [o.id, o] as const))('NewTabOverride %s', (_id, override) => {
  it('the manifest’s chrome_url_overrides: the main page exactly when the build is the New Tab page', () => {
    const overrides = overridesOf(override);
    expect('chrome_url_overrides' in overrides).toBe(isNewTabPage(override));
    if (isNewTabPage(override)) expect(overrides.chrome_url_overrides).toEqual({ newtab: APP_PAGE });
  });

  it('the start entry: a one-line title and an id; a new tab only when a new tab is ours', () => {
    expect(override.start.title).toMatch(/^\S.{0,30}$/);
    expect(override.start.id).toMatch(/^[a-z][A-Za-z]*$/);
    expect(!!override.start.opens.newTab).toBe(isNewTabPage(override));
    if (override.start.opens.route) expect(parseRoute(override.start.opens.route)).toEqual({ section: 'start' });
  });

  it('the start entry reaches our start page from a regular window', async () => {
    const api = { ...fakeTabs(), opener: reuseTab };
    await openTarget(override.start.opens, api, FROM);
    const [props] = api.tabs.create.mock.calls[0]!;
    expect(props).toMatchObject({ windowId: 1, index: 3 });
    // A new tab is the main page because the manifest says so; otherwise the address names the start route.
    expect(props.url).toBe(isNewTabPage(override) ? undefined : `chrome-extension://test/${APP_PAGE}#/start`);
  });

  it('loads where there is no chrome (the manifest and the build check read it outside the app)', () => {
    expect(typeof (globalThis as { chrome?: unknown }).chrome).toBe('undefined');
  });
});
