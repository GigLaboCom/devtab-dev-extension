/**
 * Settings → Shortcuts: every action a shortcut can be bound to (src/shortcuts/actions.ts — the palette, the start
 * page, each section, each tool, from their definitions), with its combination now. Click a field (or Tab to it) and
 * press the keys to record one (@workspace/ui/hotkey-input); clear it; reset one or all to the defaults. Each row says
 * whether its key is the default, the person's own, cleared (it stays so), or a default another action holds. A combination
 * that cannot be taken — Chrome keeps it, the browser or the editor needs it, no ⌘ / Ctrl or ⌥ / Alt, or another action
 * or a page already has it — is said at once beside the action and is not saved. Saved at once otherwise, in
 * chrome.storage.local; every open page of ours follows without a reload.
 */
import { keyLabel } from '@src/shared/keyLabels';
import { defaultFor } from '@src/shortcuts/actions';
import { refusalOf, withKey } from '@src/shortcuts/bindings';
import { Button } from '@workspace/ui/button';
import { HotkeyInput } from '@workspace/ui/hotkey-input';
import { Label } from '@workspace/ui/label';
import { RotateCcwIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import type { Shortcuts } from '../shell/useShortcuts';
import type { KeyChord } from '@src/shared/keys';
import type { Refusal } from '@src/shortcuts/bindings';
import type { ReactElement } from 'react';

export interface ShortcutSettingsProps {
  shortcuts: Shortcuts;
  /** The pages' own fixed shortcuts («Compare code»'s Save), which a shortcut may not take. */
  fixed: ReadonlyArray<{ chord: KeyChord; title: string }>;
  mac: boolean;
}

const sentence = (refusal: Refusal, chord: KeyChord, mac: boolean): string => {
  const label = keyLabel(chord, mac);
  switch (refusal.kind) {
    case 'no-modifier':
      return `Add ${mac ? '⌘ or ⌥' : 'Ctrl or Alt'}: ${label} alone would type into text fields. Not saved.`;
    case 'other-modifier':
      return mac
        ? '⌃ has no counterpart on Windows and Linux: use ⌘ instead. Not saved.'
        : 'The Windows key has no counterpart on a Mac: use Ctrl instead. Not saved.';
    case 'chrome':
      return `${label} is Chrome’s own: it never reaches a page. Not saved.`;
    case 'browser':
      return `${label} is the browser’s or the editor’s (copy, paste, find, zoom, the tab numbers…). Not saved.`;
    case 'conflict':
      return `${label} is already “${refusal.with}”. Clear that one first, or choose another. Not saved.`;
  }
};

const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, '-');

export const ShortcutSettings = ({ shortcuts, fixed, mac }: ShortcutSettingsProps): ReactElement => {
  const { actions, bindings, resolved, settings, save } = shortcuts;
  const [notes, setNotes] = useState<Record<string, string>>({});
  const note = (id: string, text: string | null): void =>
    setNotes(n => {
      const next = { ...n };
      if (text) next[id] = text;
      else delete next[id];
      return next;
    });
  const groups = [...new Set(actions.map(a => a.group))];
  const changed = Object.keys(settings.keys).length > 0;

  return (
    <section className="kit-settings-group" aria-labelledby="settings-shortcuts" data-settings="shortcuts">
      <h2 id="settings-shortcuts" className="kit-settings-group-title">
        Shortcuts
      </h2>
      <p className="kit-settings-intro kit-settings-hint">
        They work on this extension’s pages — in «Compare code»’s editor too — not in other tabs. In a text field only a
        shortcut with {mac ? '⌘' : 'Ctrl'} counts. Click a field and press the keys; Backspace clears it.
      </p>
      {groups.map(group => (
        <div key={group} role="group" aria-labelledby={`shortcuts-${slug(group)}`}>
          <h3 id={`shortcuts-${slug(group)}`} className="kit-settings-subtitle">
            {group}
          </h3>
          {actions
            .filter(a => a.group === group)
            .map(action => {
              const id = `shortcut-${slug(action.id)}`;
              const current = bindings.get(action.id) ?? null;
              const fallback = defaultFor(action, mac);
              const stored = settings.keys[action.id];
              const blocked = resolved.blocked.get(action.id);
              const state =
                stored === null ? 'cleared' : stored ? 'own' : blocked ? 'blocked' : current ? 'default' : 'none';
              const label = fallback && keyLabel(fallback, mac);
              const status = {
                default: 'Default',
                own: label ? `Your key — the default is ${label}` : 'Your key',
                cleared: label ? `None — you cleared it (the default is ${label})` : 'None — you cleared it',
                blocked: blocked
                  ? `Default ${label} is not given: “${actions.find(a => a.id === blocked.by)?.title ?? blocked.by}” has it`
                  : '',
                none: '',
              }[state];
              const record = (chord: KeyChord): void => {
                const refusal = refusalOf(chord, action.id, { actions, bindings, fixed, mac });
                if (refusal) return note(action.id, sentence(refusal, chord, mac));
                note(action.id, null);
                void save(withKey(settings, action.id, chord));
              };
              // Cleared stays cleared: a later version giving the action a default does not bring a key back.
              const clear = (): void => {
                note(action.id, null);
                void save(withKey(settings, action.id, null));
              };
              const reset = (): void => {
                note(action.id, null);
                void save(withKey(settings, action.id, undefined));
              };
              return (
                <div key={action.id} className="kit-settings-row" data-shortcut={action.id} data-origin={state}>
                  <div className="kit-settings-text">
                    <Label htmlFor={id} className="kit-settings-label">
                      {action.title}
                    </Label>
                    {status && <p className="kit-settings-hint">{status}</p>}
                    {notes[action.id] && (
                      <p className="kit-settings-note" role="alert">
                        {notes[action.id]}
                      </p>
                    )}
                  </div>
                  <div className="kit-settings-controls">
                    <HotkeyInput
                      id={id}
                      className="kit-shortcut-field"
                      platform={mac ? 'mac' : 'other'}
                      value={current}
                      onRecord={record}
                      onClear={clear}
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Clear the shortcut for ${action.title}`}
                      title="Clear"
                      disabled={!current}
                      onClick={clear}>
                      <XIcon aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Reset the shortcut for ${action.title}`}
                      title={label ? `Back to the default, ${label}` : 'Back to none'}
                      disabled={stored === undefined}
                      onClick={reset}>
                      <RotateCcwIcon aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              );
            })}
        </div>
      ))}
      <div className="kit-settings-actions">
        <Button
          variant="outline"
          size="sm"
          disabled={!changed}
          onClick={() => {
            setNotes({});
            void save({ version: 2, keys: {} });
          }}>
          Reset all shortcuts
        </Button>
      </div>
    </section>
  );
};
