/**
 * The section with the companion (§8.5, §8.4): the demo and «Connect the companion» without the permission, the click
 * that asks and then connects, the companion's projects once connected, its states as text, the actions it does not
 * offer inactive with why, and the repository's strings — HTML, a terminal's escape sequences — drawn as text (S17).
 */
import { SidePanels } from './SidePanels';
import { HOSTILE_STRINGS } from '../../../../scripts/e2e-projects/companion.mjs';
import { ProjectsPage } from '../sections/ProjectsPage';
import { chosenBackend } from '@src/projects/behaviors';
import { fakeCompanion } from '@src/projects/companion/fakeLink';
import { createConnection } from '@src/projects/connection';
import { demoBackend } from '@src/projects/demo/backend';
import { memoryLayout } from '@src/projects/layoutMemory';
import { recordingSaver } from '@src/projects/scratch/fakeSaver';
import { memoryScratches } from '@src/projects/scratch/storage';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Route } from '../route';
import type { ProjectBackend } from '@src/projects/backend';
import type { ProjectsBehaviors } from '@src/projects/behaviors';
import type { PermissionGate } from '@src/projects/permission';

globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

const gate = (granted: boolean) => {
  const state = { granted, asked: 0 };
  const removed = new Set<() => void>();
  const permission: PermissionGate = {
    contains: () => Promise.resolve(state.granted),
    request: () => {
      state.asked++;
      state.granted = true;
      return Promise.resolve(true);
    },
    usable: () => state.granted,
    onAdded: () => () => undefined,
    onRemoved: l => (removed.add(l), () => removed.delete(l)),
  };
  return { permission, state, remove: () => removed.forEach(l => ((state.granted = false), l())) };
};

let backend: ProjectBackend;
const page = (route: Route) => {
  const behaviors: ProjectsBehaviors = {
    backend: Object.assign(() => backend, { id: 'test' }),
    autosaveDelayMs: 20,
    layout: SidePanels,
    layoutMemory: memoryLayout(),
    scratchStore: memoryScratches(),
    scratchSaver: recordingSaver(),
  };
  return render(<ProjectsPage route={route} behaviors={behaviors} />);
};
const make = (granted: boolean, options: Parameters<typeof fakeCompanion>[0] = {}) => {
  const fake = fakeCompanion(options);
  const chrome = gate(granted);
  backend = chosenBackend(
    createConnection({ permission: chrome.permission, openLink: fake.openLink, extension: '1', reload: vi.fn() }),
    demoBackend({ wait: () => Promise.resolve() }),
  );
  return { fake, chrome };
};
const connection = () => screen.getByRole('group', { name: 'Companion' });

beforeEach(() => {
  window.location.hash = '#/projects';
});
afterEach(() => cleanup());

describe('the section and the companion', () => {
  it('no permission: the demo with its notice, and «Connect the companion»; the click asks and connects', async () => {
    const { chrome } = make(false);
    page({ section: 'projects' });
    await screen.findByRole('group', { name: 'Work' });
    expect(screen.getByRole('note').textContent).toContain('invented projects');
    await waitFor(() => expect(connection().dataset.state).toBe('no-permission'));
    fireEvent.click(within(connection()).getByRole('button', { name: 'Connect the companion' }));
    expect(chrome.state.asked).toBe(1);
    await waitFor(() => expect(connection().dataset.state).toBe('ready'));
    expect(await screen.findByText('repo')).toBeTruthy();
    expect(screen.queryByRole('note')).toBeNull();
    // A companion of this stage lists no trusted folders: said, not failed.
    expect(screen.getByText('This companion does not list trusted folders yet.')).toBeTruthy();
  });

  it('not installed, not running, another version, no project: each said as text', async () => {
    const cases = [
      ['not-installed', () => make(true).fake, 'The companion is not installed. It runs on macOS only.'],
      ['not-running', () => make(true, { mode: 'not-running' }).fake, 'devtab doctor'],
      ['version-mismatch', () => make(true, { mode: 'version' }).fake, 'update the extension'],
      ['ready-empty', () => make(true, { mode: 'empty' }).fake, 'cd <project> && devtab add'],
    ] as const;
    for (const [state, setUp, text] of cases) {
      const fake = setUp();
      if (state === 'not-installed') fake.next = 'not-found';
      page({ section: 'projects' });
      await waitFor(() => expect(connection().dataset.state).toBe(state));
      await waitFor(() => expect(document.body.textContent).toContain(text));
      cleanup();
    }
  });

  it('a view project: the tree, the companion’s writes inactive with why, nothing failing', async () => {
    make(true);
    page({ section: 'projects', project: 'p_abcdefgh23' });
    const tree = await screen.findByRole('tree', { name: 'Files' });
    await waitFor(() => expect(tree.querySelector('[data-path="build"]')?.getAttribute('data-ignored')).toBe(''));
    expect(tree.querySelector('[data-path="link-out"]')?.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /^Commit/, pressed: false }));
    const commit = await screen.findByRole('region', { name: 'Commit' });
    // Nothing that would fail: the changes, and one line instead of the commit.
    expect(within(commit).queryByRole('button', { name: 'Commit' })).toBeNull();
    expect(within(commit).queryByRole('checkbox')).toBeNull();
    expect(within(commit).getByText(/its changes and diffs can be looked at, not committed/)).toBeTruthy();
    const makeMine = screen.getByRole('button', { name: 'Make writable…' });
    expect(makeMine.hasAttribute('disabled')).toBe(true);
    expect(makeMine.getAttribute('title')).toBe('This companion cannot do this yet.');
    expect(screen.queryByText(/^Failed/)).toBeNull();
  });

  it('the repository’s strings are text: no element made from them, escape sequences shown as symbols', async () => {
    make(true, { hostile: true });
    page({ section: 'projects' });
    const link = await screen.findByText(HOSTILE_STRINGS.name);
    expect(link.querySelector('img')).toBeNull();
    expect(document.querySelector('img, svg[onload], script:not([src])')).toBeNull();
    cleanup();
    make(true, { hostile: true });
    window.location.hash = '#/projects/p_hostile001';
    page({ section: 'projects', project: 'p_hostile001' });
    const tree = await screen.findByRole('tree', { name: 'Files' });
    await waitFor(() => expect(tree.textContent).toContain(HOSTILE_STRINGS.file));
    await waitFor(() => expect(document.body.textContent).toContain(HOSTILE_STRINGS.branch));
    expect((window as { __pwned?: number }).__pwned).toBeUndefined();
    // Find the line with escape sequences: they arrive as visible symbols.
    fireEvent.click(screen.getByRole('button', { name: 'Find in files', pressed: false }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Find in files' }), { target: { value: 'hostile' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find' }));
    await waitFor(() =>
      expect(document.querySelector('.kit-projects-results')?.textContent).toContain(
        'echo ␛[2J␛[31mhostile␛[0m <b>bold</b>',
      ),
    );
    expect(document.querySelector('.kit-projects-results b')).toBeNull();
    expect(document.body.textContent).not.toContain('\u001b');
  });

  it('the permission removed: back to the demo, the port closed by the page', async () => {
    const { fake, chrome } = make(true);
    page({ section: 'projects' });
    await waitFor(() => expect(connection().dataset.state).toBe('ready'));
    act(() => chrome.remove());
    await waitFor(() => expect(connection().dataset.state).toBe('no-permission'));
    expect(fake.ports[0]!.closedByPage).toBe(true);
    expect(await screen.findByRole('note')).toBeTruthy();
  });
});
