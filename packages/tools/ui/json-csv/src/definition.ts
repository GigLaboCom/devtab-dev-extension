/**
 * The JSON and CSV tool as a host lists it (docs/tools/specs/json-csv.md): the description, its history declaration and its
 * component, loaded only when the tool is opened. Data only: it imports its history declaration and nothing else at run
 * time — no logic, no library — so a host reads it at build time and lists the tool without its code.
 * Recognising pasted text is `./detect` (src/detect.ts).
 */
import { jsonCsvHistory } from './history';
import type { ToolDefinition } from '@workspace/tools-host';

export const definition: ToolDefinition = {
  id: 'json-csv',
  title: 'JSON and CSV',
  summary: 'Turn a JSON array into CSV for a spreadsheet, and CSV back into JSON.',
  keywords: [
    'csv',
    'tsv',
    'json',
    'json to csv',
    'csv to json',
    'excel',
    'spreadsheet',
    'table',
    'export',
    'delimiter',
  ],
  order: 22,
  history: jsonCsvHistory,
  // Its result comes from what the person gives it (a converter, an inspector): nothing to copy unasked.
  output: { origin: 'input' },
  load: () => import('./JsonCsvTool'),
};
