/**
 * The tools as the start page knows them (D16): the catalogue produced at build time from the tools' definitions
 * (build/toolCatalogue.ts) — id, title, keywords, and the shortcut a tool suggests — in the registry's order. Data only:
 * a tool adds its entry to the start page's first load and nothing else. The places of the page
 * (shared/destinations.ts), the start page's field and Tools tiles, the shortcuts' actions and the tab's title read it;
 * what else a tool has — its summary, history declaration, component, `detect` — is the definition's
 * (tools/registry.ts, loaded with the shell) and the detectors' (tools/detectors.ts, loaded when pasted text needs them).
 */
import { CATALOGUE } from 'virtual:tool-catalogue';
import type { ToolDescription } from '@workspace/tools-host';

export type CatalogueEntry = Pick<ToolDescription, 'id' | 'title' | 'keywords' | 'shortcut'>;

export const TOOL_CATALOGUE: readonly CatalogueEntry[] = CATALOGUE;

export const catalogueEntry = (id: string | undefined): CatalogueEntry | undefined =>
  TOOL_CATALOGUE.find(t => t.id === id);
