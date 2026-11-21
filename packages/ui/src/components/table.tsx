/**
 * shadcn/ui Table, Radix base (shadcn-ui/ui e62c9435, apps/v4/registry/bases/radix/ui/table.tsx); the look is
 * `cn-table*` in @workspace/dna/style-gpui.css with gpui-kit's numbers (theming-components.md §5.3 «Table»: rows 32,
 * the head on `table_head`). Base edits: none in the markup; the base's own `transition-colors` on a row is left to the
 * style (gpui-kit's hover is instant), and the `[role=checkbox]` paddings are dropped with the style's rules.
 */
import { cn } from '../lib/utils';
import type { ComponentProps, ReactElement } from 'react';

export const Table = ({ className, ...props }: ComponentProps<'table'>): ReactElement => (
  <div data-slot="table-container" className="cn-table-container">
    <table data-slot="table" className={cn('cn-table', className)} {...props} />
  </div>
);

export const TableHeader = ({ className, ...props }: ComponentProps<'thead'>): ReactElement => (
  <thead data-slot="table-header" className={cn('cn-table-header', className)} {...props} />
);

export const TableBody = ({ className, ...props }: ComponentProps<'tbody'>): ReactElement => (
  <tbody data-slot="table-body" className={cn('cn-table-body', className)} {...props} />
);

export const TableFooter = ({ className, ...props }: ComponentProps<'tfoot'>): ReactElement => (
  <tfoot data-slot="table-footer" className={cn('cn-table-footer', className)} {...props} />
);

export const TableRow = ({ className, ...props }: ComponentProps<'tr'>): ReactElement => (
  <tr data-slot="table-row" className={cn('cn-table-row', className)} {...props} />
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
