/**
 * shadcn/ui Button, Radix base (shadcn-ui/ui e62c9435, apps/v4/registry/bases/radix/ui/button.tsx); the look is
 * `cn-button*` in @workspace/dna/style-gpui.css. Base edits (theming-components.md §2.4): no `disabled:opacity-50`
 * (gpui-kit recolours a disabled button, §4.7) and no `transition-all` (hover and press are instant).
 */
import { cn } from '@src/lib/utils';
import { cva } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type { VariantProps } from 'class-variance-authority';
import type { ComponentProps, ReactElement } from 'react';

export const buttonVariants = cva(
  'cn-button group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap outline-none select-none disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'cn-button-variant-default',
        outline: 'cn-button-variant-outline',
        secondary: 'cn-button-variant-secondary',
        ghost: 'cn-button-variant-ghost',
        destructive: 'cn-button-variant-destructive',
        link: 'cn-button-variant-link',
      },
      size: {
        default: 'cn-button-size-default',
        xs: 'cn-button-size-xs',
        sm: 'cn-button-size-sm',
        lg: 'cn-button-size-lg',
        icon: 'cn-button-size-icon',
        'icon-xs': 'cn-button-size-icon-xs',
        'icon-sm': 'cn-button-size-icon-sm',
        'icon-lg': 'cn-button-size-icon-lg',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

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
