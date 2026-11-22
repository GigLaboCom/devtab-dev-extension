/**
 * Table rows built a chunk per animation frame (as the RegExp and JSON Query tools build theirs): 200 with the render,
 * 200 more each frame, so a page of 1,000 rows never holds the main thread for long.
 */
import { useEffect, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

const STEP = 200;

export const ChunkedRows = <T,>({
  rows,
  render,
}: {
  rows: readonly T[];
  render: (row: T, k: number) => ReactNode;
}): ReactElement => {
  const [built, setBuilt] = useState({ rows, count: STEP });
  const count = built.rows === rows ? built.count : STEP;
  if (built.rows !== rows) setBuilt({ rows, count: STEP });

  useEffect(() => {
    if (count >= rows.length) return;
    const frame = requestAnimationFrame(() => setBuilt(b => (b.rows === rows ? { rows, count: b.count + STEP } : b)));
    return () => cancelAnimationFrame(frame);
  }, [count, rows]);

  return <>{rows.slice(0, count).map(render)}</>;
};
