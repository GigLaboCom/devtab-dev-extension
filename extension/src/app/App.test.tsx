/**
 * The main page in jsdom over a fake `chrome`: the three parts are reachable from the navigation, the JSON tool loads,
 * and the theme switch writes the choice to chrome.storage.local (where the editor page picks it up).
 */
import { App } from './App';
import { THEME_STORAGE_KEY } from '@extension/theme';
import { fakeChrome } from '@src/test/fakes';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ThemeDeps } from './useTheme';

const setup = (hash: string) => {
  window.location.hash = hash;
  const { storage, api } = fakeChrome();
  vi.stubGlobal('chrome', api);
  const media = Object.assign(new EventTarget(), { matches: false });
  const theme: ThemeDeps = {
    area: storage.area,
    onChanged: storage.onChanged,
    win: { localStorage: window.localStorage, matchMedia: () => media as unknown as MediaQueryList },
    root: document.documentElement,
  };
  render(<App theme={theme} />);
  return storage;
};

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('main page', () => {
  it('opens on «Compare code» with the editor frame and an example in both fields', async () => {
    setup('');
    expect(await screen.findByRole('heading', { name: 'Compare code' })).toBeTruthy();
    expect(screen.getByTitle('Side-by-side comparison').getAttribute('src')).toBe('/src/viewer/index.html');
    expect((screen.getByLabelText(/Before/) as HTMLTextAreaElement).value).toContain('pub struct Invoice');
    expect(screen.getByRole('button', { name: 'Compare' }).hasAttribute('disabled')).toBe(true);
  });

  it('navigates to the tools and loads the JSON tool', async () => {
    setup('#/compare');
    act(() => {
      window.location.hash = '#/tools/json';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(await screen.findByRole('heading', { name: 'Tools' })).toBeTruthy();
    const input = await screen.findByLabelText('Input');
    fireEvent.change(input, { target: { value: '{"b":1,"a":[1,2]}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Format' }));
    expect((screen.getByLabelText('Result') as HTMLTextAreaElement).value).toBe(
      '{\n  "b": 1,\n  "a": [\n    1,\n    2\n  ]\n}',
    );
    fireEvent.change(input, { target: { value: '{"a":}' } });
    expect(screen.getByText(/Line 1, column 6/)).toBeTruthy();
  });

  it('shows the companion notice in «Live review»', async () => {
    setup('#/review');
    expect(await screen.findByRole('heading', { name: 'Companion app required' })).toBeTruthy();
  });

  it('the theme switch saves the choice and repaints the page', async () => {
    const storage = setup('#/compare');
    await screen.findByRole('heading', { name: 'Compare code' });
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    });
    expect(storage.rows.get(THEME_STORAGE_KEY)).toMatchObject({ mode: 'dark' });
    expect(document.documentElement.dataset.theme).toBe('default-dark');
  });
});
