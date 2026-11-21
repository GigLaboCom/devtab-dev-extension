import './app.css';
import { App } from './App';
import { startBehaviors } from '@src/start/behaviors';
import { TOOLS } from '@src/tools/registry';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { AppDeps } from './App';
import type { PermissionsApi } from './useStart';
import type { HistoryHost } from '@src/history/behaviors';

// The tool history's composition root (src/history/behaviors.ts) loads with the shell, never with the start page.
let history: Promise<HistoryHost> | undefined;
const loadHistory = (): Promise<HistoryHost> =>
  (history ??= import('@src/history/behaviors').then(m =>
    m.historyHost({
      chrome,
      storage: { indexedDB: { factory: indexedDB, keyRange: IDBKeyRange } },
      tools: TOOLS,
    }),
  ));

const deps: AppDeps = {
  theme: {
    area: chrome.storage.local,
    onChanged: chrome.storage.onChanged,
    win: window,
    root: document.documentElement,
  },
  start: { area: chrome.storage.local, onChanged: chrome.storage.onChanged, win: window },
  permissions: chrome.permissions as unknown as PermissionsApi,
  behaviors: startBehaviors(chrome),
  history: loadHistory,
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App deps={deps} />
  </StrictMode>,
);
