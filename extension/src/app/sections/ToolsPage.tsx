/**
 * «Tools»: the list from tools/registry.ts (list rows, theming-components.md §5.3) and the chosen tool, loaded lazily,
 * with the text the start page handed it, if any, the host (its history: ToolHost.history) and the entry of its history
 * to open, if the History page or the tool's own history line asked for one. Every tool sits in the same frame — the
 * kit's ToolPage: its title, its summary and this host's history line — so the tools look like one product.
 */
import { clearHandoff, peekHandoff } from '../handoff';
import { clearRestore, peekRestore } from '../history/restoreHandoff';
import { ToolHistoryPanel } from '../history/ToolHistoryPanel';
import { routeHash } from '../route';
import { sourceOf } from '@src/history/sources';
import { TOOLS, componentOf, toolById } from '@src/tools/registry';
import { ToolPage } from '@workspace/ui/tool-page';
import { Suspense, useEffect, useMemo, useState } from 'react';
import type { HistoryHost } from '@src/history/behaviors';
import type { RestoreRequest, ToolHost } from '@workspace/tools-host';
import type { ReactElement } from 'react';

export const ToolsPage = ({ toolId, history }: { toolId?: string; history: HistoryHost }): ReactElement => {
  const tool = toolById(toolId) ?? TOOLS[0];
  const Tool = componentOf(tool);
  // Text pasted into the start page's field for this tool: taken once, from memory (app/handoff.ts).
  const [input] = useState(() => peekHandoff(tool.id));
  useEffect(() => clearHandoff(), []);
  const host = useMemo<ToolHost>(() => ({ history: history.factory }), [history]);
  // An entry to open: handed over by the History page (once), or picked in the tool's own history line.
  const [restore, setRestore] = useState<(RestoreRequest & { owner: string }) | undefined>(() => {
    const id = peekRestore(tool.id);
    return id ? { owner: tool.id, id } : undefined;
  });
  useEffect(() => clearRestore(), []);
  const source = sourceOf(history.sources, tool.id);
  return (
    <section className="kit-section" aria-labelledby="tools-title">
      <header className="kit-section-head">
        <div>
          <h1 id="tools-title" className="kit-section-title">
            Tools
          </h1>
          <p className="kit-section-hint">
            Work offline. Nothing you paste leaves this browser; what a tool keeps is in History.
          </p>
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
        <ToolPage
          title={tool.title}
          summary={tool.summary}
          history={
            source && (
              <ToolHistoryPanel host={history} source={source} onOpen={id => setRestore({ owner: tool.id, id })} />
            )
          }>
          <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
            <Tool key={tool.id} input={input} host={host} restore={restore?.owner === tool.id ? restore : undefined} />
          </Suspense>
        </ToolPage>
      </div>
    </section>
  );
};
