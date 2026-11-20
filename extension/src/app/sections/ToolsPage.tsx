/** «Tools»: the list from tools/registry.ts (list rows, theming-components.md §5.3) and the chosen tool, loaded lazily. */
import { routeHash } from '../route';
import { TOOLS, toolById } from '@src/tools/registry';
import { Suspense } from 'react';
import type { ReactElement } from 'react';

export const ToolsPage = ({ toolId }: { toolId?: string }): ReactElement => {
  const tool = toolById(toolId) ?? TOOLS[0];
  const Tool = tool.component;
  return (
    <section className="kit-section" aria-labelledby="tools-title">
      <header className="kit-section-head">
        <div>
          <h1 id="tools-title" className="kit-section-title">
            Tools
          </h1>
          <p className="kit-section-hint">Work offline. What you paste stays in this tab and is never stored.</p>
        </div>
      </header>
      <div className="grid grid-cols-[calc(var(--spacing)*45)_minmax(0,1fr)] gap-4">
        <nav aria-label="Tools">
          <ul className="kit-list">
            {TOOLS.map(t => (
              <li key={t.id}>
                <a
                  className="kit-list-item"
                  href={routeHash({ section: 'tools', tool: t.id })}
                  aria-current={t.id === tool.id ? 'page' : undefined}>
                  {t.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex flex-col gap-3">
          <div>
            <h2 className="text-base font-semibold">{tool.title}</h2>
            <p className="text-sm text-muted-foreground">{tool.summary}</p>
          </div>
          <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
            <Tool />
          </Suspense>
        </div>
      </div>
    </section>
  );
};
