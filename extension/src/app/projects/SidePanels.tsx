/**
 * The default `WorkspaceLayout` (D35): the arrangement IntelliJ IDEA and VS Code share. On the left one side panel with
 * two views — Files and Commit (IntelliJ's Project and Commit tool windows of one stripe, VS Code's Explorer and Source
 * Control of one side bar) — the Commit view's switch carrying the number of changed files; the editor in the centre,
 * taking what is left; below it a panel with History and Find in files, collapsed until it is wanted.
 *
 * A view's switch is a toggle button (`aria-pressed`): pressed, the view shows; pressed again, its panel collapses —
 * both IDEs do this. A collapsed side panel leaves its switches as a narrow strip; a collapsed bottom panel leaves its
 * tab row. The borders between the panels move (./Splitter.tsx). A view is mounted the first time it shows and then kept
 * (hidden while another shows), so a commit message, a search or an opened folder survive a switch.
 */
import { Splitter } from './Splitter';
import { TEXT } from './text';
import { usePanels } from './usePanels';
import { BOTTOM_MIN, SIDE_MIN } from '@src/projects/layout';
import { Button } from '@workspace/ui/button';
import { Toggle } from '@workspace/ui/toggle';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  FilesIcon,
  GitCommitHorizontalIcon,
  HistoryIcon,
  PanelLeftCloseIcon,
  TextSearchIcon,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { WorkspaceLayout, WorkspaceLayoutProps } from './workspaceLayout';
import type { BottomView, PanelView, SideView } from '@src/projects/layout';
import type { LucideIcon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';

const SIDE: readonly { view: SideView; label: string; Icon: LucideIcon }[] = [
  { view: 'files', label: TEXT.treeLabel, Icon: FilesIcon },
  { view: 'commit', label: TEXT.commitTitle, Icon: GitCommitHorizontalIcon },
];
const BOTTOM: readonly { view: BottomView; label: string; Icon: LucideIcon }[] = [
  { view: 'history', label: TEXT.historyLabel, Icon: HistoryIcon },
  { view: 'find', label: TEXT.searchLabel, Icon: TextSearchIcon },
];

const switchId = (view: PanelView): string => `projects-switch-${view}`;
const viewId = (view: PanelView): string => `projects-view-${view}`;

const SidePanelsLayout = ({ parts, changes, memory, reveal }: WorkspaceLayoutProps): ReactElement => {
  const workspace = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const panels = usePanels(memory, workspace, column);
  const { side, bottom } = panels.layout;

  // A view is mounted once it has shown, and kept.
  const seen = useRef(new Set<PanelView>());
  if (side.open) seen.current.add(side.view);
  if (bottom.open) seen.current.add(bottom.view);

  // A view asked for from outside: it shows; find in files takes the keys.
  const focusFind = useRef(false);
  useEffect(() => {
    if (!reveal) return;
    panels.reveal(reveal.view);
    if (reveal.view === 'find') focusFind.current = true;
    // Only a new request reveals.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal?.n]);
  useEffect(() => {
    if (!focusFind.current || !bottom.open || bottom.view !== 'find') return;
    focusFind.current = false;
    document.getElementById(viewId('find'))?.querySelector<HTMLInputElement>('input')?.focus();
  });

  const view = (id: PanelView, showing: boolean, part: ReactNode): ReactElement => (
    <div id={viewId(id)} className="kit-projects-view" data-view={id} hidden={!showing}>
      {seen.current.has(id) && part}
    </div>
  );

  const switches = (
    items: readonly { view: PanelView; label: string; Icon: LucideIcon }[],
    open: boolean,
    current: PanelView,
  ): ReactElement[] =>
    items.map(({ view: id, label, Icon }) => {
      const count = id === 'commit' && changes ? changes : 0;
      const name = count ? TEXT.withChanges(label, count) : label;
      return (
        <Toggle
          key={id}
          id={switchId(id)}
          size="sm"
          className="kit-projects-switch"
          data-view={id}
          pressed={open && current === id}
          aria-controls={viewId(id)}
          aria-label={name}
          title={name}
          onPressedChange={() => panels.press(id)}>
          <Icon aria-hidden="true" />
          <span className="kit-projects-switch-label">{label}</span>
          {count > 0 && (
            <span className="kit-projects-badge" aria-hidden="true">
              {count}
            </span>
          )}
        </Toggle>
      );
    });

  return (
    <div ref={workspace} className="kit-projects-workspace">
      <div
        id="projects-side"
        className="kit-projects-side"
        data-open={side.open}
        style={{ width: side.open ? panels.sideWidth : undefined }}>
        <div className="kit-projects-side-head">
          <div className="kit-projects-switches" role="group" aria-label={TEXT.sidePanel}>
            {switches(SIDE, side.open, side.view)}
          </div>
          {side.open && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="kit-projects-panel-hide"
              aria-label={TEXT.hideSidePanel}
              title={TEXT.hideSidePanel}
              onClick={() => {
                panels.collapse('side');
                document.getElementById(switchId(side.view))?.focus();
              }}>
              <PanelLeftCloseIcon aria-hidden="true" />
            </Button>
          )}
        </div>
        <div className="kit-projects-side-body" hidden={!side.open}>
          {view('files', side.view === 'files', parts.files)}
          {view('commit', side.view === 'commit', parts.commit)}
        </div>
      </div>
      {side.open && (
        <Splitter
          axis="x"
          grows={1}
          value={panels.sideWidth}
          min={SIDE_MIN}
          max={panels.sideMax}
          label={TEXT.resizeSidePanel}
          controls="projects-side"
          onResize={(size, done) => panels.resize('side', size, done)}
          onReset={() => panels.reset('side')}
        />
      )}
      <div ref={column} className="kit-projects-column">
        {parts.editor}
        {bottom.open && (
          <Splitter
            axis="y"
            grows={-1}
            value={panels.bottomHeight}
            min={BOTTOM_MIN}
            max={panels.bottomMax}
            label={TEXT.resizeBottomPanel}
            controls="projects-bottom"
            onResize={(size, done) => panels.resize('bottom', size, done)}
            onReset={() => panels.reset('bottom')}
          />
        )}
        <div
          id="projects-bottom"
          className="kit-projects-bottom"
          data-open={bottom.open}
          style={{ height: bottom.open ? panels.bottomHeight : undefined }}>
          <div className="kit-projects-bottom-head">
            <div className="kit-projects-switches" role="group" aria-label={TEXT.bottomPanel}>
              {switches(BOTTOM, bottom.open, bottom.view)}
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              className="kit-projects-panel-hide"
              aria-label={bottom.open ? TEXT.hideBottomPanel : TEXT.showBottomPanel}
              title={bottom.open ? TEXT.hideBottomPanel : TEXT.showBottomPanel}
              aria-expanded={bottom.open}
              aria-controls="projects-bottom-body"
              onClick={() => (bottom.open ? panels.collapse('bottom') : panels.expand('bottom'))}>
              {bottom.open ? <ChevronDownIcon aria-hidden="true" /> : <ChevronUpIcon aria-hidden="true" />}
            </Button>
          </div>
          <div id="projects-bottom-body" className="kit-projects-bottom-body" hidden={!bottom.open}>
            {view('history', bottom.view === 'history', parts.history)}
            {view('find', bottom.view === 'find', parts.find)}
          </div>
        </div>
      </div>
    </div>
  );
};

export const SidePanels: WorkspaceLayout = Object.assign(SidePanelsLayout, { id: 'side-panels' as const });
