import { fakeRemote } from './fakeRemote.testing';
import { memoryParameterStorage } from './parameterStorage';
import { PLACES } from './places.testing';
import { SAVE_AFTER_MS, WRITE_ATTEMPTS, createToolSettings, memoryToolSettingsArea } from './settings';
import { toolSettingsContract, toolSettingsHarness } from './settingsContract';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ParameterStorage } from './parameterStorage';
import type { ToolSettingsRecord } from './settings';

// The logic's contract over every implementation of seam `ParameterStorage` this package has, and the fake remote.
for (const [name, place] of PLACES)
  toolSettingsContract(`settings in memory, parameters ${name}`, () => {
    const area = memoryToolSettingsArea();
    return toolSettingsHarness(
      { area: () => area, stored: () => area.read(), seed: raw => area.write(raw as ToolSettingsRecord) },
      place(),
    );
  });

describe('the settings’ record and the saved parameters', () => {
  it('the parameters never reach the settings’ area; the settings still do', async () => {
    const area = memoryToolSettingsArea();
    const page = createToolSettings(area, memoryParameterStorage());
    await page.readyFor('json');
    const own = page.forTool('json');
    own.save(1, { indent: 4 });
    await own.flush();
    await own.set({ autoCopy: true });
    expect(own.saved()).toEqual({ schema: 1, values: { indent: 4 } });
    expect(await area.read()).toEqual({ v: 1, all: {}, tools: { json: { autoCopy: true } } });
  });

  it('what a parameter storage keeps in the same record is carried through a write of the settings, unread', async () => {
    const area = memoryToolSettingsArea();
    const params = { json: { schema: 1, values: { indent: 4 } }, url: 'damaged' };
    await area.write({ v: 1, all: {}, tools: {}, params });
    const page = createToolSettings(area, memoryParameterStorage());
    await page.readyFor('json');
    expect(page.forTool('json').saved()).toBeUndefined();
    await page.forTool('json').set({ autoCopy: true });
    expect(await area.read()).toEqual({ v: 1, all: {}, tools: { json: { autoCopy: true } }, params });
  });
});

describe.each(PLACES)('writes of saved parameters, kept %s', (_name, place) => {
  afterEach(() => void vi.useRealTimers());

  it('are delayed: changes in a row are one write, SAVE_AFTER_MS after the last', async () => {
    vi.useFakeTimers();
    const storage = place().open();
    const writes: unknown[] = [];
    const counted: ParameterStorage = {
      keeps: storage.keeps,
      read: toolId => storage.read(toolId),
      watch: listener => storage.watch(listener),
      write: (toolId, parameters, base) => {
        writes.push(parameters);
        return storage.write(toolId, parameters, base);
      },
    };
    const page = createToolSettings(memoryToolSettingsArea(), counted);
    void page.readyFor('password');
    await vi.advanceTimersByTimeAsync(50);
    const own = page.forTool('password');
    own.save(1, { length: 2 });
    await vi.advanceTimersByTimeAsync(SAVE_AFTER_MS - 50);
    own.save(1, { length: 24 });
    await vi.advanceTimersByTimeAsync(SAVE_AFTER_MS - 50);
    expect(writes).toHaveLength(0);
    expect(own.saved()).toEqual({ schema: 1, values: { length: 24 } });
    await vi.advanceTimersByTimeAsync(100);
    expect(writes).toEqual([{ schema: 1, values: { length: 24 } }]);
    // Asked again with nothing new: nothing is written twice.
    await vi.advanceTimersByTimeAsync(50);
    void own.flush();
    await vi.advanceTimersByTimeAsync(50);
    expect(writes).toHaveLength(1);
    expect(own.saved()).toEqual({ schema: 1, values: { length: 24 } });
  });
});

describe('a storage that does not behave', () => {
  const stubborn = (answer: () => ReturnType<ParameterStorage['write']>) => {
    let writes = 0;
    const storage: ParameterStorage = {
      keeps: true,
      read: async () => undefined,
      write: () => {
        writes++;
        return answer();
      },
      watch: () => () => undefined,
    };
    return { storage, writes: () => writes };
  };

  it('an entry that changes elsewhere through every attempt: the write is given up after WRITE_ATTEMPTS and held as failed', async () => {
    let revision = 0;
    const { storage, writes } = stubborn(async () => ({
      status: 'conflict',
      entry: { parameters: { schema: 1, values: { n: ++revision } }, revision: String(revision) },
    }));
    const page = createToolSettings(memoryToolSettingsArea(), storage);
    const own = page.forTool('json');
    own.save(1, { indent: 4 });
    await own.flush();
    expect(writes()).toBe(WRITE_ATTEMPTS);
    expect(own.unsaved()).toBe('failed');
    // What the tool reads: the entry the storage answered with last, with the person's change over it.
    expect(own.saved()).toEqual({ schema: 1, values: { n: WRITE_ATTEMPTS, indent: 4 } });
  });

  it('a write that throws is a refused write: nothing is thrown at the tool, the change is held', async () => {
    const { storage } = stubborn(() => Promise.reject(new Error('Extension context invalidated.')));
    const page = createToolSettings(memoryToolSettingsArea(), storage);
    const own = page.forTool('json');
    own.save(1, { indent: 4 });
    await expect(own.flush()).resolves.toBeUndefined();
    expect(own.unsaved()).toBe('failed');
    expect(own.saved()).toEqual({ schema: 1, values: { indent: 4 } });
    await expect(own.reset()).resolves.toBeUndefined();
    expect(own.saved()).toBeUndefined();
    expect(own.unsaved()).toBeUndefined();
  });

  it('a read that throws leaves the tool with its defaults', async () => {
    const storage: ParameterStorage = {
      ...memoryParameterStorage(),
      read: () => Promise.reject(new Error('closed')),
    };
    const page = createToolSettings(memoryToolSettingsArea(), storage);
    await expect(page.readyFor('json')).resolves.toBeUndefined();
    expect(page.forTool('json').saved()).toBeUndefined();
  });
});

describe('a remote storage above the same logic (the fake one: a delay, another device)', () => {
  const INDENT = { schema: 1, values: { indent: 4 } };

  it('a change made on another device reaches an open page: the store follows it, and the tool reads it when opened next', async () => {
    const remote = fakeRemote();
    const page = createToolSettings(memoryToolSettingsArea(), remote.connect());
    await page.readyFor('json');
    const own = page.forTool('json');
    own.declare(saved => saved !== undefined);
    let told = 0;
    own.subscribe(() => told++);
    expect(own.changed()).toBe(false);
    remote.elsewhere('json', INDENT);
    await remote.settle();
    expect(own.saved()).toEqual(INDENT);
    expect(own.changed()).toBe(true);
    expect(told).toBeGreaterThanOrEqual(1);
    remote.elsewhere('json', undefined);
    await remote.settle();
    expect(own.saved()).toBeUndefined();
    expect(own.changed()).toBe(false);
  });

  it('a change from another device that this page has not heard of yet: its own write meets a conflict and keeps both', async () => {
    const remote = fakeRemote({ delay: 5 });
    const page = createToolSettings(memoryToolSettingsArea(), remote.connect());
    await page.readyFor('json');
    const own = page.forTool('json');
    // On the server now; the report is still on its way when this page writes.
    remote.elsewhere('json', INDENT);
    own.save(1, { sortKeys: true });
    await own.flush();
    expect(remote.writes).toBe(2);
    expect(remote.held('json')).toEqual({ schema: 1, values: { indent: 4, sortKeys: true } });
    expect(own.saved()).toEqual({ schema: 1, values: { indent: 4, sortKeys: true } });
    // The same parameter on both sides: the one written last stays.
    remote.elsewhere('json', { schema: 1, values: { indent: 2, sortKeys: true } });
    own.save(1, { indent: 'tab' });
    await own.flush();
    await remote.settle();
    expect(remote.held('json')).toEqual({ schema: 1, values: { indent: 'tab', sortKeys: true } });
    expect(own.unsaved()).toBeUndefined();
  });

  it('two devices, each a page of its own: what one saved is what the other opens with', async () => {
    const remote = fakeRemote();
    const laptop = createToolSettings(memoryToolSettingsArea(), remote.connect());
    await laptop.readyFor('date-calc');
    laptop.forTool('date-calc').save(1, { zones: ['UTC', 'Asia/Tokyo'] });
    await laptop.forTool('date-calc').flush();
    const desktop = createToolSettings(memoryToolSettingsArea(), remote.connect());
    await desktop.readyFor('date-calc');
    expect(desktop.forTool('date-calc').saved()).toEqual({ schema: 1, values: { zones: ['UTC', 'Asia/Tokyo'] } });
  });

  it('opened while cut off: the tool opens with its defaults, and the kept entry arrives when the storage is back', async () => {
    const remote = fakeRemote();
    remote.seed('json', INDENT);
    const device = remote.connect();
    device.reach(false);
    const page = createToolSettings(memoryToolSettingsArea(), device);
    await page.readyFor('json');
    const own = page.forTool('json');
    expect(own.saved()).toBeUndefined();
    own.save(1, { sortKeys: true });
    await own.flush();
    expect(own.unsaved()).toBe('unavailable');
    device.reach(true);
    await remote.settle();
    expect(own.unsaved()).toBeUndefined();
    expect(remote.held('json')).toEqual({ schema: 1, values: { indent: 4, sortKeys: true } });
  });
});
