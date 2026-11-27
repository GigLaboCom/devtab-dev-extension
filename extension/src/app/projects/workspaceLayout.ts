/**
 * The seam `WorkspaceLayout` (D35; AGENTS.md, "Replaceable Behavior"): how an open project's parts are arranged on the
 * page. The parts — the tree, the Commit window, the editor, the history, find in files — are the same whatever the
 * arrangement; the companion's specification (§8.4) names other arrangements of them (the Commit window as a column
 * of its own, or in the centre with the tree behind «Go to file»). The section's composition root
 * (src/projects/behaviors.ts) names the one in use and where it remembers its panels (`LayoutMemory`); the page
 * imports this interface only.
 */
import type { PanelView } from '@src/projects/layout';
import type { LayoutMemory } from '@src/projects/layoutMemory';
import type { ComponentType, ReactNode } from 'react';

export interface WorkspaceParts {
  files: ReactNode;
  commit: ReactNode;
  editor: ReactNode;
  history: ReactNode;
  find: ReactNode;
}

export interface WorkspaceLayoutProps {
  parts: WorkspaceParts;
  /** How many files have changes (the Commit view's count); null before the project's status is read. */
  changes: number | null;
  memory: LayoutMemory;
  /** A view asked for from outside the panels (a search started, a file's history asked for); a new `n` each time. */
  reveal: { view: PanelView; n: number } | null;
}

export type WorkspaceLayout = ComponentType<WorkspaceLayoutProps> & { readonly id: string };
