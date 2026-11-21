/**
 * The main page — also the browser's New Tab page when the build overrides it (src/newTab), and the options page. On the
 * start route it is the start page alone (the field and the tiles, sections/StartPage.tsx), in the first chunk; every
 * other route is the shell (the side navigation, the theme picker and the current part, Shell.tsx), loaded on first use
 * so a new tab never waits for it — or, when the address asks for it (`?bare`: the options page in Chrome's dialog), the
 * part without the shell. The frame is @workspace/dna/ui.css (`kit-*`); the start page's seams come from
 * src/start/behaviors.ts.
 */
import { addressLeavingOptions, isBare, isNewTabLoad, routeHash, useRoute } from './route';
import { StartPage } from './sections/StartPage';
import { useHeldPermissions, useLateNewTabChoice, useRecordVisit, useStartState } from './useStart';
import { useTheme } from './useTheme';
import product from '../../product.json';
import { isNewTabPage } from '@src/newTab/override';
import { optionalPermissionNames } from '@src/start/part';
import { catalogueEntry } from '@src/tools/catalogue';
import { lazy, Suspense, useLayoutEffect } from 'react';
import type { Route } from './route';
import type { PermissionsApi } from './useStart';
import type { ThemeDeps } from './useTheme';
import type { HistoryHost } from '@src/history/behaviors';
import type { StartBehaviors } from '@src/start/behaviors';
import type { StartStoreDeps } from '@src/start/store';
import type { ReactElement } from 'react';

const Shell = lazy(() => import('./Shell'));
const Bare = lazy(() => import('./Shell').then(m => ({ default: m.Bare })));

let memoryHistory: Promise<HistoryHost> | undefined;
/** The default when the page is given no history: one in memory, nothing kept (a test, a host without storage). */
const inMemoryHistory = (): Promise<HistoryHost> =>
  (memoryHistory ??= Promise.all([import('@src/history/behaviors'), import('@src/tools/registry')]).then(([m, r]) =>
    m.memoryHistoryHost(r.TOOLS),
  ));

export interface AppDeps {
  theme: ThemeDeps;
  start: StartStoreDeps;
  permissions: PermissionsApi;
  behaviors: StartBehaviors;
  /** The tool history (src/history/behaviors.ts), loaded with the shell; absent: an in-memory one. */
  history?: () => Promise<HistoryHost>;
}

/**
 * The tab's title: Chrome's own wording on a new tab (the start page at the address a new tab opens, where a new tab is
 * ours), the part's name elsewhere — the start page opened by its address included.
 */
export const titleOf = (route: Route, newTab: boolean): string => {
  if (route.section === 'start' && newTab) return 'New Tab';
  const part =
    route.section === 'tools'
      ? (catalogueEntry(route.tool)?.title ?? 'Tools')
      : {
          start: 'Start page',
          settings: 'Settings',
          compare: 'Compare code',
          review: 'Live review',
          history: 'History',
        }[route.section];
  return `${part} — ${product.name}`;
};

export const App = ({ deps }: { deps: AppDeps }): ReactElement => {
  const route = useRoute();
  const hash = routeHash(route);
  const [pref, setPref] = useTheme(deps.theme);
  const start = useStartState(deps.start);
  const held = useHeldPermissions(deps.permissions, optionalPermissionNames(deps.behaviors.parts));
  useLateNewTabChoice(deps.start, deps.behaviors, start);
  useRecordVisit(deps.start, hash, route);
  // Before the first paint, so a tab opened on a route never shows the static "New Tab" of index.html.
  useLayoutEffect(() => {
    document.title = titleOf(route, isNewTabPage(deps.behaviors.newTab) && isNewTabLoad(window.location));
    const left = addressLeavingOptions(window.location, route);
    if (left) window.history.replaceState(window.history.state, '', left);
  }, [route, deps.behaviors.newTab]);

  if (route.section === 'start')
    return (
      <StartPage
        state={start.state}
        held={held}
        parts={deps.behaviors.parts}
        code={deps.behaviors.code}
        keys={deps.start}
      />
    );
  const Frame = isBare(window.location.search) ? Bare : Shell;
  return (
    <Suspense fallback={null}>
      <Frame
        route={route}
        history={deps.history ?? inMemoryHistory}
        theme={{ pref, onChange: setPref }}
        settings={{
          state: start.state,
          held,
          parts: deps.behaviors.parts,
          store: deps.start,
          permissions: deps.permissions,
          newTab: deps.behaviors.newTab,
        }}
      />
    </Suspense>
  );
};
