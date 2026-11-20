/** shadcn/ui Label, Radix base (shadcn-ui/ui e62c9435), unchanged; the look is `cn-label` in @workspace/dna/style-gpui.css. */
import { cn } from '@src/lib/utils';
import { Label as LabelPrimitive } from 'radix-ui';
import type { ComponentProps, ReactElement } from 'react';

export const Label = ({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>): ReactElement => (
  <LabelPrimitive.Root
    data-slot="label"
    className={cn(
      'cn-label flex items-center select-none group-data-[disabled=true]:pointer-events-none peer-disabled:cursor-not-allowed',
      className,
    )}
    {...props}
  />
);
