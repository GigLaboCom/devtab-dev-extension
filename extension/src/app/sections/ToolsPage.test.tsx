/**
 * A tool's page over each storage of the saved parameters (seam `ParameterStorage`, D23): what the page's frame shows
 * follows the storage the host was built over — the reset control only where the storage keeps, and one line of words
 * while the storage refuses to keep the person's latest choice. The tool is the real JSON tool; it is not told any of
 * this. Then each edition (D24, D25): the real Password Generator copies by itself after Generate only where the host
 * has automatic copying, and the tool page's history line says what the edition records.
 */
import { ToolsPage } from './ToolsPage';
import { fixedSource } from '@src/edition/fixed';
import { memoryHistoryHost } from '@src/history/behaviors';
import { chromePlace } from '@src/test/parameterPlace';
import { FREE, PRO, switchableSource } from '@src/test/switchableSource';
import { TOOLS } from '@src/tools/registry';
import { extensionToolSettings, localParameterStorage } from '@src/tools/settings';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AUTO_COPY, noParameterStorage } from '@workspace/tools-host';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

describe.each([['pro'], ['free']] as const)('a tool’s page in the %s edition', id => {
  const isPro = id === 'pro';
  const variant = fixedSource(id);

  it(`Password Generator with "autoCopy: true" stored: Generate ${isPro ? 'copies the password' : 'copies nothing'}; Copy copies; the setting stays stored`, async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    try {
      const host = memoryHistoryHost(TOOLS, variant);
      await host.toolSettings.setForAll(['password'], { [AUTO_COPY]: true });
      await act(async () => void render(<ToolsPage toolId="password" history={host} />));
      await screen.findByLabelText('Generated password', {}, { timeout: 10_000 });
      await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Generate' })));
      const generated = screen.getByLabelText('Generated password').textContent;
      expect(writeText.mock.calls).toEqual(isPro ? [[generated]] : []);
      await act(async () => void fireEvent.click(screen.getByRole('button', { name: isPro ? 'Copied' : 'Copy' })));
      expect(writeText.mock.calls.at(-1)).toEqual([generated]);
      expect(host.toolSettings.forTool('password').get()[AUTO_COPY]).toBe(true);
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard');
    }
  }, 20_000);

  it(`the history line: ${isPro ? 'History is on' : 'History is part of Pro'}`, async () => {
    const host = memoryHistoryHost(TOOLS, variant);
    await act(async () => void render(<ToolsPage toolId="json" history={host} />));
    await screen.findByLabelText('Sort keys', {}, { timeout: 10_000 });
    const line = document.querySelector('.kit-tool-history-line')?.textContent ?? '';
    if (isPro) expect(line).toContain('History is on: this tool’s work is kept in this browser.');
    else expect(line).toBe('History is part of Pro: nothing is kept.');
    expect(screen.getByText(/^Work offline\./).textContent).toBe(
      isPro
        ? 'Work offline. Nothing you paste leaves this browser; what a tool keeps is in History.'
        : 'Work offline. Nothing you paste leaves this browser.',
    );
  }, 20_000);
});

describe('the edition changes on an open tool page (a source a test switches)', () => {
  const ON = 'History is on: this tool’s work is kept in this browser.';
  const OFF = 'History is part of Pro: nothing is kept.';
  const line = () => document.querySelector('.kit-tool-history-line')?.textContent ?? '';
  const reset = () => screen.queryByRole('button', { name: 'Reset settings' });

  it('the history line and the reset control follow at once; the tool is not mounted again and keeps its choice', async () => {
    const source = switchableSource(FREE);
    const host = memoryHistoryHost(TOOLS, source);
    await act(async () => void render(<ToolsPage toolId="json" history={host} />));
    const sortKeys = await screen.findByLabelText('Sort keys', {}, { timeout: 10_000 });
    expect(line()).toBe(OFF);
    fireEvent.click(sortKeys);
    await act(async () => host.toolSettings.forTool('json').flush());
    expect(reset()).toBeNull();

    await act(async () => source.set(PRO));
    await waitFor(() => expect(line()).toContain(ON));
    // The choice made in the free edition is now kept, so the page offers its reset.
    await waitFor(() => expect(reset()).not.toBeNull());
    expect(document.contains(sortKeys)).toBe(true);
    expect(sortKeys.getAttribute('data-state')).toBe('checked');

    await act(async () => source.set(FREE));
    expect(line()).toBe(OFF);
    expect(reset()).toBeNull();
    expect(document.contains(sortKeys)).toBe(true);
    expect(sortKeys.getAttribute('data-state')).toBe('checked');
  }, 20_000);

  it('automatic copying follows at once: Generate copies by itself only while the edition in force has it', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    try {
      const source = switchableSource(FREE);
      const host = memoryHistoryHost(TOOLS, source);
      await host.toolSettings.setForAll(['password'], { [AUTO_COPY]: true });
      await act(async () => void render(<ToolsPage toolId="password" history={host} />));
      const output = await screen.findByLabelText('Generated password', {}, { timeout: 10_000 });
      await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Generate' })));
      expect(writeText).not.toHaveBeenCalled();
      await act(async () => source.set(PRO));
      await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Generate' })));
      expect(writeText.mock.calls).toEqual([[screen.getByLabelText('Generated password').textContent]]);
      expect(document.contains(output)).toBe(true);
      await act(async () => source.set(FREE));
      await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Generate' })));
      expect(writeText).toHaveBeenCalledTimes(1);
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard');
    }
  }, 20_000);
});
