/**
 * The Unix Time tool as a host lists it (docs/tools/specs/unix-time.md): the description, its history declaration and its
 * component, loaded only when the tool is opened. Data only: it imports its history declaration and nothing else at
 * run time — a host reads it at build time and lists the tool without its code.
 */
import { unixTimeHistory } from './history';
import type { ToolDefinition } from '@workspace/tools-host';

export const definition: ToolDefinition = {
  id: 'unix-time',
  title: 'Unix Time',
  summary: 'Turn a Unix timestamp into a date and a date into a timestamp, in any time zone.',
  keywords: [
    'unix',
    'timestamp',
    'epoch',
    'unix time',
    'posix time',
    'date',
    'time zone',
    'utc',
    'iso 8601',
    'rfc 3339',
    'rfc 2822',
    'milliseconds',
    'nanoseconds',
  ],
  order: 5,
  history: unixTimeHistory,
  // Every row is read from what the person typed or pasted; Now only writes the moment into that input
  // (docs/tools/copying.md §2): nothing is generated, nothing to copy unasked.
  output: { origin: 'input' },
  load: () => import('./UnixTimeTool'),
};
