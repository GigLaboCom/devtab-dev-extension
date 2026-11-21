/**
 * A row of tiles under the start page's field: a title and what its TileSource gives. A source that already has its
 * tiles is drawn in the first frame; one that waits (Chrome's most visited) holds the row's place until it answers.
 * Tiles are compact cards of the style package — an icon and a title — and lead where they say: a website in this tab,
 * or one of our places.
 */
import { iconOf } from '@src/app/destinationIcons';
import { letterOf } from '@src/start/siteIcons';
import { PencilIcon } from 'lucide-react';
import { Suspense, use, useMemo, useState } from 'react';
import type { StartState } from '@src/start/settings';
import type { SiteIcons } from '@src/start/siteIcons';
import type { Tile, TileSource } from '@src/start/tileSources';
import type { ReactElement, ReactNode } from 'react';

const TileIcon = ({ tile, icons }: { tile: Tile; icons: SiteIcons }): ReactElement => {
  const [failed, setFailed] = useState(false);
  if (tile.destination) {
    const Icon = iconOf(tile.destination);
    return (
      <span className="kit-tile-icon" aria-hidden="true">
        <Icon />
      </span>
    );
  }
  // Site icons are on and on their way: the place stays empty rather than showing a letter that turns into an icon.
  if (icons.waiting) return <span className="kit-tile-icon" aria-hidden="true" />;
  const src = tile.site && !failed ? icons.src(tile.site) : null;
  return (
    <span className="kit-tile-icon" aria-hidden="true">
      {src ? <img src={src} alt="" onError={() => setFailed(true)} /> : letterOf(tile.title, tile.site)}
    </span>
  );
};

export interface TileListProps {
  tiles: readonly Tile[];
  icons: SiteIcons;
  /** An edit button on each tile (the user's shortcuts). */
  onEdit?: (tile: Tile) => void;
  /** What follows the tiles in the grid (the "Add shortcut" tile). */
  extra?: ReactNode;
  empty?: string;
}

export const TileList = ({ tiles, icons, onEdit, extra, empty }: TileListProps): ReactElement => {
  if (!tiles.length && !extra) return <p className="kit-tile-row-note">{empty}</p>;
  return (
    <ul className="kit-tiles">
      {tiles.map(tile => (
        <li key={tile.id} className="kit-tile-item">
          <a className="kit-tile" href={tile.href} title={tile.site ?? tile.title}>
            <TileIcon tile={tile} icons={icons} />
            <span className="kit-tile-title">{tile.title}</span>
          </a>
          {onEdit && (
            <button
              type="button"
              className="kit-tile-edit"
              aria-label={`Edit ${tile.title}`}
              onClick={() => onEdit(tile)}>
              <PencilIcon aria-hidden="true" />
            </button>
          )}
        </li>
      ))}
      {extra}
    </ul>
  );
};

const Loaded = ({ promise, ...props }: Omit<TileListProps, 'tiles'> & { promise: Promise<readonly Tile[]> }) => (
  <TileList tiles={use(promise)} {...props} />
);

/** A source's promise that never rejects: a row that cannot load is an empty row, not a broken page. */
const safely = (promise: Promise<readonly Tile[]>): Promise<readonly Tile[]> =>
  'status' in promise ? promise : promise.catch(() => []);

export interface TileRowProps extends Omit<TileListProps, 'tiles'> {
  id: string;
  title: string;
  source: TileSource;
  state: StartState;
  children?: ReactNode;
}

export const TileRow = ({ id, title, source, state, children, ...list }: TileRowProps): ReactElement => {
  const promise = useMemo(() => safely(source.tiles(state)), [source, state]);
  return (
    <section className="kit-tile-row" aria-labelledby={`start-row-${id}`} data-row={id}>
      <h2 id={`start-row-${id}`} className="kit-tile-row-title">
        {title}
      </h2>
      <Suspense fallback={<div className="kit-tiles-waiting" aria-busy="true" />}>
        <Loaded promise={promise} {...list} />
      </Suspense>
      {children}
    </section>
  );
};
