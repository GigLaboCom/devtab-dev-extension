/**
 * The start page's seams (docs/replaceable-behaviors.md): one shared contract per seam, run against every
 * implementation, and each default's own behaviour. The parts and their tile sources — parts/parts.test.ts.
 */
import { NEW_TAB_PAGES } from './behaviors';
import { START_HASH } from './newTabPage';
import { chromeFavicons, letterIcons, letterOf } from './siteIcons';
import { chromeWebSearch } from './webSearch';
import { describe, expect, it, vi } from 'vitest';
import type { NewTabPage } from './newTabPage';
import type { Recent } from './settings';
import type { SiteIcons } from './siteIcons';

const recents: Recent[] = [
  { last: null, used: [] },
  { last: '#/tools/json', used: ['#/tools/json', '#/compare'] },
  { last: '#/review', used: ['#/review'] },
];

describe.each(Object.entries(NEW_TAB_PAGES))('NewTabPage contract: %s', (_name, page: NewTabPage) => {
  it.each(recents)('answers a route the page knows, synchronously (route-boot.js mirrors it): %j', recent => {
    const hash = page.initialHash(recent);
    expect(typeof hash).toBe('string');
    expect([START_HASH, '#/compare', '#/review', '#/tools', ...recent.used]).toContain(hash);
  });
  it('opens the start page when nothing was opened yet', () => {
    expect(page.initialHash({ last: null, used: [] })).toBe(START_HASH);
  });
});

describe('NewTabPage defaults', () => {
  it('the start page always; the last opened tool when there is one', () => {
    expect(NEW_TAB_PAGES.start.initialHash(recents[1])).toBe(START_HASH);
    expect(NEW_TAB_PAGES.last.initialHash(recents[1])).toBe('#/tools/json');
  });
});

describe.each<[string, SiteIcons]>([
  ['letters', letterIcons],
  ['favicons', chromeFavicons(path => `chrome-extension://id${path}`)],
])('SiteIcons contract: %s', (_name, icons) => {
  it('gives an image of the extension’s own origin or null, never a network address', () => {
    const src = icons.src('https://example.com/a');
    expect(src === null || src.startsWith('chrome-extension://id/')).toBe(true);
  });
});

describe('SiteIcons defaults', () => {
  it('Chrome’s favicon endpoint for the page; a letter otherwise', () => {
    expect(chromeFavicons(path => `chrome-extension://id${path}`).src('https://example.com/a')).toBe(
      'chrome-extension://id/_favicon/?pageUrl=https%3A%2F%2Fexample.com%2Fa&size=32',
    );
    expect(letterIcons.src('https://example.com/')).toBe(null);
    expect(letterOf('docs')).toBe('D');
    expect(letterOf('  — ', 'https://www.example.com/')).toBe('E');
  });
});

describe('WebSearch default', () => {
  it('hands the text to chrome.search.query, in the current tab', async () => {
    const query = vi.fn(() => Promise.resolve());
    await chromeWebSearch({ query }).search('kittens 42');
    expect(query).toHaveBeenCalledWith({ text: 'kittens 42', disposition: 'CURRENT_TAB' });
  });
});
