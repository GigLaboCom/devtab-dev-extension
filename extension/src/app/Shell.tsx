/**
 * Every route but the start page: the side navigation over the parts (each tool nested under Tools) with Settings at
 * its foot — the theme is chosen there, in Settings → Appearance —, a toolbar with the palette's button, and the
 * current part; the palette (⌘K / Ctrl+K) over all of it. A chunk of its own (App.tsx loads it lazily), with a
 * stylesheet of its own (shell.css), so a new tab's start page does not wait for the parts, Radix, the tools or their
 * rules. `Bare` is the current part alone, for an address that asks for no frame (`?bare`: the options page in
 * Chrome's dialog, where the sidebar's links would open the product inside the dialog).
 */
import './shell.css';
import { iconOf } from './destinationIcons';
import { HistoryPage } from './history/HistoryPage';
import { go, routeHash } from './route';
import { ComparePage } from './sections/ComparePage';
import { SettingsPage } from './sections/SettingsPage';
import { ToolsPage } from './sections/ToolsPage';
import { Palette } from './shell/Palette';
import { useOffer } from './shell/sectionKeys';
import { SidebarNav } from './shell/SidebarNav';
import { Toolbar } from './shell/Toolbar';
import { useFind } from './shell/useFind';
import { useShellSettings } from './shell/useShellSettings';
import { useShortcuts } from './shell/useShortcuts';
import { useHostEdition } from './useHostEdition';
import product from '../../product.json';
import { compareBehaviors } from '@src/compare/behaviors';
import { editorSettingsBehaviors } from '@src/editorSettings/behaviors';
import { DESTINATIONS, SECTION_DESTINATIONS, SETTINGS_DESTINATION } from '@src/shared/destinations';
import { shellBehaviors } from '@src/shell/behaviors';
import { trailOf } from '@src/shell/trail';
import { ask } from '@src/shortcuts/intent';
import { lazy, Suspense, use, useMemo, useRef } from 'react';
import type { Route } from './route';
import type { SettingsProps, ShellChoices } from './sections/SettingsPage';
import type { SectionKeys } from './shell/sectionKeys';
import type { Shortcuts } from './shell/useShortcuts';
import type { ThemePref } from '@extension/theme';
import type { HistoryHost } from '@src/history/behaviors';
import type { FrameKeys } from '@src/shared/keys';
import type { ReactElement } from 'react';

export interface ShellProps {
  route: Route;
  /** The tool history; the same promise on every call. */
  history: () => Promise<HistoryHost>;
  theme: { pref: ThemePref; onChange: (pref: ThemePref) => void };
  settings: Omit<SettingsProps, 'theme' | 'history'>;
}

// «Projects»: a chunk of its own, loaded when the section opens — the shell's chunk does not carry it.
const ProjectsSection = lazy(() => import('./sections/ProjectsPage'));

/** The command "New scratch file" (src/shortcuts/actions.ts). */
const NEW_SCRATCH = 'scratch:new';

const Shell = ({ route, history, theme, settings }: ShellProps): ReactElement => {
  const SettingsIcon = iconOf(SETTINGS_DESTINATION.id);
  const hash = routeHash(route);
  // The shell's composition root (src/shell/behaviors.ts): in this lazy chunk, so a new tab never loads it.
  const behaviors = useMemo(() => shellBehaviors(), []);
  const groups = useShellSettings(settings.store);
  const main = useRef<HTMLElement>(null);
  const findButton = useRef<HTMLButtonElement>(null);
  const find = useFind(main, findButton);
  const keyDeps = useMemo(
    () => ({ area: settings.store.area, onChanged: settings.store.onChanged, win: window }),
    [settings.store],
  );
  const shortcuts = useShortcuts(keyDeps, behaviors.shortcuts, { go, find: find.toggle });
  const findKey = shortcuts.bindings.get('find');
  const recent = settings.state.recent.used;
  const { commands, targets, bindings } = shortcuts;
  const context = useMemo(() => ({ recent, commands }), [recent, commands]);
  // What a section gets of the shortcuts: it offers its commands and shows their keys (app/shell/sectionKeys.ts).
  const sectionKeys = useMemo<SectionKeys>(
    () => ({ offer: targets.offer, keyOf: id => bindings.get(id), mac: find.mac }),
    [targets, bindings, find.mac],
  );
  return (
    <div className="kit-shell" data-breadcrumb={groups.settings.breadcrumb ? 'on' : undefined}>
      <aside className="kit-sidebar">
        <a className="kit-sidebar-brand" href={routeHash({ section: 'start' })} title="Start page">
          {product.name}
        </a>
        <SidebarNav
          hash={hash}
          sections={SECTION_DESTINATIONS}
          places={DESTINATIONS}
          settings={groups.settings}
          onGroup={groups.setGroup}
          keyOf={id => shortcuts.bindings.get(`open:${id}`)}
          mac={find.mac}
        />
        <div className="kit-sidebar-foot">
          <a
            className="kit-nav-item"
            href={SETTINGS_DESTINATION.hash}
            aria-current={route.section === 'settings' ? 'page' : undefined}>
            <SettingsIcon aria-hidden="true" />
            <span className="kit-nav-label">{SETTINGS_DESTINATION.title}</span>
          </a>
        </div>
      </aside>
      <div className="kit-shell-content">
        <Toolbar
          onFind={find.show}
          mac={find.mac}
          findRef={findButton}
          shortcut={findKey}
          trail={groups.settings.breadcrumb ? trailOf(hash, DESTINATIONS) : undefined}
        />
        <main ref={main} className="kit-main" tabIndex={-1}>
          <Part
            route={route}
            history={history}
            theme={theme}
            settings={settings}
            frameKeys={shortcuts.frameKeys}
            shortcuts={shortcuts}
            sectionKeys={sectionKeys}
            shell={{ breadcrumb: groups.settings.breadcrumb, setBreadcrumb: groups.setBreadcrumb }}
          />
        </main>
      </div>
      <Palette
        open={find.open}
        onOpenChange={find.setOpen}
        source={behaviors.palette}
        context={context}
        recogniser={behaviors.recogniser}
        go={go}
        onClosed={find.closed}
        keyOf={id => shortcuts.bindings.get(id)}
        mac={find.mac}
        onCommand={id => targets.run(id)}
      />
    </div>
  );
};

const Part = ({
  route,
  history,
  theme,
  settings,
  frameKeys,
  shortcuts,
  sectionKeys,
  shell,
}: ShellProps & {
  frameKeys?: FrameKeys;
  shortcuts?: Shortcuts;
  sectionKeys?: SectionKeys;
  shell?: ShellChoices;
}): ReactElement => {
  const host = use(history());
  // Whether the edition in force has scratch files (D34), followed while the page is open.
  const { scratches } = useHostEdition(host);
  // "New scratch file" from any section (D38): the Projects section opens its language popup — at once when it is
  // the section shown, on arrival otherwise; the intent goes in the page's memory, not in the address (F6).
  const onProjects = route.section === 'projects';
  useOffer(sectionKeys, {
    [NEW_SCRATCH]:
      scratches &&
      (() => {
        ask(NEW_SCRATCH);
        if (!onProjects) go(routeHash({ section: 'projects' }));
      }),
  });
  // «Compare code»'s composition root (compare/behaviors.ts): in this lazy chunk, so a new tab never loads it.
  const compare = useMemo(() => compareBehaviors(window), []);
  // The editor's settings (editorSettings/behaviors.ts, D39): one for the page, every editor and Settings → Editor.
  const editorSettings = useMemo(() => editorSettingsBehaviors(), []);
  return (
    <>
      {route.section === 'compare' && (
        <ComparePage behaviors={compare} frameKeys={frameKeys} editorSettings={editorSettings} keys={sectionKeys} />
      )}
      {route.section === 'tools' && <ToolsPage toolId={route.tool} history={host} />}
      {route.section === 'projects' && (
        <Suspense fallback={null}>
          <ProjectsSection
            route={route}
            frameKeys={frameKeys}
            scratches={scratches}
            keys={sectionKeys}
            editorSettings={editorSettings}
          />
        </Suspense>
      )}
      {route.section === 'settings' && (
        <SettingsPage
          {...settings}
          theme={theme}
          history={host}
          shortcuts={shortcuts}
          shell={shell}
          editorSettings={editorSettings}
        />
      )}
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
