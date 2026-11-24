/** Who may ask the worker: our main page only, wherever it is shown. */
import { trustedSender } from './sender';
import { describe, expect, it } from 'vitest';

const runtime = { id: 'ours', getURL: (path: string) => `chrome-extension://ours/${path}` };

describe('trustedSender', () => {
  it.each([
    'chrome-extension://ours/src/app/index.html',
    'chrome-extension://ours/src/app/index.html#/settings',
    'chrome-extension://ours/src/app/index.html?options#/settings',
    'chrome-extension://ours/src/app/index.html?bare#/settings',
  ])('our main page at %s', url => {
    expect(trustedSender({ id: 'ours', url }, runtime)).toBe(true);
  });

  it.each([
    ['the editor page', { id: 'ours', url: 'chrome-extension://ours/src/viewer/index.html' }],
    ['the toolbar menu', { id: 'ours', url: 'chrome-extension://ours/src/popup/index.html' }],
    ['another extension', { id: 'theirs', url: 'chrome-extension://ours/src/app/index.html' }],
    ['a website', { id: 'ours', url: 'https://example.com/src/app/index.html' }],
    ['a look-alike path', { id: 'ours', url: 'chrome-extension://ours/src/app/index.html.evil' }],
    ['no address', { id: 'ours' }],
    ['no sender id', { url: 'chrome-extension://ours/src/app/index.html' }],
  ])('not %s', (_what, sender) => {
    expect(trustedSender(sender as chrome.runtime.MessageSender, runtime)).toBe(false);
  });
});
