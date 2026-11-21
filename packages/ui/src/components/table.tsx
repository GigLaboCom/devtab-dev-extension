/**
 * shadcn/ui Table, Radix base (shadcn-ui/ui e62c9435, apps/v4/registry/bases/radix/ui/table.tsx); the look is
 * `cn-table*` in @workspace/dna/style-gpui.css with gpui-kit's numbers (theming-components.md §5.3 «Table»: rows 32,
 * the head on `table_head`; @workspace/dna/style-gpui-tools.css since 2026-11-21). Base edits: the base's own
 * `transition-colors` on a row is left to the style (gpui-kit's hover is instant), and the `[role=checkbox]` paddings
 * are dropped with the style's rules. Own: a row is coloured on hover only when it says a person can act on it
 * (`interactive`: it opens, selects or copies something) — a table of values does not light up under the pointer; a long
 * value wraps rather than widening the table; and when the table is wider than its place, its container is a focusable
 * region (named by the table's `aria-label`), so the keys can scroll it.
 */
import { cn } from '../lib/utils';
import { useLayoutEffect, useRef, useState } from 'react';
import type { ComponentProps, ReactElement, RefObject } from 'react';

/** Does the element scroll sideways now? Followed as it and its content resize. */
const useScrolls = (): [RefObject<HTMLDivElement | null>, boolean] => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [scrolls, setScrolls] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (): void => setScrolls(el.scrollWidth > el.clientWidth);
    measure();
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, []);
  return [ref, scrolls];
};

export const Table = ({ className, ...props }: ComponentProps<'table'>): ReactElement => {
  const [container, scrolls] = useScrolls();
  return (
    <div
      ref={container}
      data-slot="table-container"
      className="cn-table-container"
      {...(scrolls
        ? { tabIndex: 0, role: 'region', 'aria-label': props['aria-label'] ?? 'Table, scrolls sideways' }
        : {})}>
      <table data-slot="table" className={cn('cn-table', className)} {...props} />
    </div>
  );
};

export const TableHeader = ({ className, ...props }: ComponentProps<'thead'>): ReactElement => (
  <thead data-slot="table-header" className={cn('cn-table-header', className)} {...props} />
);

export const TableBody = ({ className, ...props }: ComponentProps<'tbody'>): ReactElement => (
  <tbody data-slot="table-body" className={cn('cn-table-body', className)} {...props} />
);

export const TableFooter = ({ className, ...props }: ComponentProps<'tfoot'>): ReactElement => (
  <tfoot data-slot="table-footer" className={cn('cn-table-footer', className)} {...props} />
);

export const TableRow = ({
  className,
  interactive = false,
  ...props
}: ComponentProps<'tr'> & {
  /** A person acts on the row (it opens, selects or copies something): coloured on hover. */
  interactive?: boolean;
}): ReactElement => (
  <tr
    data-slot="table-row"
    data-interactive={interactive || undefined}
    className={cn('cn-table-row', className)}
    {...props}
  />
);

export const TableHead = ({ className, ...props }: ComponentProps<'th'>): ReactElement => (
  <th data-slot="table-head" className={cn('cn-table-head', className)} {...props} />
);

export const TableCell = ({ className, ...props }: ComponentProps<'td'>): ReactElement => (
  <td data-slot="table-cell" className={cn('cn-table-cell', className)} {...props} />
);

export const TableCaption = ({ className, ...props }: ComponentProps<'caption'>): ReactElement => (
  <caption data-slot="table-caption" className={cn('cn-table-caption', className)} {...props} />
);
