// @vitest-environment jsdom
import { memoryHost } from './host';
import {
  declareSettings,
  defaultsOf,
  differsFromDefaults,
  readSaved,
  setting,
  useSavedSettings,
  useSettingsReset,
} from './savedSettings';
import { createToolSettings, memoryToolSettingsArea } from './settings';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ToolHost } from './host';
import type { SavedSettings, SettingsValues } from './savedSettings';
import type { ToolSettingsRecord, ToolSettingsStore } from './settings';
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

const page = (area = memoryToolSettingsArea()) => {
  const settings = createToolSettings(area);
  return { area, settings, host: { ...memoryHost(), settings } satisfies ToolHost };
};
const stored = async (area: ReturnType<typeof memoryToolSettingsArea>) => (await area.read()) as ToolSettingsRecord;

describe('useSavedSettings', () => {
  it('works with no host at all: the defaults, changes kept in the page’s memory', () => {
    const view = render(<Probe />);
    expect(view.container.textContent).toBe('format 2');
    act(() => api!.set({ mode: 'minify' }));
    expect(view.container.textContent).toBe('minify 2');
  });

  it('opens with what was saved, field by field over the defaults', async () => {
    const { area, settings, host } = page();
    await area.write({
      v: 1,
      all: {},
      tools: {},
      params: { demo: { schema: 2, values: { indent: 'tab', ratio: 7 } } },
    });
    await settings.ready;
    const view = render(<Probe host={host} />);
    expect(view.container.textContent).toBe('format tab');
    expect(api!.values.ratio).toBe(0.5);
  });

  it('writes nothing until the person changes something; then only what differs from the defaults', async () => {
    const { area, settings, host } = page();
    await settings.ready;
    render(<Probe host={host} />);
    await settings.forTool('demo').flush();
    expect(await area.read()).toBeUndefined();
    act(() => api!.set({ mode: 'minify', length: 24 }));
    act(() => api!.set({ length: 20 }));
    await settings.forTool('demo').flush();
    expect((await stored(area)).params).toEqual({ demo: { schema: 2, values: { mode: 'minify' } } });
  });

  it('a value its field does not accept is shown, not saved (a number being typed)', async () => {
    const { area, settings, host } = page();
    await settings.ready;
    render(<Probe host={host} />);
    act(() => api!.set({ length: 2 }));
    expect(api!.values.length).toBe(2);
    await settings.forTool('demo').flush();
    expect(await area.read()).toBeUndefined();
  });

  it('visit shows a value for this visit and never writes it; a later set writes only the field the person changed', async () => {
    const { area, settings, host } = page();
    await area.write({ v: 1, all: {}, tools: {}, params: { demo: { schema: 2, values: { indent: 4 } } } });
    await settings.ready;
    render(<Probe host={host} />);
    act(() => api!.visit({ indent: 'tab', mode: 'minify' }));
    expect(api!.values).toMatchObject({ indent: 'tab', mode: 'minify' });
    await settings.forTool('demo').flush();
    expect((await stored(area)).params).toEqual({ demo: { schema: 2, values: { indent: 4 } } });
    act(() => api!.set({ sortKeys: true }));
    await settings.forTool('demo').flush();
    expect((await stored(area)).params).toEqual({ demo: { schema: 2, values: { indent: 4, sortKeys: true } } });
  });

  it('writes when the page is left, and a page opened next reads it', async () => {
    const { settings, host } = page();
    await settings.ready;
    const first = render(<Probe host={host} />);
    act(() => api!.set({ mode: 'minify' }));
    first.unmount();
    const again = render(<Probe host={host} />);
    expect(again.container.textContent).toBe('minify 2');
  });

  it('a damaged record does not break the tool: what is valid is used, the rest is the defaults; the next write cleans it', async () => {
    const { area, settings, host } = page();
    await area.write({
      v: 1,
      all: {},
      tools: {},
      params: { demo: { schema: 2, values: { mode: 'minify', indent: 'eight', zones: 'UTC', gone: 1 } } },
    } as unknown as ToolSettingsRecord);
    await settings.ready;
    const view = render(<Probe host={host} />);
    expect(view.container.textContent).toBe('minify 2');
    act(() => api!.set({ sortKeys: true }));
    await settings.forTool('demo').flush();
    expect((await stored(area)).params).toEqual({ demo: { schema: 2, values: { mode: 'minify', sortKeys: true } } });
  });

  it('an older schema’s values come migrated, and the first write keeps them under the new schema', async () => {
    const { area, settings, host } = page();
    await area.write({
      v: 1,
      all: {},
      tools: {},
      params: { demo: { schema: 1, values: { spaces: 4, mode: 'minify' } } },
    });
    await settings.ready;
    render(<Probe host={host} />);
    expect(api!.values).toMatchObject({ indent: 4, mode: 'minify' });
    act(() => api!.set({ sortKeys: true }));
    await settings.forTool('demo').flush();
    expect((await stored(area)).params).toEqual({
      demo: { schema: 2, values: { indent: 4, mode: 'minify', sortKeys: true } },
    });
  });
});

let reset: (() => void) | undefined;
const Page = ({ settings, host }: { settings: ToolSettingsStore | undefined; host: ToolHost }): ReactElement => {
  reset = useSettingsReset(settings, 'demo');
  return <Probe host={host} />;
};

describe('useSettingsReset (the host’s reset control)', () => {
  it('is offered only while the saved parameters differ from the defaults, and puts them back', async () => {
    const { area, settings, host } = page();
    await settings.ready;
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
    expect(await stored(area)).toEqual({ v: 1, all: {}, tools: {} });
  });

  it('a host that offers none passes no settings: never offered', async () => {
    const { area, settings, host } = page();
    await area.write({ v: 1, all: {}, tools: {}, params: { demo: { schema: 2, values: { indent: 4 } } } });
    await settings.ready;
    render(<Page settings={undefined} host={host} />);
    expect(reset).toBeUndefined();
  });

  it('is not offered before the tool’s page declares its parameters, nor for a damaged record that reads as the defaults', async () => {
    const { area, settings } = page();
    await area.write({ v: 1, all: {}, tools: {}, params: { demo: { schema: 2, values: { indent: 'x' } } } });
    await settings.ready;
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
