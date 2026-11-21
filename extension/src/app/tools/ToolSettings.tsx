/**
 * Settings → Tools, mounted by one line in SettingsPage: the tools' per-tool settings (src/tools/settings.ts). One switch
 * now — "Copy automatically after generating" — listed with the tools it applies to, from their definitions
 * (`output.origin: 'generated'`). It is not one boolean in storage: flipping it upserts the value into the entry of every
 * tool it applies to (`setForAll`), and a tool that appears later reads the switch's state. A switch per tool can come
 * later over the same entries, without a migration.
 */
import { createDebug } from '@extension/logger';
import { TOOLS } from '@src/tools/registry';
import { AUTO_COPY, autoCopyApplies } from '@workspace/tools-host';
import { Label } from '@workspace/ui/label';
import { Switch } from '@workspace/ui/switch';
import { useSyncExternalStore } from 'react';
import type { HistoryHost } from '@src/history/behaviors';
import type { ReactElement } from 'react';

const debug = createDebug('extension:tool-settings');

export const ToolSettings = ({ host }: { host: Pick<HistoryHost, 'toolSettings'> }): ReactElement => {
  const store = host.toolSettings;
  const on = useSyncExternalStore(
    listener => store.subscribe(listener),
    () => store.forAll()[AUTO_COPY] === true,
  );
  const applies = TOOLS.filter(autoCopyApplies);
  const id = 'settings-tools-auto-copy';
  return (
    <section className="kit-settings-group" aria-labelledby="settings-tools" data-settings="tools">
      <h2 id="settings-tools" className="kit-settings-group-title">
        Tools
      </h2>
      <div className="kit-settings-row" data-setting={AUTO_COPY}>
        <div className="kit-settings-text">
          <Label htmlFor={id} className="kit-settings-label">
            Copy automatically after generating
          </Label>
          <span id={`${id}-hint`} className="kit-settings-hint">
            Pressing Generate also copies the result — all of it for a batch, as Copy all does. Never when a tool or an
            entry from History opens.
          </span>
          <span className="kit-settings-hint" data-applies>
            {`Applies to: ${applies.map(t => t.title).join(', ')}.`}
          </span>
        </div>
        <div className="kit-settings-controls">
          <Switch
            id={id}
            aria-describedby={`${id}-hint`}
            checked={on}
            disabled={applies.length === 0}
            onCheckedChange={value =>
              store
                .setForAll(
                  applies.map(t => t.id),
                  { [AUTO_COPY]: value },
                )
                .catch(e => debug.warn('save', e))
            }
          />
        </div>
      </div>
    </section>
  );
};
