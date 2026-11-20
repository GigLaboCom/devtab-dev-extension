/**
 * shadcn/ui Textarea, Radix base (shadcn-ui/ui e62c9435); the look is `cn-textarea` in @workspace/dna/style-gpui.css.
 * Base edits: no `disabled:opacity-50` (gpui-kit fades the field's colours, §4.7) and the placeholder colour moves to
 * the style.
 */
import { cn } from '@src/lib/utils';
import type { ComponentProps, ReactElement } from 'react';

export const Textarea = ({ className, ...props }: ComponentProps<'textarea'>): ReactElement => (
  <textarea
    data-slot="textarea"
    className={cn(
      'cn-textarea flex field-sizing-content min-h-16 w-full outline-none disabled:cursor-not-allowed',
      className,
    )}
    {...props}
  />
);
