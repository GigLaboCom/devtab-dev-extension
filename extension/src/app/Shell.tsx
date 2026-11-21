/**
 * Every route but the start page: the side navigation over the parts, the theme picker, and the current part. A chunk
 * of its own (App.tsx loads it lazily), so a new tab's start page does not wait for the parts, Radix or the tools.
 * `Bare` is the current part alone, for an address that asks for no frame (`?bare`: the options page in Chrome's
 * dialog, where the sidebar's links would open the product inside the dialog).
 */
import { iconOf } from './destinationIcons';
import { HistoryPage } from './history/HistoryPage';
import { routeHash } from './route';
import { ComparePage } from './sections/ComparePage';
import { LiveReviewPage } from './sections/LiveReviewPage';
import { SettingsPage } from './sections/SettingsPage';
import { ToolsPage } from './sections/ToolsPage';
import { ThemePicker } from './ThemePicker';
import product from '../../product.json';
import { compareBehaviors } from '@src/compare/behaviors';
import { SECTION_DESTINATIONS, SETTINGS_DESTINATION } from '@src/shared/destinations';
import { use, useMemo } from 'react';
import type { Route } from './route';
import type { SettingsProps } from './sections/SettingsPage';
import type { ThemePref } from '@extension/theme';
import type { HistoryHost } from '@src/history/behaviors';
import type { ReactElement } from 'react';

export interface ShellProps {
  route: Route;
  /** The tool history; the same promise on every call. */
  history: () => Promise<HistoryHost>;
  theme: { pref: ThemePref; onChange: (pref: ThemePref) => void };
  settings: Omit<SettingsProps, 'theme' | 'history'>;
}

const Shell = ({ route, history, theme, settings }: ShellProps): ReactElement => {
  const SettingsIcon = iconOf(SETTINGS_DESTINATION.id);
  return (
    <div className="kit-shell">
      <aside className="kit-sidebar">
        <a className="kit-sidebar-brand" href={routeHash({ section: 'start' })} title="Start page">
          {product.name}
        </a>
        <nav aria-label="Sections">
          <ul className="kit-nav">
            {SECTION_DESTINATIONS.map(({ id, title, hash }) => {
              const SectionIcon = iconOf(id);
              return (
                <li key={id}>
                  <a className="kit-nav-item" href={hash} aria-current={route.section === id ? 'page' : undefined}>
                    <SectionIcon aria-hidden="true" />
                    <span>{title}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="kit-sidebar-foot">
          <a
            className="kit-nav-item"
            href={SETTINGS_DESTINATION.hash}
            aria-current={route.section === 'settings' ? 'page' : undefined}>
            <SettingsIcon aria-hidden="true" />
            <span>{SETTINGS_DESTINATION.title}</span>
          </a>
          <ThemePicker pref={theme.pref} onChange={theme.onChange} />
        </div>
      </aside>
      <main className="kit-main">
        <Part route={route} history={history} theme={theme} settings={settings} />
      </main>
    </div>
  );
};

const Part = ({ route, history, theme, settings }: ShellProps): ReactElement => {
  const host = use(history());
  // «Compare code»'s composition root (compare/behaviors.ts): in this lazy chunk, so a new tab never loads it.
  const compare = useMemo(() => compareBehaviors(window), []);
  return (
    <>
      {route.section === 'compare' && <ComparePage behaviors={compare} />}
      {route.section === 'tools' && <ToolsPage toolId={route.tool} history={host} />}
      {route.section === 'review' && <LiveReviewPage />}
      {route.section === 'settings' && <SettingsPage {...settings} theme={theme} history={host} />}
      {route.section === 'history' && <HistoryPage host={host} />}
    </>
  );
};

export const Bare = (props: ShellProps): ReactElement => (
  <main className="kit-bare">
    <Part {...props} />
  </main>
);

export default Shell;
