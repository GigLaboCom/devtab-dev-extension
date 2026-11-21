/**
 * The Cron tool as a host lists it (docs/tools/specs/cron.md): the description, its history declaration and its
 * component, loaded only when the tool is opened. Data only: it imports its history declaration and nothing else at run
 * time — no logic, no library — so a host reads it at build time and lists the tool without its code.
 * Recognising pasted text is `./detect` (src/detect.ts).
 */
import { cronHistory } from './history';
import type { ToolDefinition } from '@workspace/tools-host';

export const definition: ToolDefinition = {
  id: 'cron',
  title: 'Cron',
  summary: 'Explain a cron expression and list its next runs.',
  keywords: ['cron', 'crontab', 'schedule', 'quartz', 'next run', 'cron expression', 'every minute', 'timer'],
  order: 12,
  history: cronHistory,
  // Its result comes from what the person gives it (a converter, an inspector): nothing to copy unasked.
  output: { origin: 'input' },
  load: () => import('./CronTool'),
};
