/**
 * shadcn/ui Badge, Radix base (shadcn-ui/ui e62c9435, apps/v4/registry/bases/radix/ui/badge.tsx); the look is
 * `cn-badge*` in @workspace/dna/style-gpui.css (gpui-kit's Tag). Base edits: three variants — `default`, `secondary`,
 * `outline` — of the base's six (the others have no user yet; their rules stay in the style), no `asChild` (a badge
 * here is words, never a link), no focus ring (a span is not focusable).
 */
import { cn } from '../lib/utils';
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import type { ComponentProps, ReactElement } from 'react';

const badgeVariants = cva(
  'cn-badge group/badge inline-flex w-fit shrink-0 items-center justify-center overflow-hidden whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'cn-badge-variant-default',
        secondary: 'cn-badge-variant-secondary',
        outline: 'cn-badge-variant-outline',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export const Badge = ({
  className,
  variant = 'default',
  ...props
}: ComponentProps<'span'> & VariantProps<typeof badgeVariants>): ReactElement => (
  <span
    data-slot="badge"
    data-variant={variant ?? 'default'}
    className={cn(badgeVariants({ variant }), className)}
    {...props}
  />
);
