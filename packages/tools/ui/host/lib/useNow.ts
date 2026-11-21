/**
 * The current time for a tool page that shows "3 minutes ago" or the time now (docs/tools/specs/unix-time.md §5.7):
 * `Date.now()`, renewed on the boundary of every second — the shown second turns with the system clock — and not at all
 * while the page is hidden; when it is shown again, at once.
 */
import { useEffect, useState } from 'react';

export const useNow = (): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };
    const schedule = () => {
      timer = setTimeout(tick, 1000 - (Date.now() % 1000));
    };
    const tick = () => {
      setNow(Date.now());
      schedule();
    };
    const visibility = () => {
      stop();
      if (document.visibilityState === 'hidden') return;
      setNow(Date.now());
      schedule();
    };
    if (document.visibilityState !== 'hidden') schedule();
    document.addEventListener('visibilitychange', visibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  return now;
};
