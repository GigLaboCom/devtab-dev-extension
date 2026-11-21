/** A tool's own settings (`ToolHost.settings`), followed live: a change in any page of the host re-renders the tool. */
import { defaultToolHost } from './host';
import { useMemo, useSyncExternalStore } from 'react';
import type { ToolHost } from './host';
import type { ToolSettingValues } from './settings';

export const useToolSettings = (host: ToolHost | undefined, toolId: string): ToolSettingValues => {
  const settings = host?.settings ?? defaultToolHost.settings;
  const own = useMemo(() => settings.forTool(toolId), [settings, toolId]);
  return useSyncExternalStore(
    listener => own.subscribe(listener),
    () => own.get(),
  );
};
