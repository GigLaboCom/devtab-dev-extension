/**
 * A border between two panels that moves (the WAI-ARIA window splitter): dragged with the pointer, moved by the arrow
 * keys (Shift for a larger step), Home and End for the smallest and largest size, a double click back to the default.
 * Its value is the size of the panel it belongs to, in CSS pixels. While it is dragged a cover lies over the page, so the
 * editor's iframe under the pointer does not take the pointer's events and the drag is not lost.
 */
import { RESIZE_STEP, RESIZE_STEP_LARGE, clamp } from '@src/projects/layout';
import { useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, ReactElement } from 'react';

export interface SplitterProps {
  /** `x`: a vertical border moved left and right; `y`: a horizontal one moved up and down. */
  axis: 'x' | 'y';
  /** +1 when moving right / down makes the panel larger, -1 when it makes it smaller. */
  grows: 1 | -1;
  value: number;
  min: number;
  max: number;
  label: string;
  /** The id of the panel it resizes. */
  controls: string;
  /** Every move; `done` once the size is settled (the pointer let go, a key pressed): then it is remembered. */
  onResize(size: number, done: boolean): void;
  onReset(): void;
}

export const Splitter = ({
  axis,
  grows,
  value,
  min,
  max,
  label,
  controls,
  onResize,
  onReset,
}: SplitterProps): ReactElement => {
  const drag = useRef<{ from: number; start: number; last: number; pointer: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const at = (e: PointerEvent): number => (axis === 'x' ? e.clientX : e.clientY);

  const down = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.focus();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { from: at(e), start: value, last: value, pointer: e.pointerId };
    setDragging(true);
  };
  const move = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointer) return;
    const next = clamp(d.start + grows * (at(e) - d.from), min, max);
    if (next === d.last) return;
    d.last = next;
    onResize(next, false);
  };
  const up = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointer) return;
    drag.current = null;
    setDragging(false);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    onResize(d.last, true);
  };

  const key = (e: KeyboardEvent<HTMLDivElement>): void => {
    const step = e.shiftKey ? RESIZE_STEP_LARGE : RESIZE_STEP;
    const larger = axis === 'x' ? (grows > 0 ? 'ArrowRight' : 'ArrowLeft') : grows > 0 ? 'ArrowDown' : 'ArrowUp';
    const smaller = axis === 'x' ? (grows > 0 ? 'ArrowLeft' : 'ArrowRight') : grows > 0 ? 'ArrowUp' : 'ArrowDown';
    const next =
      e.key === larger
        ? value + step
        : e.key === smaller
          ? value - step
          : e.key === 'Home'
            ? min
            : e.key === 'End'
              ? max
              : null;
    if (next === null) return;
    e.preventDefault();
    onResize(clamp(next, min, max), true);
  };

  // A focusable separator is a widget (the WAI-ARIA window splitter); jsx-a11y counts every separator as structure.
  /* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
  return (
    <div
      role="separator"
      tabIndex={0}
      className="kit-projects-splitter"
      data-axis={axis}
      data-dragging={dragging ? '' : undefined}
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-label={label}
      aria-controls={controls}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
      onDoubleClick={onReset}>
      {dragging && <div className="kit-projects-drag-cover" data-axis={axis} />}
    </div>
  );
  /* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
};
