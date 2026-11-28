/**
 * shadcn/ui Popover, Radix base (shadcn-ui/ui e62c9435, apps/v4/registry/bases/radix/ui/popover.tsx); the look is
 * `cn-popover-*` in @workspace/dna/style-gpui.css (gpui-kit's Popover: padding 12, radius 6, no animation). Base edits
 * (theming-components.md §2.4): no animation classes — gpui-kit's popover has none; 6 px from the trigger, as the
 * kit's other floating parts. Radix moves the keyboard into the content when it opens, keeps Tab inside while it is
 * open in modal mode, closes on Escape or a press outside, and gives the focus back to the trigger.
 */
import { cn } from '../lib/utils';
import { Popover as PopoverPrimitive } from 'radix-ui';
import type { ComponentProps, ReactElement } from 'react';

export const Popover = (props: ComponentProps<typeof PopoverPrimitive.Root>): ReactElement => (
  <PopoverPrimitive.Root data-slot="popover" {...props} />
);

export const PopoverTrigger = (props: ComponentProps<typeof PopoverPrimitive.Trigger>): ReactElement => (
  <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
);

export const PopoverContent = ({
  className,
  align = 'center',
  sideOffset = 6,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>): ReactElement => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      data-slot="popover-content"
      align={align}
      sideOffset={sideOffset}
      className={cn(
        'cn-popover-content z-50 w-72 origin-(--radix-popover-content-transform-origin) outline-hidden',
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
);

export const PopoverHeader = ({ className, ...props }: ComponentProps<'div'>): ReactElement => (
  <div data-slot="popover-header" className={cn('cn-popover-header', className)} {...props} />
);

export const PopoverTitle = ({ className, children, ...props }: ComponentProps<'h2'>): ReactElement => (
  <h2 data-slot="popover-title" className={cn('cn-popover-title', className)} {...props}>
    {children}
  </h2>
);

export const PopoverDescription = ({ className, ...props }: ComponentProps<'p'>): ReactElement => (
  <p data-slot="popover-description" className={cn('cn-popover-description', className)} {...props} />
);
