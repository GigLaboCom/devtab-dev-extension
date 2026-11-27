/**
 * The site's messages to the service worker: whose origin the manifest lets in, which senders pass, which messages
 * have the shape they must.
 */
import { isSiteMessage, siteOrigins, siteSender } from './external';
import { describe, expect, it } from 'vitest';

describe('the site that may talk to the worker', () => {
  it('comes from the manifest, and nothing without the key', () => {
    const origins = siteOrigins({ externally_connectable: { matches: ['https://web.example.invalid/*'] } });
    expect([...origins]).toEqual(['https://web.example.invalid']);
    expect(siteOrigins({}).size).toBe(0);
    expect(siteOrigins({ externally_connectable: { matches: ['not a url'] } }).size).toBe(0);
  });

  it('is a page of that origin; another extension or another site is not', () => {
    const origins = new Set(['https://web.example.invalid']);
    const page = { origin: 'https://web.example.invalid', url: 'https://web.example.invalid/pro/connect/' };
    expect(siteSender(page, origins)).toBe(true);
    expect(siteSender({ ...page, origin: 'https://elsewhere.example.invalid' }, origins)).toBe(false);
    expect(siteSender({ ...page, id: 'abcdefghijklmnopabcdefghijklmnop' }, origins)).toBe(false);
    expect(siteSender({ url: page.url }, origins)).toBe(false);
  });

  it('sends hello, or an activation with its three fields', () => {
    expect(isSiteMessage({ type: 'devtab:hello' })).toBe(true);
    const licence = { type: 'devtab:licence', lid: 'lic_X', token: 'a.b.c', secret: 's'.repeat(43) };
    expect(isSiteMessage(licence)).toBe(true);
    for (const bad of [
      null,
      'devtab:hello',
      { type: 'licence/activate', key: 'DTD-…' },
      { ...licence, secret: undefined },
      { ...licence, token: 'x'.repeat(4097) },
      { ...licence, lid: '' },
    ]) {
      expect(isSiteMessage(bad)).toBe(false);
    }
  });
});
