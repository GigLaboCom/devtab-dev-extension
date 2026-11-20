/**
 * shadcn/ui Toggle, Radix base (shadcn-ui/ui e62c9435); the look is `cn-toggle*` in @workspace/dna/style-gpui.css.
 * Base edits: no `hover:bg-muted`, `focus-visible:ring-[3px]` and `disabled:opacity-50` in the base (the style sets
 * hover, focus and disabled the gpui-kit way); one more variant, `segmented` — a segment of gpui-kit's Segmented bar.
 */
import { cn } from '@src/lib/utils';
import { cva } from 'class-variance-authority';
import { Toggle as TogglePrimitive } from 'radix-ui';
import type { VariantProps } from 'class-variance-authority';
import type { ComponentProps, ReactElement } from 'react';

export const toggleVariants = cva(
  'cn-toggle group/toggle inline-flex items-center justify-center whitespace-nowrap outline-none disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'cn-toggle-variant-default',
        outline: 'cn-toggle-variant-outline',
        segmented: 'cn-toggle-variant-segmented',
      },
      size: {
        default: 'cn-toggle-size-default',
        sm: 'cn-toggle-size-sm',
        lg: 'cn-toggle-size-lg',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export const Toggle = ({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: ComponentProps<typeof TogglePrimitive.Root> & VariantProps<typeof toggleVariants>): ReactElement => (
  <TogglePrimitive.Root data-slot="toggle" className={cn(toggleVariants({ variant, size, className }))} {...props} />
);
