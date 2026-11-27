/**
 * The permissions the sections of the main page declare (the companion's specification §8.7): today one — the Projects
 * section's optional `nativeMessaging` (src/projects/permission.ts). The start page's parts declare theirs in their
 * definitions (src/start/part.ts); manifest.config.ts and scripts/permissions.mjs read both lists, so the manifest and
 * scripts/validate-build.sh never keep a list of their own.
 *
 * Read by the build only — never imported by the pages: the permission's name would otherwise land in a chunk outside
 * the Projects section (Check 12). Only relative imports of plain modules.
 */
import { PROJECTS_PERMISSION } from '../projects/permission';
import type { PartPermission } from '../start/part';

export interface SectionPermissions {
  /** The section's id (src/app/route.ts). */
  id: string;
  permissions: readonly PartPermission[];
}

export const sectionPermissions = (): readonly SectionPermissions[] => [
  { id: 'projects', permissions: [PROJECTS_PERMISSION] },
];

/** What the sections ask for, required and optional, each name once. */
export const declaredSectionPermissions = (
  sections: readonly SectionPermissions[] = sectionPermissions(),
): { required: string[]; optional: string[] } => {
  const all = sections.flatMap(s => s.permissions);
  const unique = (names: string[]): string[] => [...new Set(names)];
  return {
    required: unique(all.filter(p => !p.optional).map(p => p.name)),
    optional: unique(all.filter(p => p.optional).map(p => p.name)),
  };
};
