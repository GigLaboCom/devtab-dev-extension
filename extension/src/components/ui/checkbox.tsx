/**
 * shadcn/ui Checkbox, Radix base (shadcn-ui/ui e62c9435); the look is `cn-checkbox*` in @workspace/dna/style-gpui.css.
 * Base edits: Lucide's check for the icon placeholder; no `disabled:opacity-50` (gpui-kit fades border and fill, §4.7).
 */
import { cn } from '@src/lib/utils';
import { CheckIcon } from 'lucide-react';
import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import type { ComponentProps, ReactElement } from 'react';

export const Checkbox = ({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>): ReactElement => (
  <CheckboxPrimitive.Root
    data-slot="checkbox"
    className={cn(
      'cn-checkbox peer relative shrink-0 outline-none after:absolute after:-inset-x-3 after:-inset-y-2 disabled:cursor-not-allowed',
      className,
    )}
    {...props}>
    <CheckboxPrimitive.Indicator
      data-slot="checkbox-indicator"
      className="cn-checkbox-indicator grid place-content-center text-current transition-none">
      <CheckIcon />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
);
