import './app.css';
import { App } from './App';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { ThemeDeps } from './useTheme';

const theme: ThemeDeps = {
  area: chrome.storage.local,
  onChanged: chrome.storage.onChanged,
  win: window,
  root: document.documentElement,
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App theme={theme} />
  </StrictMode>,
);
