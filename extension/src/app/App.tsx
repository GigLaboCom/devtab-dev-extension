/**
 * The main page's shell: the three parts of the extension in a side navigation, the theme picker, and the current
 * part. The frame is @workspace/dna/ui.css (`kit-*`); each part is its own module under sections/, built from the
 * shadcn/ui components in src/components/ui; the tools come from tools/registry.ts.
 */
import { routeHash, useRoute } from './route';
import { ComparePage } from './sections/ComparePage';
import { LiveReviewPage } from './sections/LiveReviewPage';
import { ToolsPage } from './sections/ToolsPage';
import { ThemePicker } from './ThemePicker';
import { useTheme } from './useTheme';
import product from '../../product.json';
import { Columns2Icon, GitPullRequestIcon, WrenchIcon } from 'lucide-react';
import type { SectionId } from './route';
import type { ThemeDeps } from './useTheme';
import type { LucideIcon } from 'lucide-react';
import type { ReactElement } from 'react';

const SECTIONS: Array<{ id: SectionId; label: string; icon: LucideIcon }> = [
  { id: 'compare', label: 'Compare code', icon: Columns2Icon },
  { id: 'tools', label: 'Tools', icon: WrenchIcon },
  { id: 'review', label: 'Live review', icon: GitPullRequestIcon },
];

export const App = ({ theme }: { theme: ThemeDeps }): ReactElement => {
  const route = useRoute();
  const [pref, setPref] = useTheme(theme);

  return (
    <div className="kit-shell">
      <aside className="kit-sidebar">
        <div className="kit-sidebar-brand">{product.name}</div>
        <nav aria-label="Sections">
          <ul className="kit-nav">
            {SECTIONS.map(({ id, label, icon: SectionIcon }) => (
              <li key={id}>
                <a
                  className="kit-nav-item"
                  href={routeHash({ section: id })}
                  aria-current={route.section === id ? 'page' : undefined}>
                  <SectionIcon aria-hidden="true" />
                  <span>{label}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="kit-sidebar-foot">
          <ThemePicker pref={pref} onChange={setPref} />
        </div>
      </aside>
      <main className="kit-main">
        {route.section === 'compare' && <ComparePage />}
        {route.section === 'tools' && <ToolsPage toolId={route.tool} />}
        {route.section === 'review' && <LiveReviewPage />}
      </main>
    </div>
  );
};
