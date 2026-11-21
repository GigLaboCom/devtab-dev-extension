/**
 * shadcn/ui Toggle Group, Radix base (shadcn-ui/ui e62c9435); the look is `cn-toggle-group*` in
 * @workspace/dna/style-gpui.css. Base edit: the gap between items is the style's, not a `spacing` prop written into an
 * inline `--gap` (the pages keep colours and sizes out of inline styles); so the joined `spacing={0}` look of the base
 * is not offered.
 */
import { toggleVariants } from './toggle';
import { cn } from '../lib/utils';
import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui';
import { createContext, useContext } from 'react';
import type { VariantProps } from 'class-variance-authority';
import type { ComponentProps, ReactElement } from 'react';

type Variants = VariantProps<typeof toggleVariants>;

const ToggleGroupContext = createContext<Variants>({ size: 'default', variant: 'default' });

export const ToggleGroup = ({
  className,
  variant,
  size,
  children,
  ...props
}: ComponentProps<typeof ToggleGroupPrimitive.Root> & Variants): ReactElement => (
  <ToggleGroupPrimitive.Root
    data-slot="toggle-group"
    data-variant={variant}
    data-size={size}
    className={cn(
      'cn-toggle-group group/toggle-group flex w-fit flex-row items-center data-vertical:flex-col data-vertical:items-stretch',
      className,
    )}
    {...props}>
    <ToggleGroupContext.Provider value={{ variant, size }}>{children}</ToggleGroupContext.Provider>
  </ToggleGroupPrimitive.Root>
);

export const ToggleGroupItem = ({
  className,
  children,
  variant = 'default',
  size = 'default',
  ...props
}: ComponentProps<typeof ToggleGroupPrimitive.Item> & Variants): ReactElement => {
  const context = useContext(ToggleGroupContext);
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      data-variant={context.variant || variant}
      data-size={context.size || size}
      className={cn(
        'cn-toggle-group-item shrink-0 focus:z-10 focus-visible:z-10',
        toggleVariants({ variant: context.variant || variant, size: context.size || size }),
        className,
      )}
      {...props}>
      {children}
    </ToggleGroupPrimitive.Item>
  );
};
