import { ToolSettings } from './ToolSettings';
import { fakeStorage } from '@src/test/fakes';
import { TOOLS } from '@src/tools/registry';
import { extensionToolSettings, TOOL_SETTINGS_KEY } from '@src/tools/settings';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(cleanup);

describe('Settings → Tools', () => {
  it('one switch, off by default, with the tools it applies to — from their definitions', async () => {
    const storage = fakeStorage();
    const store = extensionToolSettings(storage.area, storage.onChanged);
    await store.ready;
    render(<ToolSettings host={{ toolSettings: store }} />);
    const sw = screen.getByRole('switch', { name: 'Copy automatically after generating' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    const generators = TOOLS.filter(t => t.output.origin === 'generated').map(t => t.title);
    expect(generators).toEqual(expect.arrayContaining(['UUID / ULID', 'Password Generator']));
    expect(document.querySelector('[data-applies]')?.textContent).toBe(`Applies to: ${generators.join(', ')}.`);
    for (const t of TOOLS.filter(t => t.output.origin === 'input'))
      expect(document.querySelector('[data-applies]')?.textContent).not.toContain(t.title);
  });

  it('flipping it upserts the value into the entry of every tool it applies to; another page follows live', async () => {
    const storage = fakeStorage();
    const first = extensionToolSettings(storage.area, storage.onChanged);
    const second = extensionToolSettings(storage.area, storage.onChanged);
    await Promise.all([first.ready, second.ready]);
    await first.forTool('password').set({ length: 24 });
    const a = render(<ToolSettings host={{ toolSettings: first }} />);
    const b = render(<ToolSettings host={{ toolSettings: second }} />);
    await act(async () => {
      fireEvent.click(within(a.container).getByRole('switch'));
    });
    const applies = TOOLS.filter(t => t.output.origin === 'generated').map(t => t.id);
    expect(storage.rows.get(TOOL_SETTINGS_KEY)).toEqual({
      v: 1,
      all: { autoCopy: true },
      tools: Object.fromEntries(
        applies.map(id => [id, id === 'password' ? { length: 24, autoCopy: true } : { autoCopy: true }]),
      ),
    });
    expect(applies).toEqual(expect.arrayContaining(['password', 'uuid']));
    expect(within(b.container).getByRole('switch').getAttribute('aria-checked')).toBe('true');
    expect(second.forTool('uuid').get().autoCopy).toBe(true);
    await act(async () => {
      fireEvent.click(within(b.container).getByRole('switch'));
    });
    expect(within(a.container).getByRole('switch').getAttribute('aria-checked')).toBe('false');
    expect(first.forTool('password').get()).toEqual({ length: 24, autoCopy: false });
  });
});
