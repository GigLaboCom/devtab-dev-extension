/** How the history's pages write sizes, times and counts. */
export const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[u]}`;
};

export const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

export const formatTime = (ms: number): string =>
  new Date(ms).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

export const formatClock = (ms: number): string => new Date(ms).toLocaleTimeString('en-US', { timeStyle: 'short' });

/** `yyyy-mm-dd` of a local date, for <input type="date">. */
export const dateValue = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Local midnight of `yyyy-mm-dd`, or undefined for an empty or invalid value. */
export const parseDate = (value: string): number | undefined => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return undefined;
  const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  return Number.isFinite(t) ? t : undefined;
};
