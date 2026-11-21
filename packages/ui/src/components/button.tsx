/**
 * shadcn/ui Button, Radix base (shadcn-ui/ui e62c9435, apps/v4/registry/bases/radix/ui/button.tsx); the look is
 * `cn-button*` in @workspace/dna/style-gpui.css. Base edits (theming-components.md §2.4): no `disabled:opacity-50`
 * (gpui-kit recolours a disabled button, §4.7) and no `transition-all` (hover and press are instant).
 */
import { buttonVariants } from './button-variants';
import { cn } from '../lib/utils';
import { Slot } from 'radix-ui';
import type { VariantProps } from 'class-variance-authority';
import type { ComponentProps, ReactElement } from 'react';

export { buttonVariants };

export const Button = ({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }): ReactElement => {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
};
