/**
 * The tools (roadmap 1B: `{id, title, keywords, detect(text), component}`). A tool is a folder `tools/<id>/` with its
 * logic as pure functions in `logic.ts` (unit-tested) and its component, loaded lazily. Adding one = a folder + an
 * entry here; the shell picks it up (navigation, the address `#/tools/<id>`).
 */
import { detectJson } from './json/logic';
import { lazy } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';

export interface ToolDefinition {
  id: string;
  title: string;
  /** One line under the title. */
  summary: string;
  keywords: readonly string[];
  /** Does pasted text look like this tool's input? (for the future «paste anything» field) */
  detect?: (text: string) => boolean;
  component: LazyExoticComponent<ComponentType>;
}

export const TOOLS: readonly ToolDefinition[] = [
  {
    id: 'json',
    title: 'JSON',
    summary: 'Format, validate and minify JSON.',
    keywords: ['json', 'format', 'pretty', 'validate', 'minify', 'sort keys'],
    detect: detectJson,
    component: lazy(() => import('./json/JsonTool')),
  },
];

export const toolById = (id: string | undefined): ToolDefinition | undefined => TOOLS.find(t => t.id === id);
