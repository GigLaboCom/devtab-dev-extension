/** Site icons: Chrome's icon of each site on the tiles instead of a letter (option, optional `favicon`). */
import type { OptionPart } from '../part';

export const siteIconsPart: OptionPart = {
  id: 'siteIcons',
  kind: 'option',
  title: 'Site icons',
  description: 'Icons of the sites on the tiles, from Chrome. Off: a letter.',
  defaultOn: false,
  permissions: [
    {
      name: 'favicon',
      optional: true,
      reason: "site icons on the tiles, from Chrome's icon cache (chrome-extension://<id>/_favicon/)",
      warning: 'Read the icons of the websites you visit',
    },
  ],
  prompt: 'Read the icons of the websites you visit',
  privacy: 'Site icons: the icons come from Chrome’s own icon cache on this device; nothing is fetched from the sites.',
  loadAt: 'start',
  provides: ['siteIcons'],
  load: () => import('./siteIcons.run'),
};
