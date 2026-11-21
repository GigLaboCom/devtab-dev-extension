/**
 * shadcn/ui Input, Radix base (shadcn-ui/ui e62c9435, apps/v4/registry/bases/radix/ui/input.tsx); the look is
 * `cn-input` in @workspace/dna/style-gpui.css. Base edits: no `disabled:opacity-50` (gpui-kit fades the field's
 * colours, §4.7) and the placeholder colour moves to the style.
 */
import { cn } from '../lib/utils';
import type { ComponentProps, ReactElement } from 'react';

export const Input = ({ className, type, ...props }: ComponentProps<'input'>): ReactElement => (
  <input
    type={type}
    data-slot="input"
    className={cn(
      'cn-input w-full min-w-0 outline-none file:inline-flex file:border-0 file:bg-transparent disabled:pointer-events-none disabled:cursor-not-allowed',
      className,
    )}
    {...props}
  />
);
