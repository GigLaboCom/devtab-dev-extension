/**
 * The origins of the site whose pages may talk to the extension: the manifest's `externally_connectable.matches`
 * ("https://web.example.invalid/*"), set at build time (extension/build/licenceOrigin.ts). The service worker checks
 * senders against it (src/background/licence/external.ts); Settings → Pro links to the first one's connect page.
 */
export const siteOrigins = (manifest: {
  readonly externally_connectable?: { readonly matches?: readonly string[] };
}): ReadonlySet<string> =>
  new Set(
    (manifest.externally_connectable?.matches ?? []).flatMap(pattern => {
      try {
        return [new URL(pattern.replace(/\*$/, '')).origin];
      } catch {
        return [];
      }
    }),
  );
