import './app.css';
import { App } from './App';
import { parseRoute } from './route';
import { startBehaviors } from '@src/start/behaviors';
import { switchedOn } from '@src/start/part';
import { initialState } from '@src/start/store';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { AppDeps } from './App';
import type { PermissionsApi } from './useStart';
import type { HistoryHost } from '@src/history/behaviors';

// The tool history's composition root (src/history/behaviors.ts) and the tools' definitions load with the shell, never
// with the start page.
let history: Promise<HistoryHost> | undefined;
const loadHistory = (): Promise<HistoryHost> =>
  (history ??= Promise.all([import('@src/history/behaviors'), import('@src/tools/registry')]).then(([m, r]) =>
    m.historyHost({
      chrome,
      storage: { indexedDB: { factory: indexedDB, keyRange: IDBKeyRange } },
      tools: r.TOOLS,
    }),
  ));

const behaviors = startBehaviors(chrome);

// On the start route, the code of the parts that are on and shown at once is asked for before the first render (from
// the settings' copy in localStorage, as route-boot.js reads it), so it arrives with the first frames; the page keeps
// their room meanwhile (sections/StartPage.tsx).
if (parseRoute(window.location.hash).section === 'start') {
  const settings = initialState(window).settings;
  for (const part of behaviors.parts)
    if (part.loadAt === 'start' && switchedOn(part, settings)) behaviors.code.load(part).catch(() => undefined);
}

const deps: AppDeps = {
  theme: {
    area: chrome.storage.local,
    onChanged: chrome.storage.onChanged,
    win: window,
    root: document.documentElement,
  },
  start: { area: chrome.storage.local, onChanged: chrome.storage.onChanged, win: window },
  permissions: chrome.permissions as unknown as PermissionsApi,
  behaviors,
  history: loadHistory,
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App deps={deps} />
  </StrictMode>,
);
