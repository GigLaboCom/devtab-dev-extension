/**
 * Seam `SiteIcons` — what stands for a website on a tile (docs/replaceable-behaviors.md). By default a letter: it needs
 * no permission. Chrome's own icons come from the `_favicon` endpoint, which needs the `favicon` permission ("Read the
 * icons of the websites you visit"), so it is optional and requested when the user turns site icons on.
 */
export interface SiteIcons {
  /** An image address for the site, or null for the letter. */
  src(site: string): string | null;
}

export const letterIcons: SiteIcons = { src: () => null };

/** Chrome's favicon cache: `chrome-extension://<id>/_favicon/?pageUrl=…&size=32` (allowed by `img-src 'self'`). */
export const chromeFavicons = (getURL: (path: string) => string): SiteIcons => ({
  src: site => getURL(`/_favicon/?pageUrl=${encodeURIComponent(site)}&size=32`),
});

/** The letter a site gets: its title's first letter or digit, else its host's. */
export const letterOf = (title: string, site?: string): string => {
  const fromTitle = /[\p{L}\p{N}]/u.exec(title)?.[0];
  if (fromTitle) return fromTitle.toUpperCase();
  try {
    return (
      new URL(site ?? '').hostname
        .replace(/^www\./, '')
        .charAt(0)
        .toUpperCase() || '?'
    );
  } catch {
    return '?';
  }
};
