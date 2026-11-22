/**
 * The Data Units tool as a host lists it (docs/tools/specs/data-units.md): the description, its history declaration and its
 * component, loaded only when the tool is opened. Data only: it imports its history declaration and nothing else at run
 * time — no logic, no library — so a host reads it at build time and lists the tool without its code.
 * Recognising pasted text is `./detect` (src/detect.ts).
 */
import { dataUnitsHistory } from './history';
import type { ToolDefinition } from '@workspace/tools-host';

export const definition: ToolDefinition = {
  id: 'data-units',
  title: 'Data Units',
  summary: 'Bytes, KB and KiB, MB and MiB, bits and bytes, Mbps and MB/s, and how long a transfer takes — exact.',
  keywords: ['bytes', 'mb to gb', 'mib', 'kb', 'bitrate', 'mbps', 'download time'],
  order: 41,
  history: dataUnitsHistory,
  // Its result comes from what the person gives it (a converter, an inspector): nothing to copy unasked.
  output: { origin: 'input' },
  load: () => import('./DataUnitsTool'),
};
