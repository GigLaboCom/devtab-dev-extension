/**
 * A tool's page over each storage of the saved parameters (seam `ParameterStorage`, D23): what the page's frame shows
 * follows the storage the host was built over — the reset control only where the storage keeps, and one line of words
 * while the storage refuses to keep the person's latest choice. The tool is the real JSON tool; it is not told any of
 * this.
 */
import { ToolsPage } from './ToolsPage';
import { memoryHistoryHost } from '@src/history/behaviors';
import { chromePlace } from '@src/test/parameterPlace';
import { TOOLS } from '@src/tools/registry';
import { extensionToolSettings, localParameterStorage } from '@src/tools/settings';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { noParameterStorage } from '@workspace/tools-host';
import { afterEach, describe, expect, it } from 'vitest';
import type { HistoryHost } from '@src/history/behaviors';
import type { BrowserStorage } from '@src/tools/settings';
import type { ParameterStorage } from '@workspace/tools-host';

afterEach(cleanup);

const FAILED = 'Settings could not be saved. They stay as you set them until this page is closed.';

const open = async (make: (browser: BrowserStorage) => ParameterStorage) => {
  const place = chromePlace(make);
  const toolSettings = extensionToolSettings(place.browser.area, place.browser.onChanged, place.open());
  const host: HistoryHost = { ...memoryHistoryHost(TOOLS), toolSettings };
  // The page waits for the tool's settings and for the tool's code: both arrive inside this act.
  await act(async () => void render(<ToolsPage toolId="json" history={host} />));
  const sortKeys = await screen.findByLabelText('Sort keys', {}, { timeout: 10_000 });
  /** The person changes a parameter, and the delayed write is made now. */
  const change = async () => {
    fireEvent.click(sortKeys);
    await act(async () => toolSettings.forTool('json').flush());
  };
  const notice = () => document.querySelector('[data-part="settings-notice"]')?.textContent ?? null;
  const reset = () => screen.queryByRole('button', { name: 'Reset settings' });
  return { place, toolSettings, sortKeys, change, notice, reset };
};

describe('a tool’s page and the storage of its saved parameters', () => {
  it('local: a change is kept, the page offers the reset and has nothing to say', async () => {
    const page = await open(localParameterStorage);
    expect(page.reset()).toBeNull();
    await page.change();
    expect(await page.place.held('json')).toEqual({ schema: 1, values: { sortKeys: true } });
    expect(page.reset()).not.toBeNull();
    expect(page.notice()).toBeNull();
  }, 20_000);

  it('local, and the browser refuses the write: the page says so in one line, the tool keeps the choice, and the line goes when a write is taken', async () => {
    const page = await open(localParameterStorage);
    page.place.refuse!(true);
    await page.change();
    expect(page.notice()).toBe(FAILED);
    expect(document.querySelector('[data-part="settings-notice"]')!.getAttribute('role')).toBe('status');
    expect(page.sortKeys.getAttribute('data-state')).toBe('checked');
    expect(await page.place.held('json')).toBeUndefined();
    page.place.refuse!(false);
    await act(async () => page.toolSettings.forTool('json').flush());
    expect(page.notice()).toBeNull();
    expect(await page.place.held('json')).toEqual({ schema: 1, values: { sortKeys: true } });
  }, 20_000);

  it('switched off: the choice is shown, nothing is written, there is no reset and nothing is said', async () => {
    const page = await open(noParameterStorage);
    await page.change();
    expect(page.sortKeys.getAttribute('data-state')).toBe('checked');
    expect(page.place.storage.rows.size).toBe(0);
    expect(page.reset()).toBeNull();
    expect(page.notice()).toBeNull();
  }, 20_000);
});
