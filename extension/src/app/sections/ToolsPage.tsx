/**
 * «Tools». The section's own page (`#/tools`) is the overview: every tool of tools/registry.ts with its summary, in the
 * registry's order — the sidebar lists the same tools by title, the overview says what each one does, the way a
 * documentation site's category page lists its pages. A tool's page (`#/tools/<id>`) is the tool alone, across the
 * width the list used to take: loaded lazily, with the text the start page or the palette handed it, if any, the host
 * (its history: ToolHost.history) and the entry of its history to open, if the History page or the tool's own history
 * line asked for one. Every tool sits in the same frame — the kit's ToolPage: its title, its summary and this host's
 * history line — so the tools look like one product. An address naming no tool shows the overview and says so.
 */
import { clearHandoff, peekHandoff } from '../handoff';
import { clearRestore, peekRestore } from '../history/restoreHandoff';
import { ToolHistoryPanel } from '../history/ToolHistoryPanel';
import { routeHash } from '../route';
import { sourceOf } from '@src/history/sources';
import { pageNavigation } from '@src/tools/navigation';
import { TOOLS, componentOf, toolById } from '@src/tools/registry';
import { ToolPage } from '@workspace/ui/tool-page';
import { Suspense, useEffect, useMemo, useState } from 'react';
import type { HistoryHost } from '@src/history/behaviors';
import type { ToolDefinition } from '@src/tools/registry';
import type { RestoreRequest, ToolHost } from '@workspace/tools-host';
import type { ReactElement } from 'react';

const Head = (): ReactElement => (
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
);

const Overview = ({ unknown }: { unknown?: string }): ReactElement => (
  <>
    {unknown !== undefined && (
      <p className="kit-tools-note" role="status">
        There is no tool <q>{unknown}</q>. These are the tools there are.
      </p>
    )}
    <nav aria-label="All tools">
      <ul className="kit-tools-index">
        {TOOLS.map(t => (
          <li key={t.id}>
            <a className="kit-tools-index-item" href={routeHash({ section: 'tools', tool: t.id })}>
              <span className="kit-tools-index-title">{t.title}</span>
              <span className="kit-tools-index-summary">{t.summary}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  </>
);

/** One tool's page; keyed by the tool, so what was handed over or asked to open belongs to that tool alone. */
const ToolView = ({ tool, history }: { tool: ToolDefinition; history: HistoryHost }): ReactElement => {
  const Tool = componentOf(tool);
  // Text pasted into the start page's field or the palette for this tool: taken once, from memory (app/handoff.ts).
  const [input] = useState(() => peekHandoff(tool.id));
  useEffect(() => clearHandoff(), []);
  const host = useMemo<ToolHost>(
    () => ({ history: history.factory, settings: history.toolSettings, navigation: pageNavigation(window) }),
    [history],
  );
  // An entry to open: handed over by the History page (once), or picked in the tool's own history line.
  const [restore, setRestore] = useState<(RestoreRequest & { owner: string }) | undefined>(() => {
    const id = peekRestore(tool.id);
    return id ? { owner: tool.id, id } : undefined;
  });
  useEffect(() => clearRestore(), []);
  const source = sourceOf(history.sources, tool.id);
  return (
    <ToolPage
      title={tool.title}
      summary={tool.summary}
      history={
        source && <ToolHistoryPanel host={history} source={source} onOpen={id => setRestore({ owner: tool.id, id })} />
      }>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <Tool input={input} host={host} restore={restore?.owner === tool.id ? restore : undefined} />
      </Suspense>
    </ToolPage>
  );
};

export const ToolsPage = ({ toolId, history }: { toolId?: string; history: HistoryHost }): ReactElement => {
  const tool = toolById(toolId);
  return (
    <section className="kit-section" aria-labelledby="tools-title">
      <Head />
      {tool ? <ToolView key={tool.id} tool={tool} history={history} /> : <Overview unknown={toolId} />}
    </section>
  );
};
