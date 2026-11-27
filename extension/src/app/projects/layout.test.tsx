/**
 * The panels around the editor (D35, SidePanels.tsx) on the demo: Files open and the bottom panel collapsed at first;
 * the Commit view's switch and its count; the view showing collapses its panel and a strip of switches stays; the
 * borders moved by the keyboard and reset by a double click; what is remembered and read back; a narrow start; a
 * search or a file's history asked for opens the bottom panel; a view keeps its state while another shows.
 */
import { SidePanels } from './SidePanels';
import { ProjectsPage } from '../sections/ProjectsPage';
import { demoBackend } from '@src/projects/demo/backend';
import {
  BOTTOM_HEIGHT,
  DEFAULT_LAYOUT,
  RESIZE_STEP,
  RESIZE_STEP_LARGE,
  SIDE_MAX,
  SIDE_MIN,
  SIDE_WIDTH,
} from '@src/projects/layout';
import { memoryLayout } from '@src/projects/layoutMemory';
import { recordingSaver } from '@src/projects/scratch/fakeSaver';
import { memoryScratches } from '@src/projects/scratch/storage';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Route } from '../route';
import type { DemoBackend } from '@src/projects/demo/backend';
import type { ProjectsLayout } from '@src/projects/layout';
import type { LayoutMemory } from '@src/projects/layoutMemory';

const LEDGER = 'p_demo0ledgr';

globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

let backend: DemoBackend;
const show = (memory: LayoutMemory = memoryLayout(), route: Route = { section: 'projects', project: LEDGER }) =>
  render(
    <ProjectsPage
      route={route}
      behaviors={{
        backend: Object.assign(() => backend, { id: 'demo' }),
        autosaveDelayMs: 20,
        layout: SidePanels,
        layoutMemory: memory,
        scratchStore: memoryScratches(),
        scratchSaver: recordingSaver(),
      }}
    />,
  );
/** A panel's switch: the button of that name that is a toggle (the Commit window has a «Commit» button too). */
const switchOf = (name: string | RegExp): HTMLElement => {
  const found = screen.getAllByRole('button', { name }).filter(b => b.hasAttribute('aria-pressed'));
  if (found.length !== 1) throw new Error(`${found.length} switches named ${String(name)}`);
  return found[0]!;
};
const pressed = (name: string | RegExp) => switchOf(name).getAttribute('aria-pressed');
const separator = (name: string) => screen.getByRole('separator', { name });
const sidePanel = () => document.getElementById('projects-side')!;

beforeEach(() => {
  backend = demoBackend({ wait: () => Promise.resolve() });
  window.location.hash = `#/projects/${LEDGER}`;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the panels', () => {
  it('start with Files open and the bottom panel collapsed', async () => {
    show();
    expect(await screen.findByRole('tree', { name: 'Files' })).toBeTruthy();
    expect(pressed('Files')).toBe('true');
    expect(pressed(/^Commit/)).toBe('false');
    expect(pressed('History')).toBe('false');
    expect(pressed('Find in files')).toBe('false');
    expect(separator('Resize the side panel').getAttribute('aria-valuenow')).toBe(String(SIDE_WIDTH));
    expect(screen.queryByRole('separator', { name: 'Resize the bottom panel' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Show the bottom panel' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('region', { name: 'Commit' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'History' })).toBeNull();
  });

  it('the Commit view’s switch counts the changed files; pressed, it shows the Commit window', async () => {
    show();
    const files = (await backend.call('git.status', { project: LEDGER })).files.length;
    const commit = await screen.findByRole('button', { name: `Commit, ${files} changed files` });
    expect(commit.querySelector('.kit-projects-badge')?.textContent).toBe(String(files));
    fireEvent.click(commit);
    expect(await screen.findByRole('region', { name: 'Commit' })).toBeTruthy();
    expect(pressed(/^Commit/)).toBe('true');
    expect(pressed('Files')).toBe('false');
    expect(screen.queryByRole('tree', { name: 'Files' })).toBeNull();
  });

  it('pressing the view that shows collapses the side panel to a strip of switches; a switch opens it again', async () => {
    show();
    await screen.findByRole('tree', { name: 'Files' });
    fireEvent.click(switchOf('Files'));
    expect(sidePanel().dataset.open).toBe('false');
    expect(screen.queryByRole('tree', { name: 'Files' })).toBeNull();
    expect(screen.queryByRole('separator', { name: 'Resize the side panel' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hide the side panel' })).toBeNull();
    // The strip: both switches, the count, neither pressed.
    expect(pressed('Files')).toBe('false');
    expect(pressed(/^Commit, \d+ changed files$/)).toBe('false');
    fireEvent.click(switchOf(/^Commit/));
    expect(sidePanel().dataset.open).toBe('true');
    expect(await screen.findByRole('region', { name: 'Commit' })).toBeTruthy();
  });

  it('the hide button collapses the side panel and leaves the keys on the view’s switch', async () => {
    show();
    await screen.findByRole('tree', { name: 'Files' });
    fireEvent.click(screen.getByRole('button', { name: 'Hide the side panel' }));
    expect(sidePanel().dataset.open).toBe('false');
    expect(document.activeElement).toBe(switchOf('Files'));
  });

  it('a border moves by the arrow keys, Home and End go to the limits, a double click resets it; each is remembered', async () => {
    const memory = memoryLayout();
    show(memory);
    const side = await screen.findByRole('separator', { name: 'Resize the side panel' });
    const width = () => Number(side.getAttribute('aria-valuenow'));
    fireEvent.keyDown(side, { key: 'ArrowRight' });
    expect(width()).toBe(SIDE_WIDTH + RESIZE_STEP);
    fireEvent.keyDown(side, { key: 'ArrowRight', shiftKey: true });
    expect(width()).toBe(SIDE_WIDTH + RESIZE_STEP + RESIZE_STEP_LARGE);
    fireEvent.keyDown(side, { key: 'ArrowLeft' });
    expect(width()).toBe(SIDE_WIDTH + RESIZE_STEP_LARGE);
    expect(sidePanel().style.width).toBe(`${SIDE_WIDTH + RESIZE_STEP_LARGE}px`);
    expect(memory.initial()?.side.width).toBe(SIDE_WIDTH + RESIZE_STEP_LARGE);
    fireEvent.keyDown(side, { key: 'Home' });
    expect(width()).toBe(SIDE_MIN);
    fireEvent.keyDown(side, { key: 'End' });
    expect(width()).toBe(SIDE_MAX);
    expect(side.getAttribute('aria-valuemin')).toBe(String(SIDE_MIN));
    expect(side.getAttribute('aria-orientation')).toBe('vertical');
    fireEvent.doubleClick(side);
    expect(width()).toBe(SIDE_WIDTH);
    expect(memory.initial()?.side.width).toBe(SIDE_WIDTH);

    fireEvent.click(switchOf('History'));
    const bottom = separator('Resize the bottom panel');
    expect(bottom.getAttribute('aria-orientation')).toBe('horizontal');
    expect(bottom.getAttribute('aria-valuenow')).toBe(String(BOTTOM_HEIGHT));
    // Up makes the bottom panel taller.
    fireEvent.keyDown(bottom, { key: 'ArrowUp' });
    expect(bottom.getAttribute('aria-valuenow')).toBe(String(BOTTOM_HEIGHT + RESIZE_STEP));
    expect(document.getElementById('projects-bottom')!.style.height).toBe(`${BOTTOM_HEIGHT + RESIZE_STEP}px`);
    expect(memory.initial()?.bottom).toMatchObject({
      open: true,
      view: 'history',
      height: BOTTOM_HEIGHT + RESIZE_STEP,
    });
  });

  it('the bottom panel: a tab opens it on its view, pressed again it collapses; its button hides and shows it', async () => {
    show();
    await screen.findByRole('tree', { name: 'Files' });
    fireEvent.click(switchOf('Find in files'));
    expect(screen.getByRole('textbox', { name: 'Find in files' })).toBeTruthy();
    fireEvent.click(switchOf('History'));
    expect(await screen.findByRole('region', { name: 'History' })).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Find in files' })).toBeNull();
    fireEvent.click(switchOf('History'));
    expect(screen.queryByRole('region', { name: 'History' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show the bottom panel' }));
    expect(await screen.findByRole('region', { name: 'History' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hide the bottom panel' }));
    expect(screen.queryByRole('region', { name: 'History' })).toBeNull();
  });

  it('a remembered layout is what the page starts with, and changes are read back by the next visit', async () => {
    const start: ProjectsLayout = {
      version: 1,
      side: { open: false, view: 'commit', width: 400 },
      bottom: { open: true, view: 'find', height: 300 },
    };
    const memory = memoryLayout(start);
    show(memory);
    expect(await screen.findByRole('textbox', { name: 'Find in files' })).toBeTruthy();
    expect(sidePanel().dataset.open).toBe('false');
    expect(separator('Resize the bottom panel').getAttribute('aria-valuenow')).toBe('300');
    fireEvent.click(switchOf(/^Commit/));
    expect(sidePanel().style.width).toBe('400px');
    cleanup();
    show(memory);
    expect(await screen.findByRole('region', { name: 'Commit' })).toBeTruthy();
    expect(memory.initial()).toEqual({ ...start, side: { ...start.side, open: true } });
  });

  it('the stored layout arrives after the first render unless the person was quicker', async () => {
    let answer: (layout: ProjectsLayout) => void = () => undefined;
    const memory: LayoutMemory = {
      initial: () => null,
      load: () => new Promise(resolve => (answer = resolve)),
      save: vi.fn(),
    };
    show(memory);
    await screen.findByRole('tree', { name: 'Files' });
    answer({ ...DEFAULT_LAYOUT, bottom: { ...DEFAULT_LAYOUT.bottom, open: true } });
    expect(await screen.findByRole('region', { name: 'History' })).toBeTruthy();
  });

  it('a narrow start collapses the side panel for this visit, without changing what is remembered', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('kit-projects-workspace') ? 601 : 0;
    });
    const memory = memoryLayout();
    const save = vi.spyOn(memory, 'save');
    show(memory);
    await waitFor(() => expect(sidePanel().dataset.open).toBe('false'));
    expect(save).not.toHaveBeenCalled();
    // The editor keeps its minimum: the side panel may be at most what the workspace leaves.
    fireEvent.click(switchOf('Files'));
    expect(separator('Resize the side panel').getAttribute('aria-valuemax')).toBe('280');
  });

  it('a search started from the bar opens find in files with the keys in its field; «Show history» opens the history', async () => {
    show(memoryLayout(), { section: 'projects', project: LEDGER, path: 'src/server.ts' });
    fireEvent.click(await screen.findByRole('button', { name: 'Find in files…' }));
    const field = await screen.findByRole('textbox', { name: 'Find in files' });
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(pressed('Find in files')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Show history' }));
    const history = await screen.findByRole('region', { name: 'History' });
    expect(within(history).getByRole('radio', { name: 'This file' }).getAttribute('aria-checked')).toBe('true');
    // Asked again, it stays open.
    fireEvent.click(screen.getByRole('button', { name: 'Show history' }));
    expect(await screen.findByRole('region', { name: 'History' })).toBeTruthy();
  });

  it('a view keeps its state while another shows: the commit message survives a look at the files', async () => {
    show();
    fireEvent.click(await screen.findByRole('button', { name: /^Commit,/ }));
    const panel = await screen.findByRole('region', { name: 'Commit' });
    fireEvent.change(within(panel).getByPlaceholderText('Commit message'), { target: { value: 'Keep me' } });
    fireEvent.click(switchOf('Files'));
    expect(await screen.findByRole('tree', { name: 'Files' })).toBeTruthy();
    fireEvent.click(switchOf(/^Commit/));
    const again = await screen.findByRole('region', { name: 'Commit' });
    expect((within(again).getByPlaceholderText('Commit message') as HTMLTextAreaElement).value).toBe('Keep me');
  });

  it('a read-only project: the changes and their chunks, one line instead of the commit, nothing to check', async () => {
    await backend.call('project.setView', { project: LEDGER });
    show();
    fireEvent.click(await screen.findByRole('button', { name: /^Commit,/ }));
    const panel = await screen.findByRole('region', { name: 'Commit' });
    await within(panel).findByRole('group', { name: 'Changes' });
    expect(within(panel).getByText(/its changes and diffs can be looked at, not committed/)).toBeTruthy();
    expect(within(panel).queryByRole('checkbox')).toBeNull();
    expect(within(panel).queryByRole('textbox')).toBeNull();
    expect(within(panel).queryByRole('button', { name: 'Commit' })).toBeNull();
    expect(within(panel).queryByRole('button', { name: 'Commit and Push…' })).toBeNull();
    expect(within(panel).queryByRole('button', { name: 'Rollback…' })).toBeNull();
    // A changed file still opens its diff, and its chunks are listed to jump to.
    fireEvent.click(within(panel).getByRole('button', { name: /^src\/server\.ts/ }));
    const chunks = await within(panel).findByRole('group', { name: 'Chunks of src/server.ts' });
    expect(within(chunks).getAllByRole('button').length).toBeGreaterThan(0);
    expect(within(chunks).queryByRole('checkbox')).toBeNull();
  });
});
