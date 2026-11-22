import { SAVE_AFTER_MS, createToolSettings, memoryToolSettingsArea } from './settings';
import { toolSettingsContract } from './settingsContract';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolSettingsRecord } from './settings';

toolSettingsContract('in memory', () => {
  const area = memoryToolSettingsArea();
  return {
    page: () => createToolSettings(area),
    stored: () => area.read(),
    seed: raw => area.write(raw as ToolSettingsRecord),
  };
});

describe('saved parameters in an area of their own (the free version: the page’s memory)', () => {
  it('never reach the settings’ area; the settings still do', async () => {
    const area = memoryToolSettingsArea();
    const page = createToolSettings(area, memoryToolSettingsArea());
    await page.ready;
    const own = page.forTool('json');
    own.save(1, { indent: 4 });
    await own.flush();
    await own.set({ autoCopy: true });
    expect(own.saved()).toEqual({ schema: 1, values: { indent: 4 } });
    expect(await area.read()).toEqual({ v: 1, all: {}, tools: { json: { autoCopy: true } } });
    // Another page has a memory of its own: it opens with nothing saved.
    const next = createToolSettings(area, memoryToolSettingsArea());
    await next.ready;
    expect(next.forTool('json').saved()).toBeUndefined();
    expect(next.forTool('json').get()).toEqual({ autoCopy: true });
  });

  it('do not read what a persistent build left in the settings’ area, and keep it as it was', async () => {
    const area = memoryToolSettingsArea();
    await area.write({ v: 1, all: {}, tools: {}, params: { json: { schema: 1, values: { indent: 4 } } } });
    const page = createToolSettings(area, memoryToolSettingsArea());
    await page.ready;
    expect(page.forTool('json').saved()).toBeUndefined();
    await page.forTool('json').set({ autoCopy: true });
    expect(((await area.read()) as ToolSettingsRecord).params).toEqual({ json: { schema: 1, values: { indent: 4 } } });
  });
});

describe('writes of saved parameters', () => {
  afterEach(() => void vi.useRealTimers());

  it('are debounced: changes in a row are one write, SAVE_AFTER_MS after the last', async () => {
    vi.useFakeTimers();
    const area = memoryToolSettingsArea();
    const writes: unknown[] = [];
    const counted = {
      ...area,
      write: async (r: ToolSettingsRecord) => {
        writes.push(r);
        await area.write(r);
      },
    };
    const page = createToolSettings(counted);
    await page.ready;
    const own = page.forTool('password');
    own.save(1, { length: 2 });
    await vi.advanceTimersByTimeAsync(SAVE_AFTER_MS - 50);
    own.save(1, { length: 24 });
    await vi.advanceTimersByTimeAsync(SAVE_AFTER_MS - 50);
    expect(writes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(writes).toHaveLength(1);
    expect(((await area.read()) as ToolSettingsRecord).params).toEqual({
      password: { schema: 1, values: { length: 24 } },
    });
  });

  it('a failed write leaves the page as it was and the next write carries on', async () => {
    const area = memoryToolSettingsArea();
    let fail = true;
    const flaky = {
      ...area,
      write: async (r: ToolSettingsRecord) => {
        if (fail) throw new Error('quota');
        await area.write(r);
      },
    };
    const page = createToolSettings(flaky);
    await page.ready;
    const own = page.forTool('json');
    own.save(1, { indent: 4 });
    await expect(own.flush()).rejects.toThrow('quota');
    fail = false;
    own.save(1, { sortKeys: true });
    await own.flush();
    expect(((await area.read()) as ToolSettingsRecord).params).toEqual({
      json: { schema: 1, values: { sortKeys: true } },
    });
  });
});
