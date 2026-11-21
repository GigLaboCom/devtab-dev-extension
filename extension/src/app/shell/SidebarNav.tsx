/**
 * The sidebar's sections, each place nested under the place it stands under (shared/destinations.ts `parent`: every
 * tool under Tools) — built from the definitions, so a new tool shows up here with no edit. A section with places under
 * it is a link (it still opens the section) and a disclosure button beside it (gpui-kit's submenu caret: a chevron
 * turned down when open). The group:
 *
 * - remembers the user's choice (src/shell/settings.ts, chrome.storage.local);
 * - opens by itself when the page shows one of its places (a tool's route), without changing that choice — closing it
 *   there is the user's choice again;
 * - marks the current place (`aria-current="page"`); the section above it is marked as on the way (`data-trail`).
 *
 * With 34 tools the list is longer than a window: the sections scroll inside the navigation, the brand above and the
 * foot below (Settings, the theme) stay in place, and the current place is scrolled into view inside the list when the
 * route changes — as IDE tool windows, documentation sites and browser devtools keep a long tree. A long title ends in
 * an ellipsis; the whole of it is the link's tooltip, with the key that opens the place, if it has one.
 */
import { revealIn } from '../finder/reveal';
import { iconOf } from '@src/app/destinationIcons';
import { ariaKeys, keyLabel } from '@src/shared/keyLabels';
import { currentOf } from '@src/shell/trail';
import { ChevronRightIcon } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import type { Destination } from '@src/shared/destinations';
import type { KeyChord } from '@src/shared/keys';
import type { ShellSettings } from '@src/shell/settings';
import type { ReactElement } from 'react';

export interface SidebarNavProps {
  /** The current route's hash (`#/tools/json`). */
  hash: string;
  /** The top-level places, in order (the sections). */
  sections: readonly Destination[];
  /** Every place: the ones under a section are found here by `parent`. */
  places: readonly Destination[];
  settings: ShellSettings;
  onGroup: (id: string, open: boolean) => void;
  /** The key that opens a place now (by its id), shown in the link's tooltip. */
  keyOf?: (id: string) => KeyChord | undefined;
  mac?: boolean;
}

/** The link's tooltip: the whole title, and the key that opens it (`aria-keyshortcuts` says it to a screen reader). */
const hintOf = (title: string, chord: KeyChord | undefined, mac: boolean) =>
  chord ? { title: `${title} (${keyLabel(chord, mac)})`, 'aria-keyshortcuts': ariaKeys(chord, mac) } : { title };

export const SidebarNav = ({
  hash,
  sections,
  places,
  settings,
  onGroup,
  keyOf = () => undefined,
  mac = false,
}: SidebarNavProps): ReactElement => {
  const nav = useRef<HTMLElement>(null);
  const current = currentOf(hash, places);
  // The route a group opened by itself for; a new route reveals again, the user's toggle forgets it.
  const [route, setRoute] = useState(hash);
  const [revealed, setRevealed] = useState<string | null>(hash);
  if (route !== hash) {
    setRoute(hash);
    setRevealed(hash);
  }

  useLayoutEffect(() => {
    const box = nav.current;
    const row = box?.querySelector<HTMLElement>('[aria-current="page"]');
    if (box && row) revealIn(box, row);
  }, [hash]);

  return (
    <nav ref={nav} className="kit-sidebar-nav" aria-label="Sections">
      <ul className="kit-nav">
        {sections.map(section => {
          const Icon = iconOf(section.id);
          const children = places.filter(d => d.parent === section.id);
          const link = (
            <a
              className="kit-nav-item"
              href={section.hash}
              aria-current={current?.id === section.id ? 'page' : undefined}
              data-trail={current?.parent === section.id ? '' : undefined}
              {...hintOf(section.title, keyOf(section.id), mac)}>
              <Icon aria-hidden="true" />
              <span className="kit-nav-label">{section.title}</span>
            </a>
          );
          if (!children.length) return <li key={section.id}>{link}</li>;
          const holdsCurrent = children.some(c => c.id === current?.id);
          const open = settings.open[section.id] === true || (holdsCurrent && revealed === hash);
          const listId = `nav-${section.id}-places`;
          return (
            <li key={section.id} className="kit-nav-group">
              <div className="kit-nav-row">
                {link}
                <button
                  type="button"
                  className="kit-nav-toggle"
                  aria-expanded={open}
                  aria-controls={listId}
                  aria-label={`${section.title} list`}
                  title={
                    open
                      ? `Hide the ${section.title.toLowerCase()} list`
                      : `Show the ${section.title.toLowerCase()} list`
                  }
                  onClick={() => {
                    setRevealed(null);
                    onGroup(section.id, !open);
                  }}>
                  <ChevronRightIcon aria-hidden="true" />
                </button>
              </div>
              <ul id={listId} className="kit-nav-sub" aria-label={section.title} hidden={!open}>
                {children.map(child => (
                  <li key={child.id}>
                    <a
                      className="kit-nav-sub-item"
                      href={child.hash}
                      {...hintOf(child.title, keyOf(child.id), mac)}
                      aria-current={current?.id === child.id ? 'page' : undefined}>
                      <span className="kit-nav-label">{child.title}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};
