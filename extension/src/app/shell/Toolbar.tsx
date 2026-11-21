/**
 * The shell's toolbar, above every part it draws: one quiet row — the breadcrumb on the left (where the page is, from
 * the same places' tree the sidebar nests: `Tools / Base64`, a section alone by its name; switchable in Settings →
 * Appearance), the button that opens the palette on the right, with its shortcut. While the breadcrumb shows, it is the
 * page's visible title: the parts keep their headings for screen readers only (shell.css, `data-breadcrumb`), so the
 * name is not said twice on top of each other. The breadcrumb shortens with an ellipsis and never pushes the button out
 * or wraps the row. The row has gpui-kit's TitleBar look (a bottom border, no fill) at the height of its Toolbar.
 */
import { ariaKeys, keyLabel } from '@src/shared/keyLabels';
import { SearchIcon } from 'lucide-react';
import type { Destination } from '@src/shared/destinations';
import type { KeyChord } from '@src/shared/keys';
import type { ReactElement, Ref } from 'react';

export interface ToolbarProps {
  onFind: () => void;
  mac: boolean;
  /** The find button, where focus goes back when nothing else can take it. */
  findRef?: Ref<HTMLButtonElement>;
  /** The palette's shortcut now (the user may change or clear it in Settings → Shortcuts). */
  shortcut?: KeyChord;
  /** The way to the current place, top first; absent or empty: no breadcrumb. */
  trail?: readonly Destination[];
}

const Breadcrumb = ({ trail }: { trail: readonly Destination[] }): ReactElement => (
  <nav className="kit-breadcrumb" aria-label="Breadcrumb">
    <ol className="kit-breadcrumb-list">
      {trail.map((place, i) => (
        <li key={place.id} className="kit-breadcrumb-item">
          {i < trail.length - 1 ? (
            <a className="kit-breadcrumb-link" href={place.hash} title={place.title}>
              {place.title}
            </a>
          ) : (
            <span className="kit-breadcrumb-page" aria-current="page" title={place.title}>
              {place.title}
            </span>
          )}
        </li>
      ))}
    </ol>
  </nav>
);

export const Toolbar = ({ onFind, mac, findRef, shortcut, trail }: ToolbarProps): ReactElement => (
  <header className="kit-toolbar">
    {trail && trail.length > 0 && <Breadcrumb trail={trail} />}
    <button
      ref={findRef}
      type="button"
      className="kit-toolbar-find"
      aria-haspopup="dialog"
      aria-keyshortcuts={shortcut && ariaKeys(shortcut, mac)}
      onClick={onFind}>
      <SearchIcon aria-hidden="true" className="kit-toolbar-find-icon" />
      <span className="kit-toolbar-find-label">Find a tool or section…</span>
      {shortcut && (
        <kbd className="cn-kbd" aria-hidden="true">
          {keyLabel(shortcut, mac)}
        </kbd>
      )}
    </button>
  </header>
);
