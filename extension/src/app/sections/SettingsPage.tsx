/**
 * Settings — also the extension's options page (the manifest's `options_ui` opens `?options#/settings`, in a tab or in
 * Chrome's dialog without the app's frame: src/options). It needs nothing of the frame around it.
 *
 *   General     what a new tab opens: the start page, or the last opened tool or section (NewTabPage) — only when the
 *               build is the New Tab page (src/newTab); otherwise a new tab is not ours and there is nothing to choose
 *   Start page  generated from the parts (seam `StartPart`, src/start/part.ts): the rows in the user's order, each with
 *               its switch, its description, the warning of each permission it asks for (as Chrome words it) and
 *               buttons to move it; a reset of the order; then the options, which have no place to move. A part with an
 *               optional permission asks Chrome for it straight from the click (Chrome refuses a request without one);
 *               switching it off gives back what no other switched-on part needs. This page names no part.
 *   Appearance  the theme (the only place it is chosen; not set = System, which follows the system live)
 *   Shortcuts   the user's keyboard shortcuts for every action (ShortcutSettings.tsx)
 *   Tools       "Copy automatically after generating" (app/tools/ToolSettings.tsx) — only in a build that has automatic
 *               copying (`history.automaticCopying`, the edition's, D24); elsewhere the group is not drawn: it would be
 *               empty
 *   History     the tool history (D17): its own block, app/history/HistorySettings.tsx (one sentence in a build without
 *               the history, D25)
 *   Your data   what is stored and what is not; each part that reads the browser adds its own line
 *
 * Everything here is a setting, kept in chrome.storage.local; nothing the user types into the start page is. What the
 * tools keep is the tool history, in this browser's IndexedDB (D17) — in a build that has it.
 */
import { ShortcutSettings } from './ShortcutSettings';
import { HistorySettings } from '../history/HistorySettings';
import { ThemePicker } from '../ThemePicker';
import { ToolSettings } from '../tools/ToolSettings';
import { createDebug } from '@extension/logger';
import { compareActions } from '@src/compare/actions';
import { isNewTabPage } from '@src/newTab/override';
import { isMac } from '@src/shared/keys';
import { moveRow, partState, permissionsToRelease, permissionsToRequest, rowsInOrder } from '@src/start/part';
import { saveSettings } from '@src/start/store';
import { Button } from '@workspace/ui/button';
import { Label } from '@workspace/ui/label';
import { Switch } from '@workspace/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/toggle-group';
import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react';
import { useState } from 'react';
import type { Shortcuts } from '../shell/useShortcuts';
import type { PermissionsApi } from '../useStart';
import type { ThemePref } from '@extension/theme';
import type { HistoryHost } from '@src/history/behaviors';
import type { NewTabOverride } from '@src/newTab/override';
import type { StartPart } from '@src/start/part';
import type { NewTabChoice, StartSettings, StartState } from '@src/start/settings';
import type { StartStoreDeps } from '@src/start/store';
import type { ReactElement } from 'react';

const debug = createDebug('extension:settings');

export interface SettingsProps {
  state: StartState;
  /** The optional permissions Chrome holds now. */
  held: ReadonlySet<string>;
  parts: readonly StartPart[];
  store: StartStoreDeps;
  permissions: PermissionsApi;
  theme: { pref: ThemePref; onChange: (pref: ThemePref) => void };
  /** The build's New Tab override: whether a new tab is ours, so "A new tab opens" means something. */
  newTab: NewTabOverride;
  history: HistoryHost;
  /** The user's shortcuts (the shell's); absent where the page is drawn without them. */
  shortcuts?: Shortcuts;
  /** The shell's own choices (the breadcrumb); absent where the page is drawn without the shell. */
  shell?: ShellChoices;
}

export interface ShellChoices {
  breadcrumb: boolean;
  setBreadcrumb: (on: boolean) => void;
}

/** The pages' own shortcuts a user's shortcut may not take: «Compare code»'s actions (compare/actions.ts). */
const FIXED = compareActions.flatMap(a =>
  a.shortcut ? [{ chord: a.shortcut, title: `Compare code: ${a.title}` }] : [],
);

const NEW_TAB: Array<{ value: NewTabChoice; label: string }> = [
  { value: 'start', label: 'Start page' },
  { value: 'last', label: 'Last opened tool' },
];

type Asking = { part: string; status: 'waiting' | 'refused' } | null;

const NOTES = {
  waiting: 'Waiting for your answer in Chrome’s prompt…',
  refused: 'Chrome did not allow it, so this stays off.',
  removed: 'Chrome’s permission was removed, so this is off. Turn it on to ask again.',
};

export const SettingsPage = ({
  state,
  held,
  parts,
  store,
  permissions,
  theme,
  newTab,
  history,
  shortcuts,
  shell,
}: SettingsProps): ReactElement => {
  const [asking, setAsking] = useState<Asking>(null);
  const settings = state.settings;
  const save = (next: StartSettings): void => {
    saveSettings(store.area, next).catch(e => debug.warn('save the settings', e));
  };
  const setPart = (id: string, value: boolean): void =>
    save({ ...settings, parts: { ...settings.parts, [id]: value } });

  const toggle = (part: StartPart, value: boolean): void => {
    if (!value) {
      // What no other switched-on part needs goes back to Chrome.
      const release = permissionsToRelease(parts, settings, part.id);
      setAsking(null);
      setPart(part.id, false);
      if (release.length)
        permissions.remove({ permissions: release }).catch(e => debug.warn('remove the permissions', e));
      return;
    }
    const request = permissionsToRequest(part);
    if (!request.length) {
      setPart(part.id, true);
      return;
    }
    // Straight from the click: Chrome shows its prompt only for a request made during a user gesture.
    setAsking({ part: part.id, status: 'waiting' });
    permissions.request({ permissions: request }).then(
      allowed => {
        setAsking(allowed ? null : { part: part.id, status: 'refused' });
        if (allowed) setPart(part.id, true);
      },
      e => {
        setAsking({ part: part.id, status: 'refused' });
        debug.warn('request the permissions', e);
      },
    );
  };

  const rows = rowsInOrder(parts, settings);
  const options = parts.filter(p => p.kind === 'option');

  const partRow = (part: StartPart, position?: { index: number; count: number }): ReactElement => {
    const id = `settings-part-${part.id}`;
    const pstate = partState(part, settings, held);
    const note = asking?.part === part.id ? asking.status : pstate === 'blocked' ? 'removed' : null;
    return (
      <div key={part.id} className="kit-settings-row" data-part={part.id}>
        <div className="kit-settings-text">
          <Label htmlFor={id} className="kit-settings-label">
            {part.title}
          </Label>
          <span id={`${id}-hint`} className="kit-settings-hint">
            {part.description}
            {part.prompt && ` Chrome asks you to allow “${part.prompt}”.`}
          </span>
          {note && (
            <span className="kit-settings-note" role="status">
              {NOTES[note]}
            </span>
          )}
        </div>
        <div className="kit-settings-controls">
          {position && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Move ${part.title} up`}
                disabled={position.index === 0}
                onClick={() => save({ ...settings, order: moveRow(parts, settings, part.id, -1) })}>
                <ArrowUpIcon aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Move ${part.title} down`}
                disabled={position.index === position.count - 1}
                onClick={() => save({ ...settings, order: moveRow(parts, settings, part.id, 1) })}>
                <ArrowDownIcon aria-hidden="true" />
              </Button>
            </>
          )}
          <Switch
            id={id}
            aria-describedby={`${id}-hint`}
            checked={pstate === 'on'}
            disabled={note === 'waiting'}
            onCheckedChange={value => toggle(part, value)}
          />
        </div>
      </div>
    );
  };

  const privacy = parts.flatMap(p => (p.privacy ? [p.privacy] : []));

  return (
    <section className="kit-section" aria-labelledby="settings-title">
      <header className="kit-section-head">
        <div>
          <h1 id="settings-title" className="kit-section-title">
            Settings
          </h1>
          <p className="kit-section-hint">
            Kept in this browser. What you type into the start page’s field is never stored.
          </p>
        </div>
      </header>
      <div className="kit-settings">
        {isNewTabPage(newTab) && (
          <section className="kit-settings-group" aria-labelledby="settings-general">
            <h2 id="settings-general" className="kit-settings-group-title">
              General
            </h2>
            <div className="kit-settings-row">
              <div className="kit-settings-text">
                <span id="settings-new-tab" className="kit-settings-label">
                  A new tab opens
                </span>
                <span className="kit-settings-hint">The start page, or the tool or section you opened last.</span>
              </div>
              <ToggleGroup
                type="single"
                variant="segmented"
                size="sm"
                aria-labelledby="settings-new-tab"
                value={settings.newTab}
                onValueChange={(value: string) => {
                  // Radix offers '' when the pressed item is pressed again; one is always chosen.
                  if (value) save({ ...settings, newTab: value as NewTabChoice });
                }}>
                {NEW_TAB.map(({ value, label }) => (
                  <ToggleGroupItem key={value} value={value} className="flex-auto">
                    {label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          </section>
        )}

        <section className="kit-settings-group" aria-labelledby="settings-start">
          <h2 id="settings-start" className="kit-settings-group-title">
            Start page
          </h2>
          <p className="kit-settings-hint kit-settings-intro">
            The rows under the field, in this order. Parts that read your browser ask Chrome first and are off until you
            allow them.
          </p>
          {rows.map((part, index) => partRow(part, { index, count: rows.length }))}
          <div className="kit-settings-actions">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!settings.order.length}
              onClick={() => save({ ...settings, order: [] })}>
              Reset order
            </Button>
          </div>
          <h3 className="kit-settings-subtitle">The field and the tiles</h3>
          {options.map(part => partRow(part))}
        </section>

        <section className="kit-settings-group" aria-labelledby="settings-appearance">
          <h2 id="settings-appearance" className="kit-settings-group-title">
            Appearance
          </h2>
          <div className="kit-settings-theme">
            <ThemePicker pref={theme.pref} onChange={theme.onChange} />
          </div>
          {shell && (
            <div className="kit-settings-row" data-setting="breadcrumb">
              <div className="kit-settings-text">
                <Label htmlFor="settings-breadcrumb" className="kit-settings-label">
                  Breadcrumb
                </Label>
                <span id="settings-breadcrumb-hint" className="kit-settings-hint">
                  Where you are, in the toolbar: “Tools / Base64”. While it shows, it is the page’s title.
                </span>
              </div>
              <div className="kit-settings-controls">
                <Switch
                  id="settings-breadcrumb"
                  aria-describedby="settings-breadcrumb-hint"
                  checked={shell.breadcrumb}
                  onCheckedChange={shell.setBreadcrumb}
                />
              </div>
            </div>
          )}
        </section>

        {shortcuts && <ShortcutSettings shortcuts={shortcuts} fixed={FIXED} mac={isMac()} />}

        {history.automaticCopying && <ToolSettings host={history} />}

        <HistorySettings host={history} />

        <section className="kit-settings-group" aria-labelledby="settings-data">
          <h2 id="settings-data" className="kit-settings-group-title">
            Your data
          </h2>
          <div className="kit-settings-hint kit-settings-prose">
            <p>
              Stored in this browser’s extension storage: these settings, your start page shortcuts, your keyboard
              shortcuts, which sidebar groups you opened or closed, and which tools and sections you opened last (for
              the Tools tiles, “Last opened tool” and the search’s recent places).
              {history.included &&
                ' While History is on, the tools keep what you type, paste or open in them, with their results, in this browser’s storage — not in incognito windows, never secrets without a master password — until it is deleted (see History above).'}{' '}
              Never stored: what you type or paste into the start page’s field or the search. Nothing is sent anywhere
              until you press Enter on a web search, which goes to your browser’s search engine; an export goes only
              into the file you save.
            </p>
            {privacy.map(line => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
};
