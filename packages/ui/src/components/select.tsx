/**
 * shadcn/ui Select, Radix base (shadcn-ui/ui e62c9435); the look is `cn-select*` in @workspace/dna/style-gpui.css.
 * Base edits (theming-components.md §2.4, §5.1):
 * - Lucide icons for the icon placeholders;
 * - the list opens BELOW the trigger and as wide as it, 6 px down (gpui-kit): `position="popper"`, `sideOffset={6}`,
 *   without the base's extra 4 px `translate-y-1`; no `cn-menu-translucent` (gpui-kit's list is opaque);
 * - at most 320 px tall (gpui-kit's `menu_max_h`) and never past the window: one `max-h` of both;
 * - a disabled row keeps the base's `opacity-50` (gpui-kit fades a disabled Select as a whole, §4.7).
 * Radix locks the page scroll with react-remove-scroll, which the CSP refuses; the extension aliases it to a no-op
 * (src/shared/csp/removeScroll.tsx).
 */
import { cn } from '../lib/utils';
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from 'lucide-react';
import { Select as SelectPrimitive } from 'radix-ui';
import type { ComponentProps, ReactElement } from 'react';

export const Select = (props: ComponentProps<typeof SelectPrimitive.Root>): ReactElement => (
  <SelectPrimitive.Root data-slot="select" {...props} />
);

export const SelectGroup = ({ className, ...props }: ComponentProps<typeof SelectPrimitive.Group>): ReactElement => (
  <SelectPrimitive.Group data-slot="select-group" className={cn('cn-select-group', className)} {...props} />
);

export const SelectValue = (props: ComponentProps<typeof SelectPrimitive.Value>): ReactElement => (
  <SelectPrimitive.Value data-slot="select-value" {...props} />
);

export const SelectTrigger = ({
  className,
  size = 'default',
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Trigger> & { size?: 'sm' | 'default' }): ReactElement => (
  <SelectPrimitive.Trigger
    data-slot="select-trigger"
    data-size={size}
    className={cn(
      'cn-select-trigger flex w-fit items-center justify-between whitespace-nowrap outline-none disabled:cursor-not-allowed disabled:opacity-50 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center [&_svg]:pointer-events-none [&_svg]:shrink-0',
      className,
    )}
    {...props}>
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDownIcon className="cn-select-trigger-icon pointer-events-none" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
);

const SelectScrollUpButton = ({
  className,
  ...props
}: ComponentProps<typeof SelectPrimitive.ScrollUpButton>): ReactElement => (
  <SelectPrimitive.ScrollUpButton
    data-slot="select-scroll-up-button"
    className={cn('cn-select-scroll-up-button', className)}
    {...props}>
    <ChevronUpIcon />
  </SelectPrimitive.ScrollUpButton>
);

const SelectScrollDownButton = ({
  className,
  ...props
}: ComponentProps<typeof SelectPrimitive.ScrollDownButton>): ReactElement => (
  <SelectPrimitive.ScrollDownButton
    data-slot="select-scroll-down-button"
    className={cn('cn-select-scroll-down-button', className)}
    {...props}>
    <ChevronDownIcon />
  </SelectPrimitive.ScrollDownButton>
);

export const SelectContent = ({
  className,
  children,
  position = 'popper',
  align = 'start',
  sideOffset = 6,
  ...props
}: ComponentProps<typeof SelectPrimitive.Content>): ReactElement => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      data-slot="select-content"
      data-align-trigger={position === 'item-aligned'}
      className={cn(
        'cn-select-content relative z-50 max-h-[min(var(--radix-select-content-available-height),calc(var(--spacing)*80))] origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto data-[align-trigger=true]:animate-none',
        className,
      )}
      position={position}
      align={align}
      sideOffset={sideOffset}
      {...props}>
      <SelectScrollUpButton />
      <SelectPrimitive.Viewport
        data-position={position}
        className="cn-select-viewport data-[position=popper]:h-(--radix-select-trigger-height) data-[position=popper]:w-full data-[position=popper]:min-w-(--radix-select-trigger-width)">
        {children}
      </SelectPrimitive.Viewport>
      <SelectScrollDownButton />
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
);

export const SelectItem = ({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Item>): ReactElement => (
  <SelectPrimitive.Item
    data-slot="select-item"
    className={cn(
      'cn-select-item relative flex w-full cursor-default items-center outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
      className,
    )}
    {...props}>
    <span className="cn-select-item-indicator">
      <SelectPrimitive.ItemIndicator>
        <CheckIcon className="pointer-events-none" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
);
