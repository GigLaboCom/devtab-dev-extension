/**
 * The writer of a client, loaded on first need (docs/tools/specs/curl-to-code.md §15): each family of clients is a
 * module of its own, so a page holds only the writers of the clients it was asked for. The import of each family is
 * written out so the bundler makes one part of each.
 */
import { targetInfo } from './targets';
import type { Family } from './targets';
import type { Clients, Generator, Target } from './types';

const FAMILIES: Readonly<Record<Family, () => Promise<{ clients: Clients }>>> = {
  javascript: () => import('./clients/javascript'),
  python: () => import('./clients/python'),
  shell: () => import('./clients/shell'),
  java: () => import('./clients/java'),
  csharp: () => import('./clients/csharp'),
  php: () => import('./clients/php'),
  powershell: () => import('./clients/powershell'),
  go: () => import('./clients/go'),
  rust: () => import('./clients/rust'),
  kotlin: () => import('./clients/kotlin'),
  dart: () => import('./clients/dart'),
  ruby: () => import('./clients/ruby'),
  swift: () => import('./clients/swift'),
};

export const loadGenerator = async (target: Target): Promise<Generator> => {
  const { clients } = await FAMILIES[targetInfo(target).family]();
  return clients[target]!;
};
