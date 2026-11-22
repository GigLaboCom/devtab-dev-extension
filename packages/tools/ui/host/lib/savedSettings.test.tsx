// @vitest-environment jsdom
import { fakeRemote } from './fakeRemote.testing';
import { memoryHost } from './host';
import { memoryParameterStorage, noParameterStorage } from './parameterStorage';
import {
  SAVE_PROBLEM_TEXT,
  declareSettings,
  defaultsOf,
  differsFromDefaults,
  readSaved,
  setting,
  useSaveProblem,
  useSavedSettings,
  useSettingsReset,
} from './savedSettings';
import { createToolSettings, memoryToolSettingsArea } from './settings';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ToolHost } from './host';
import type { ParameterStorage, StoredParameters } from './parameterStorage';
import type { SavedSettings, SettingsValues } from './savedSettings';
import type { SaveProblem, ToolSettingsStore } from './settings';
import type { ReactElement } from 'react';

afterEach(cleanup);

const demo = declareSettings({
  schema: 2,
  fields: {
    mode: setting.oneOf(['format', 'minify'], 'format'),
    indent: setting.oneOf([2, 4, 'tab'], 2),
    sortKeys: setting.boolean(false),
    length: setting.integer({ min: 4, max: 128 }, 20),
    ratio: setting.number({ min: 0, max: 1 }, 0.5),
    symbols: setting.text({ maxLength: 8, test: s => /^[!-~]*$/.test(s) }, '!@#'),
    zones: setting.list({ maxItems: 3, item: s => /^[A-Za-z_/]+$/.test(s) }, ['UTC']),
  },
  migrate: (from, values) => (from === 1 ? { ...values, indent: values.spaces } : values),
});
type Demo = SettingsValues<typeof demo>;
const DEFAULTS: Demo = defaultsOf(demo);

describe('the declaration', () => {
  it('reads nothing stored as the defaults', () => {
    expect(readSaved(demo, undefined)).toEqual({
      mode: 'format',
      indent: 2,
      sortKeys: false,
      length: 20,
      ratio: 0.5,
      symbols: '!@#',
      zones: ['UTC'],
    });
    expect(differsFromDefaults(demo, undefined)).toBe(false);
  });

  it('falls back field by field: wrong type, outside the allowed values, a repeat in a list; drops unknown fields', () => {
    const read = readSaved(demo, {
      schema: 2,
      values: {
        mode: 'minify',
        indent: 3,
        sortKeys: 'yes',
        length: 24.5,
        ratio: 0.25,
        symbols: 'é',
        zones: ['UTC', 'UTC'],
        unknown: true,
      },
    });
    expect(read).toEqual({ ...DEFAULTS, mode: 'minify', ratio: 0.25 });
    expect('unknown' in read).toBe(false);
    expect(readSaved(demo, { schema: 2, values: { length: 3, zones: ['A', 'B', 'C', 'D'] } })).toEqual(DEFAULTS);
    expect(readSaved(demo, { schema: 2, values: { length: 128, zones: ['Europe/Berlin'] } })).toMatchObject({
      length: 128,
      zones: ['Europe/Berlin'],
    });
  });

  it('values of an older schema go through migrate; of a newer one (a later release) they are not used', () => {
    expect(readSaved(demo, { schema: 1, values: { spaces: 4, mode: 'minify' } })).toMatchObject({
      indent: 4,
      mode: 'minify',
    });
    expect(readSaved(demo, { schema: 3, values: { mode: 'minify' } })).toEqual(DEFAULTS);
    const plain = declareSettings({ schema: 2, fields: { on: setting.boolean(false) } });
    expect(readSaved(plain, { schema: 1, values: { on: true } })).toEqual({ on: false });
  });

  it('differs from the defaults only when a field read from storage does', () => {
    expect(differsFromDefaults(demo, { schema: 2, values: { indent: 2, mode: 'nope' } })).toBe(false);
    expect(differsFromDefaults(demo, { schema: 2, values: { zones: ['UTC', 'Asia/Tokyo'] } })).toBe(true);
  });
});

let api: SavedSettings<Demo> | undefined;
let resetTo: Demo | undefined;
const Probe = ({ host }: { host?: ToolHost }): ReactElement => {
  api = useSavedSettings(host, 'demo', demo, { onReset: d => (resetTo = d) });
  return <p>{`${api.values.mode} ${String(api.values.indent)}`}</p>;
};

/** A page of a host over a storage (in memory unless given), with what the storage holds for the tool and a way in. */
const page = (storage: ParameterStorage = memoryParameterStorage()) => {
  const settings = createToolSettings(memoryToolSettingsArea(), storage);
  return {
    settings,
    host: { ...memoryHost(), settings } satisfies ToolHost,
    stored: async () => (await storage.read('demo'))?.parameters,
    seed: async (parameters: unknown) =>
      void (await storage.write('demo', parameters as StoredParameters, (await storage.read('demo'))?.revision)),
  };
};

describe('useSavedSettings', () => {
  it('works with no host at all: the defaults, changes kept in the page’s memory', () => {
    const view = render(<Probe />);
    expect(view.container.textContent).toBe('format 2');
    act(() => api!.set({ mode: 'minify' }));
    expect(view.container.textContent).toBe('minify 2');
  });

  it('opens with what was saved, field by field over the defaults', async () => {
    const { seed, settings, host } = page();
    await seed({ schema: 2, values: { indent: 'tab', ratio: 7 } });
    await settings.readyFor('demo');
    const view = render(<Probe host={host} />);
    expect(view.container.textContent).toBe('format tab');
    expect(api!.values.ratio).toBe(0.5);
  });

  it('writes nothing until the person changes something; then only what differs from the defaults', async () => {
    const { stored, settings, host } = page();
    await settings.readyFor('demo');
    render(<Probe host={host} />);
    await settings.forTool('demo').flush();
    expect(await stored()).toBeUndefined();
    act(() => api!.set({ mode: 'minify', length: 24 }));
    act(() => api!.set({ length: 20 }));
    await settings.forTool('demo').flush();
    expect(await stored()).toEqual({ schema: 2, values: { mode: 'minify' } });
  });

  it('a value its field does not accept is shown, not saved (a number being typed)', async () => {
    const { stored, settings, host } = page();
    await settings.readyFor('demo');
    render(<Probe host={host} />);
    act(() => api!.set({ length: 2 }));
    expect(api!.values.length).toBe(2);
    await settings.forTool('demo').flush();
    expect(await stored()).toBeUndefined();
  });

  it('visit shows a value for this visit and never writes it; a later set writes only the field the person changed', async () => {
    const { seed, stored, settings, host } = page();
    await seed({ schema: 2, values: { indent: 4 } });
    await settings.readyFor('demo');
    render(<Probe host={host} />);
    act(() => api!.visit({ indent: 'tab', mode: 'minify' }));
    expect(api!.values).toMatchObject({ indent: 'tab', mode: 'minify' });
    await settings.forTool('demo').flush();
    expect(await stored()).toEqual({ schema: 2, values: { indent: 4 } });
    act(() => api!.set({ sortKeys: true }));
    await settings.forTool('demo').flush();
    expect(await stored()).toEqual({ schema: 2, values: { indent: 4, sortKeys: true } });
  });

  it('writes when the page is left, and a page opened next reads it', async () => {
    const { settings, host } = page();
    await settings.readyFor('demo');
    const first = render(<Probe host={host} />);
    act(() => api!.set({ mode: 'minify' }));
    first.unmount();
    const again = render(<Probe host={host} />);
    expect(again.container.textContent).toBe('minify 2');
  });

  it('a host whose storage is switched off: the choice lives while the page does, and nothing is kept', async () => {
    const { stored, settings, host } = page(noParameterStorage());
    await settings.readyFor('demo');
    const first = render(<Probe host={host} />);
    act(() => api!.set({ mode: 'minify' }));
    first.unmount();
    await settings.forTool('demo').flush();
    expect(await stored()).toBeUndefined();
    const again = render(<Probe host={host} />);
    expect(again.container.textContent).toBe('minify 2');
  });

  it('a damaged record does not break the tool: what is valid is used, the rest is the defaults; the next write cleans it', async () => {
    const { seed, stored, settings, host } = page();
    await seed({ schema: 2, values: { mode: 'minify', indent: 'eight', zones: 'UTC', gone: 1 } });
    await settings.readyFor('demo');
    const view = render(<Probe host={host} />);
    expect(view.container.textContent).toBe('minify 2');
    act(() => api!.set({ sortKeys: true }));
    await settings.forTool('demo').flush();
    expect(await stored()).toEqual({ schema: 2, values: { mode: 'minify', sortKeys: true } });
  });

  it('an older schema’s values come migrated, and the first write keeps them under the new schema', async () => {
    const { seed, stored, settings, host } = page();
    await seed({ schema: 1, values: { spaces: 4, mode: 'minify' } });
    await settings.readyFor('demo');
    render(<Probe host={host} />);
    expect(api!.values).toMatchObject({ indent: 4, mode: 'minify' });
    act(() => api!.set({ sortKeys: true }));
    await settings.forTool('demo').flush();
    expect(await stored()).toEqual({ schema: 2, values: { indent: 4, mode: 'minify', sortKeys: true } });
  });
});

let reset: (() => void) | undefined;
let problem: SaveProblem | undefined;
const Page = ({ settings, host }: { settings: ToolSettingsStore | undefined; host: ToolHost }): ReactElement => {
  reset = useSettingsReset(settings, 'demo');
  problem = useSaveProblem(settings, 'demo');
  return <Probe host={host} />;
};

describe('useSettingsReset (the host’s reset control)', () => {
  it('is offered only while the saved parameters differ from the defaults, and puts them back', async () => {
    const { stored, settings, host } = page();
    await settings.readyFor('demo');
    const view = render(<Page settings={settings} host={host} />);
    expect(reset).toBeUndefined();
    act(() => api!.set({ mode: 'minify', zones: ['UTC', 'Asia/Tokyo'] }));
    expect(reset).toBeTypeOf('function');
    act(() => api!.set({ mode: 'format', zones: ['UTC'] }));
    expect(reset).toBeUndefined();
    act(() => api!.set({ indent: 4 }));
    act(() => api!.visit({ mode: 'minify' }));
    await act(async () => reset!());
    expect(view.container.textContent).toBe('format 2');
    expect(api!.values).toEqual(DEFAULTS);
    expect(resetTo).toEqual(DEFAULTS);
    expect(reset).toBeUndefined();
    await settings.forTool('demo').flush();
    expect(await stored()).toBeUndefined();
  });

  it('a host that offers none passes no settings: never offered', async () => {
    const { seed, settings, host } = page();
    await seed({ schema: 2, values: { indent: 4 } });
    await settings.readyFor('demo');
    render(<Page settings={undefined} host={host} />);
    expect(reset).toBeUndefined();
  });

  it('is never offered over a storage that is switched off: there is nothing kept to put back', async () => {
    const { settings, host } = page(noParameterStorage());
    await settings.readyFor('demo');
    const view = render(<Page settings={settings} host={host} />);
    act(() => api!.set({ mode: 'minify', zones: ['UTC', 'Asia/Tokyo'] }));
    expect(view.container.textContent).toBe('minify 2');
    expect(reset).toBeUndefined();
    expect(problem).toBeUndefined();
  });

  it('is not offered before the tool’s page declares its parameters, nor for a damaged record that reads as the defaults', async () => {
    const { seed, settings } = page();
    await seed({ schema: 2, values: { indent: 'x' } });
    await settings.readyFor('demo');
    const Lone = (): ReactElement => {
      reset = useSettingsReset(settings, 'demo');
      return <p />;
    };
    render(<Lone />);
    expect(reset).toBeUndefined();
    cleanup();
    render(<Page settings={settings} host={{ ...memoryHost(), settings }} />);
    expect(reset).toBeUndefined();
  });
});

describe('useSaveProblem (what the host’s tool page says while a write is refused)', () => {
  it('nothing while writes are taken; `failed` while the storage refuses, with the tool still showing the choice; nothing again once a write is taken', async () => {
    const remote = fakeRemote();
    const { settings, host } = page(remote.connect());
    await settings.readyFor('demo');
    const view = render(<Page settings={settings} host={host} />);
    act(() => api!.set({ mode: 'minify' }));
    await act(async () => settings.forTool('demo').flush());
    expect(problem).toBeUndefined();
    remote.refuse(true);
    act(() => api!.set({ indent: 4 }));
    await act(async () => settings.forTool('demo').flush());
    expect(problem).toBe('failed');
    expect(SAVE_PROBLEM_TEXT[problem!]).toBe(
      'Settings could not be saved. They stay as you set them until this page is closed.',
    );
    expect(view.container.textContent).toBe('minify 4');
    expect(remote.held('demo')).toEqual({ schema: 2, values: { mode: 'minify' } });
    // Left and opened again in the same page: still as the person set it.
    view.unmount();
    const again = render(<Page settings={settings} host={host} />);
    await act(async () => settings.forTool('demo').flush());
    expect(again.container.textContent).toBe('minify 4');
    expect(problem).toBe('failed');
    remote.refuse(false);
    act(() => api!.set({ sortKeys: true }));
    await act(async () => settings.forTool('demo').flush());
    expect(problem).toBeUndefined();
    expect(remote.held('demo')).toEqual({ schema: 2, values: { mode: 'minify', indent: 4, sortKeys: true } });
  });

  it('`unavailable` while the storage cannot be reached, and nothing once it is back — without the person doing anything', async () => {
    const remote = fakeRemote();
    const device = remote.connect();
    const { settings, host } = page(device);
    await settings.readyFor('demo');
    render(<Page settings={settings} host={host} />);
    device.reach(false);
    act(() => api!.set({ mode: 'minify' }));
    await act(async () => settings.forTool('demo').flush());
    expect(problem).toBe('unavailable');
    expect(SAVE_PROBLEM_TEXT[problem!]).toBe(
      'Settings are not saved yet: storage is unavailable. They stay as you set them until this page is closed.',
    );
    await act(async () => {
      device.reach(true);
      await remote.settle();
    });
    expect(problem).toBeUndefined();
    expect(remote.held('demo')).toEqual({ schema: 2, values: { mode: 'minify' } });
  });

  it('a host that passes no settings says nothing', () => {
    render(<Page settings={undefined} host={memoryHost()} />);
    expect(problem).toBeUndefined();
  });
});
