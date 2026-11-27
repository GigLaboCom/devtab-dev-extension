/**
 * The list of projects (§8.4, §3.7а): grouped by the name of the trusted folder each lies in, in the folders' order;
 * the projects outside every trusted folder in a group of their own. Projects never appear by themselves (Р33): the
 * list is what was added; an empty one says how to add one.
 */
import { TEXT, printable } from './text';
import { routeHash } from '../route';
import type { ProjectSummary, TrustedLocation } from '@src/projects/types';
import type { ReactElement } from 'react';

export interface ProjectGroup {
  /** The folder's name, or null for the projects outside every folder. */
  name: string | null;
  displayPath: string | null;
  projects: ProjectSummary[];
}

/**
 * Projects under their folders' names, in the folders' order; the ones outside last. Without a list of folders (a
 * companion that does not list them yet), each project's own `locationName` names its group.
 */
export const groupProjects = (
  projects: readonly ProjectSummary[],
  locations: readonly TrustedLocation[],
): ProjectGroup[] => {
  const groups: ProjectGroup[] = locations.map(l => ({ name: l.name, displayPath: l.displayPath, projects: [] }));
  const outside: ProjectGroup = { name: null, displayPath: null, projects: [] };
  for (const project of projects) {
    let group = groups.find(g => g.displayPath !== null && g.displayPath === project.location);
    if (!group && project.location && locations.length === 0) {
      group = { name: project.locationName ?? project.location, displayPath: project.location, projects: [] };
      groups.push(group);
    }
    (group ?? outside).projects.push(project);
  }
  for (const group of [...groups, outside]) group.projects.sort((a, b) => a.name.localeCompare(b.name));
  return [...groups, outside].filter(g => g.projects.length > 0);
};

export interface ProjectListProps {
  projects: readonly ProjectSummary[];
  locations: readonly TrustedLocation[];
  current?: string;
}

export const ProjectList = ({ projects, locations, current }: ProjectListProps): ReactElement => {
  const groups = groupProjects(projects, locations);
  return (
    <section className="kit-projects-home-part" aria-labelledby="projects-list-title">
      <h2 id="projects-list-title" className="kit-projects-part-title">
        {TEXT.projectsTitle}
      </h2>
      {groups.length === 0 ? (
        <div className="kit-projects-empty">
          <p>{TEXT.noProjects}</p>
          <code className="kit-projects-command">{TEXT.noProjectsCommand}</code>
        </div>
      ) : (
        groups.map(group => (
          <div
            key={group.name ?? ''}
            className="kit-projects-group"
            role="group"
            aria-label={group.name === null ? TEXT.outsideFolders : printable(group.name)}>
            <h3 className="kit-projects-group-title">
              {group.name === null ? TEXT.outsideFolders : printable(group.name)}
              {group.displayPath && <span className="kit-projects-group-path">{printable(group.displayPath)}</span>}
            </h3>
            <ul className="kit-projects-list">
              {group.projects.map(project => (
                <li key={project.id}>
                  <a
                    className="kit-projects-item"
                    href={routeHash({ section: 'projects', project: project.id })}
                    aria-current={project.id === current ? 'page' : undefined}
                    data-state={project.state}>
                    <span className="kit-projects-item-name">{printable(project.name)}</span>
                    <span className="kit-projects-item-path">{printable(project.displayPath)}</span>
                    <span className="kit-projects-item-meta">
                      {project.state === 'missing'
                        ? TEXT.projectMissing
                        : [
                            project.branch == null ? null : printable(project.branch),
                            project.class === 'mine' ? TEXT.classMine : TEXT.classView,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
};
