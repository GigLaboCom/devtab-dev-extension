/**
 * The tools this host offers (D14): every tool `ui` package of the workspace, found by its location — no list to edit.
 * A tool is two packages, `packages/tools/logic/<id>` and `packages/tools/ui/<id>`; the `ui` package's main export is
 * `src/definition.ts`, which exports `definition` (a `ToolDefinition` of @workspace/tools-host: id, title, summary,
 * keywords, order, detect, its history declaration, and `load` for its component). Adding a tool adds those files and
 * nothing here: the shell picks it up — the Tools list, the address `#/tools/<id>`, the start page's field and tiles
 * (shared/destinations.ts), and what the tool history may keep of it (src/history/sources.ts).
 *
 * The definitions are part of every page that lists the tools (the start page included, whose first chunk has a
 * budget: validate-build.sh Check 15), so each is small; a tool's component is a chunk of its own, loaded when opened.
 * src/tools/shape.test.ts holds every tool package to this shape.
 */
import { lazy } from 'react';
import type { ToolDefinition, ToolProps } from '@workspace/tools-host';
import type { ComponentType, LazyExoticComponent } from 'react';

export type { ToolDefinition, ToolProps };

const modules = import.meta.glob<ToolDefinition>('../../../packages/tools/ui/*/src/definition.ts', {
  eager: true,
  import: 'definition',
});

/**
 * The definitions found, in the order they ask for (the registry's numbers in docs/tools/README.md), then by id. A
 * package without a `definition` export is left out here (the host keeps working) and fails src/tools/shape.test.ts.
 */
export const toolsOf = (found: Record<string, ToolDefinition | undefined>): readonly ToolDefinition[] =>
  Object.values(found)
    .filter((d): d is ToolDefinition => d !== undefined)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

export const TOOLS: readonly ToolDefinition[] = toolsOf(modules);

export const toolById = (id: string | undefined): ToolDefinition | undefined => TOOLS.find(t => t.id === id);

const components = new Map<string, LazyExoticComponent<ComponentType<ToolProps>>>();

/** The tool's component, loaded on first render (one lazy component per tool, so React keeps its state). */
export const componentOf = (tool: ToolDefinition): LazyExoticComponent<ComponentType<ToolProps>> => {
  let component = components.get(tool.id);
  if (!component) components.set(tool.id, (component = lazy(tool.load)));
  return component;
};
