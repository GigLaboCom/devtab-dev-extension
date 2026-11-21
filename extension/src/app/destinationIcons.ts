/** The icon of each place of the page (shared/destinations.ts): the sidebar, the start page's field and tiles. */
import { BracesIcon, Columns2Icon, GitPullRequestIcon, HistoryIcon, SettingsIcon, WrenchIcon } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  compare: Columns2Icon,
  tools: WrenchIcon,
  review: GitPullRequestIcon,
  settings: SettingsIcon,
  history: HistoryIcon,
  'tools/json': BracesIcon,
};

export const iconOf = (destination: string): LucideIcon => ICONS[destination] ?? WrenchIcon;
