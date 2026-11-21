/**
 * What may record into the tool history, built from definitions — the way the start page's parts are (src/start/parts):
 * every tool of tools/registry.ts with its `history` declaration (a tool without one keeps nothing). The History page's
 * filters and names, the settings' list of what is kept and the per-owner switches walk this list; none of them names
 * an owner. A section that records later (not a tool) is one more entry of kind 'section' here, with its own
 * declaration and the address its entries open at.
 */
import { NOTHING } from '@workspace/tools-shared/history';
import type { HistoryDeclaration } from '@workspace/tools-shared/history';

export interface HistorySource {
  /** The owner id records carry (a tool's id). */
  owner: string;
  kind: 'tool' | 'section';
  title: string;
  declaration: HistoryDeclaration;
  /** Where an entry of this owner opens (the tool's page). */
  hash: string;
}

export interface Recordable {
  id: string;
  title: string;
  history?: HistoryDeclaration;
}

export const historySources = (tools: readonly Recordable[]): readonly HistorySource[] =>
  tools.map(tool => ({
    owner: tool.id,
    kind: 'tool',
    title: tool.title,
    declaration: tool.history ?? NOTHING,
    hash: `#/tools/${tool.id}`,
  }));

export const sourceOf = (sources: readonly HistorySource[], owner: string): HistorySource | undefined =>
  sources.find(s => s.owner === owner);

/** The title of a kind, from its owner's declaration (an unknown kind shows its id). */
export const kindTitle = (sources: readonly HistorySource[], owner: string, kind: string): string =>
  sourceOf(sources, owner)?.declaration.kinds.find(k => k.id === kind)?.title ?? kind;
