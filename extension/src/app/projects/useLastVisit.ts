/**
 * When the person last left the open project (the companion's specification §7.5, «пока меня не было»): read once as
 * the project opens — that is the time the history's «Since your last visit» starts from for this visit — and written
 * when the person leaves it: another project, the section left, the tab hidden or closed. The demo's invented project
 * keeps nothing: its last visit is a fixed while before the demo began, so the view shows what it is for.
 */
import { DEMO_LAST_VISIT_MINUTES } from '@src/projects/demo/data';
import { useEffect, useRef, useState } from 'react';
import type { LastSeen } from '@src/projects/lastSeen';

export const useLastVisit = (
  memory: LastSeen | undefined,
  project: string,
  demo: boolean,
  now: () => number = Date.now,
): number | null => {
  const [since, setSince] = useState<number | null>(null);
  // What was read for a project, kept: an effect run again for the same project (React's development double run) must
  // not read back the time its own cleanup just wrote.
  const read = useRef<{ project: string; since: Promise<number | null> } | null>(null);
  useEffect(() => {
    if (demo) {
      setSince(now() - DEMO_LAST_VISIT_MINUTES * 60_000);
      return;
    }
    if (!memory) return setSince(null);
    let live = true;
    if (read.current?.project !== project) read.current = { project, since: memory.get(project) };
    void read.current.since.then(ms => live && setSince(ms));
    const leave = (): void => memory.set(project, now());
    const hidden = (): void => {
      if (document.visibilityState === 'hidden') leave();
    };
    window.addEventListener('pagehide', leave);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      live = false;
      window.removeEventListener('pagehide', leave);
      document.removeEventListener('visibilitychange', hidden);
      leave();
    };
    // `now` is a clock, not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memory, project, demo]);
  return since;
};
