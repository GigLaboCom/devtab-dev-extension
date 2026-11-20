/**
 * shadcn/ui Card, Radix base (shadcn-ui/ui e62c9435) — gpui-kit's GroupBox (theming-components.md §6); the look is
 * `cn-card*` in @workspace/dna/style-gpui.css. Base edit: no `cn-font-heading` on the title (the style sets the face).
 */
import { cn } from '@src/lib/utils';
import type { ComponentProps, ReactElement } from 'react';

export const Card = ({
  className,
  size = 'default',
  ...props
}: ComponentProps<'div'> & { size?: 'default' | 'sm' }): ReactElement => (
  <div data-slot="card" data-size={size} className={cn('cn-card group/card flex flex-col', className)} {...props} />
);

export const CardHeader = ({ className, ...props }: ComponentProps<'div'>): ReactElement => (
  <div
    data-slot="card-header"
    className={cn(
      'cn-card-header group/card-header @container/card-header grid auto-rows-min items-start has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto]',
      className,
    )}
    {...props}
  />
);

export const CardTitle = ({ className, ...props }: ComponentProps<'div'>): ReactElement => (
  <div data-slot="card-title" className={cn('cn-card-title', className)} {...props} />
);

export const CardDescription = ({ className, ...props }: ComponentProps<'div'>): ReactElement => (
  <div data-slot="card-description" className={cn('cn-card-description', className)} {...props} />
);

export const CardContent = ({ className, ...props }: ComponentProps<'div'>): ReactElement => (
  <div data-slot="card-content" className={cn('cn-card-content', className)} {...props} />
);
