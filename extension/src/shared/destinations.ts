/**
 * The places of the main page a user can open: its sections and every tool of tools/registry.ts, each with its route
 * hash. The sidebar lists the sections; the start page's field finds all of them by title and keywords, and its Tools
 * tiles show them. Data only — the icons are the pages' (app/destinationIcons.ts).
 */
import { TOOLS } from '@src/tools/registry';

export type DestinationKind = 'section' | 'tool';

export interface Destination {
  /** `compare`, `review`, `settings`, or `tools/<id>`. */
  id: string;
  kind: DestinationKind;
  title: string;
  summary: string;
  keywords: readonly string[];
  hash: string;
}

export const SECTION_DESTINATIONS: readonly Destination[] = [
  {
    id: 'compare',
    kind: 'section',
    title: 'Compare code',
    summary: 'Two texts or files side by side.',
    keywords: ['compare', 'diff', 'side by side', 'changes', 'text diff', 'files'],
    hash: '#/compare',
  },
  {
    id: 'tools',
    kind: 'section',
    title: 'Tools',
    summary: 'Offline developer tools.',
    keywords: ['tools', 'utilities', 'format', 'convert', 'decode'],
    hash: '#/tools',
  },
  {
    id: 'review',
    kind: 'section',
    title: 'Live review',
    summary: 'Uncommitted changes in your repositories.',
    keywords: ['review', 'live', 'git', 'changes', 'repository', 'companion'],
    hash: '#/review',
  },
  {
    id: 'history',
    kind: 'section',
    title: 'History',
    summary: 'What your tools kept in this browser.',
    keywords: ['history', 'recent', 'restore', 'export', 'backup', 'undo'],
    hash: '#/history',
  },
];

export const SETTINGS_DESTINATION: Destination = {
  id: 'settings',
  kind: 'section',
  title: 'Settings',
  summary: 'The start page, new tabs and the theme.',
  keywords: ['settings', 'options', 'preferences', 'start page', 'new tab', 'theme', 'shortcuts'],
  hash: '#/settings',
};

export const TOOL_DESTINATIONS: readonly Destination[] = TOOLS.map(tool => ({
  id: `tools/${tool.id}`,
  kind: 'tool',
  title: tool.title,
  summary: tool.summary,
  keywords: tool.keywords,
  hash: `#/tools/${tool.id}`,
}));

/** Everything the field can open. */
export const DESTINATIONS: readonly Destination[] = [
  ...SECTION_DESTINATIONS,
  ...TOOL_DESTINATIONS,
  SETTINGS_DESTINATION,
];

export const destinationByHash = (hash: string): Destination | undefined => DESTINATIONS.find(d => d.hash === hash);
