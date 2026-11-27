/**
 * The trusted folders (§3.7, §8.4): read only — the page lists them and says the command; no button adds or removes
 * one (the API has no such method). A companion that does not list them yet is said so.
 */
import { TEXT, printable } from './text';
import type { TrustedLocation } from '@src/projects/types';
import type { ReactElement } from 'react';

export interface TrustedFoldersProps {
  locations: readonly TrustedLocation[];
  /** Whether the backend lists trusted folders at all. */
  offered?: boolean;
}

export const TrustedFolders = ({ locations, offered = true }: TrustedFoldersProps): ReactElement => (
  <section className="kit-projects-home-part" aria-labelledby="projects-folders-title">
    <h2 id="projects-folders-title" className="kit-projects-part-title">
      {TEXT.foldersTitle}
    </h2>
    <p className="kit-projects-part-hint">{TEXT.foldersHint}</p>
    {!offered ? (
      <p className="kit-projects-note" data-offered="no">
        {TEXT.foldersNotOffered}
      </p>
    ) : locations.length === 0 ? (
      <div className="kit-projects-empty">
        <p>{TEXT.noFolders}</p>
        <code className="kit-projects-command">{TEXT.noFoldersCommand}</code>
      </div>
    ) : (
      <ul className="kit-projects-list">
        {locations.map(location => (
          <li key={location.displayPath} className="kit-projects-folder">
            <span className="kit-projects-item-name">{printable(location.name)}</span>
            <span className="kit-projects-item-path">{printable(location.displayPath)}</span>
            <span className="kit-projects-item-meta">
              {[TEXT.folderProjects(location.projects), location.mode === 'read-only' ? TEXT.folderReadOnly : null]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </li>
        ))}
      </ul>
    )}
  </section>
);
