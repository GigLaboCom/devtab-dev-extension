/**
 * The panels' state in React (src/projects/layout.ts): read from the memory's copy in the first render, then from the
 * memory itself unless the person changed something meanwhile; every change the person makes is remembered (a drag
 * once it ends). The workspace and the editor's column are measured, so a panel never grows over the editor's minimum.
 * A workspace that starts narrower than `NARROW_BELOW` shows the side panel collapsed — for this visit only: what is
 * remembered stays as the person left it.
 */
import {
  BOTTOM_MIN,
  DEFAULT_LAYOUT,
  NARROW_BELOW,
  SIDE_MIN,
  bottomMax,
  clamp,
  pressView,
  revealView,
  sideMax,
} from '@src/projects/layout';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PanelView, ProjectsLayout } from '@src/projects/layout';
import type { LayoutMemory } from '@src/projects/layoutMemory';
import type { RefObject } from 'react';

export type Panel = 'side' | 'bottom';

export interface Panels {
  /** What shows now: the remembered layout, with the side panel collapsed in a narrow start. */
  layout: ProjectsLayout;
  /** The sizes as drawn: the remembered ones within what the workspace leaves the editor. */
  sideWidth: number;
  sideMax: number;
  bottomHeight: number;
  bottomMax: number;
  press(view: PanelView): void;
  reveal(view: PanelView): void;
  collapse(panel: Panel): void;
  expand(panel: Panel): void;
  resize(panel: Panel, size: number, done: boolean): void;
  reset(panel: Panel): void;
}

/** The border between the side panel and the editor, which the two do not get. */
const SPLITTER = 1;

export const usePanels = (
  memory: LayoutMemory,
  workspace: RefObject<HTMLElement | null>,
  column: RefObject<HTMLElement | null>,
): Panels => {
  const [stored, setStored] = useState<ProjectsLayout>(() => memory.initial() ?? DEFAULT_LAYOUT);
  const [narrow, setNarrow] = useState(false);
  const [room, setRoom] = useState({ width: 0, height: 0 });
  const touched = useRef(false);
  const measuredOnce = useRef(false);

  // The stored layout, unless the person was quicker.
  useEffect(() => {
    let live = true;
    void memory.load().then(found => {
      if (live && found && !touched.current) setStored(found);
    });
    return () => {
      live = false;
    };
  }, [memory]);

  // The room the panels share, measured now and whenever it changes.
  useLayoutEffect(() => {
    const measure = (): void => {
      // Inside the workspace's border, less the side border: what the side panel and the editor share.
      const inner = workspace.current?.clientWidth ?? 0;
      const width = inner > 0 ? inner - SPLITTER : 0;
      const height = column.current?.clientHeight ?? 0;
      setRoom(r => (r.width === width && r.height === height ? r : { width, height }));
      if (!measuredOnce.current && width > 0) {
        measuredOnce.current = true;
        if (width < NARROW_BELOW) setNarrow(true);
      }
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (workspace.current) observer?.observe(workspace.current);
    if (column.current) observer?.observe(column.current);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [workspace, column]);

  const layout: ProjectsLayout = narrow ? { ...stored, side: { ...stored.side, open: false } } : stored;
  const shown = useRef(layout);
  shown.current = layout;

  const change = useCallback(
    (next: (current: ProjectsLayout) => ProjectsLayout, remember = true) => {
      touched.current = true;
      const value = next(shown.current);
      shown.current = value;
      setNarrow(false);
      setStored(value);
      if (remember) memory.save(value);
    },
    [memory],
  );

  const maxSide = sideMax(room.width);
  const maxBottom = bottomMax(room.height);

  return {
    layout,
    sideWidth: clamp(layout.side.width, SIDE_MIN, maxSide),
    sideMax: maxSide,
    bottomHeight: clamp(layout.bottom.height, BOTTOM_MIN, maxBottom),
    bottomMax: maxBottom,
    press: view => change(l => pressView(l, view)),
    reveal: view => change(l => revealView(l, view)),
    collapse: panel => change(l => ({ ...l, [panel]: { ...l[panel], open: false } })),
    expand: panel => change(l => ({ ...l, [panel]: { ...l[panel], open: true } })),
    resize: (panel, size, done) =>
      change(
        l =>
          panel === 'side'
            ? { ...l, side: { ...l.side, width: clamp(size, SIDE_MIN, maxSide) } }
            : { ...l, bottom: { ...l.bottom, height: clamp(size, BOTTOM_MIN, maxBottom) } },
        done,
      ),
    reset: panel =>
      change(l =>
        panel === 'side'
          ? { ...l, side: { ...l.side, width: DEFAULT_LAYOUT.side.width } }
          : { ...l, bottom: { ...l.bottom, height: DEFAULT_LAYOUT.bottom.height } },
      ),
  };
};
