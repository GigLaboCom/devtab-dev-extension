import { createToolSettings, memoryToolSettingsArea } from './settings';
import { toolSettingsContract } from './settingsContract';
import type { ToolSettingsRecord } from './settings';

toolSettingsContract('in memory', () => {
  const area = memoryToolSettingsArea();
  return {
    page: () => createToolSettings(area),
    stored: () => area.read(),
    seed: raw => area.write(raw as ToolSettingsRecord),
  };
});
