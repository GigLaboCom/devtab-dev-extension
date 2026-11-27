/**
 * The site's pages may talk to the service worker (`externally_connectable`, manifest.config.ts): the connect page
 * asks for the installation's number and hands over an activation it made for the signed-in person
 * (`<site>/pro/connect/`). Chrome lets only the origins the manifest lists send such messages and tells their origin;
 * the worker reads the same list from its own manifest, so the build's one setting decides both, and checks the
 * sender's origin and the message's shape again.
 *
 * Messages: `{type: "devtab:hello"}` → `{inst}`; `{type: "devtab:licence", lid, token, secret}` → `{ok: true}` or
 * `{ok: false, reason}`. Anything else, or from anywhere else, is refused.
 */
import type { SiteActivation } from './worker';

export { siteOrigins } from '@src/shared/siteOrigins';

/** A page of a listed origin (not another extension, not a page elsewhere). */
export const siteSender = (sender: chrome.runtime.MessageSender, origins: ReadonlySet<string>): boolean =>
  sender.id === undefined && typeof sender.origin === 'string' && origins.has(sender.origin);

export type SiteMessage = { readonly type: 'devtab:hello' } | ({ readonly type: 'devtab:licence' } & SiteActivation);

const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;

export const isSiteMessage = (message: unknown): message is SiteMessage => {
  if (typeof message !== 'object' || message === null) return false;
  const fields = message as Record<string, unknown>;
  if (fields.type === 'devtab:hello') return true;
  return (
    fields.type === 'devtab:licence' && text(fields.lid, 64) && text(fields.token, 4096) && text(fields.secret, 128)
  );
};
