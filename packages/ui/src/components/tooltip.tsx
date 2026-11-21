/**
 * shadcn/ui Tooltip, Radix base (shadcn-ui/ui e62c9435, apps/v4/registry/bases/radix/ui/tooltip.tsx); the look is
 * `cn-tooltip-content` in @workspace/dna/style-gpui.css (gpui-kit's Tooltip: popover colours, a border, 14 px, a `Kbd`
 * for the shortcut). Base edits (theming-components.md §2.4): no arrow — gpui-kit's tooltip has none; the provider's
 * delay is gpui-kit's 500 ms rather than shadcn's 0.
 */
import { cn } from '../lib/utils';
import { Tooltip as TooltipPrimitive } from 'radix-ui';
import type { ComponentProps, ReactElement } from 'react';

export const TooltipProvider = ({
  delayDuration = 500,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Provider>): ReactElement => (
  <TooltipPrimitive.Provider data-slot="tooltip-provider" delayDuration={delayDuration} {...props} />
);

export const Tooltip = (props: ComponentProps<typeof TooltipPrimitive.Root>): ReactElement => (
  <TooltipPrimitive.Root data-slot="tooltip" {...props} />
);

export const TooltipTrigger = (props: ComponentProps<typeof TooltipPrimitive.Trigger>): ReactElement => (
  <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
);

export const TooltipContent = ({
  className,
  sideOffset = 6,
  children,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Content>): ReactElement => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      data-slot="tooltip-content"
      sideOffset={sideOffset}
      className={cn(
        'cn-tooltip-content z-50 w-fit max-w-xs origin-(--radix-tooltip-content-transform-origin)',
        className,
      )}
      {...props}>
      {children}
    </TooltipPrimitive.Content>
  </TooltipPrimitive.Portal>
);
