/**
 * The Subnet Calculator tool as a host lists it (docs/tools/specs/subnet.md): the description, its history declaration and its
 * component, loaded only when the tool is opened. Data only: it imports its history declaration and nothing else at run
 * time — no logic, no library — so a host reads it at build time and lists the tool without its code.
 * Recognising pasted text is `./detect` (src/detect.ts).
 */
import { subnetHistory } from './history';
import type { ToolDefinition } from '@workspace/tools-host';

export const definition: ToolDefinition = {
  id: 'subnet',
  title: 'Subnet Calculator',
  summary: 'IPv4 and IPv6 CIDR blocks: masks, ranges, host counts; match, split and summarize.',
  keywords: ['subnet', 'cidr', 'netmask', 'ip range', 'ipv4', 'ipv6', 'ip address', 'supernet'],
  order: 40,
  history: subnetHistory,
  // Its result comes from what the person gives it (a converter, an inspector): nothing to copy unasked.
  output: { origin: 'input' },
  load: () => import('./SubnetTool'),
};
