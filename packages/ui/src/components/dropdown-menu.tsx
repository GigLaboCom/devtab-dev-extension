/**
 * shadcn/ui Dropdown Menu, Radix base (shadcn-ui/ui e62c9435, apps/v4/registry/bases/radix/ui/dropdown-menu.tsx); the
 * look is `cn-dropdown-menu-*` in @workspace/dna/style-gpui.css (gpui-kit's dropdown menu: padding 4, 2 between rows,
 * a row 26 tall, a 2 px separator, no animation). Base edits (theming-components.md §2.4): no animation classes;
 * 6 px from the trigger, as the kit's other floating parts; Lucide's check for a checked item; a disabled row keeps
 * the muted colour instead of the base's half opacity (gpui-kit's menu); no utility the kit's Select does not bring
 * already (no transform origin — nothing animates — and no available-height cap): Tailwind writes every utility the
 * sources name into the page's one stylesheet, which the start page loads, and this menu belongs to the sections that
 * load later. Radix moves the keyboard into the menu when
 * it opens (arrow keys, Home, End, typing a letter), closes it on Escape or a press outside, and gives the focus back
 * to the trigger. Its scroll lock is aliased to a no-op in the extension, as for Select (src/shared/csp/removeScroll.tsx).
 */
import { cn } from '../lib/utils';
import { CheckIcon } from 'lucide-react';
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui';
import type { ComponentProps, ReactElement } from 'react';

export const DropdownMenu = (props: ComponentProps<typeof DropdownMenuPrimitive.Root>): ReactElement => (
  <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />
);

export const DropdownMenuTrigger = (props: ComponentProps<typeof DropdownMenuPrimitive.Trigger>): ReactElement => (
  <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
);

export const DropdownMenuContent = ({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Content>): ReactElement => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      data-slot="dropdown-menu-content"
      sideOffset={sideOffset}
      className={cn('cn-dropdown-menu-content z-50 overflow-x-hidden overflow-y-auto outline-none', className)}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
);

export const DropdownMenuItem = ({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Item>): ReactElement => (
  <DropdownMenuPrimitive.Item
    data-slot="dropdown-menu-item"
    className={cn(
      'cn-dropdown-menu-item group/dropdown-menu-item relative flex cursor-default items-center outline-hidden select-none data-disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0',
      className,
    )}
    {...props}
  />
);

export const DropdownMenuCheckboxItem = ({
  className,
  children,
  checked,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>): ReactElement => (
  <DropdownMenuPrimitive.CheckboxItem
    data-slot="dropdown-menu-checkbox-item"
    className={cn(
      'cn-dropdown-menu-checkbox-item group/dropdown-menu-item relative flex cursor-default items-center outline-hidden select-none data-disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0',
      className,
    )}
    checked={checked}
    {...props}>
    <span className="cn-dropdown-menu-item-indicator pointer-events-none">
      <DropdownMenuPrimitive.ItemIndicator>
        <CheckIcon />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.CheckboxItem>
);

export const DropdownMenuLabel = ({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Label>): ReactElement => (
  <DropdownMenuPrimitive.Label
    data-slot="dropdown-menu-label"
    className={cn('cn-dropdown-menu-label', className)}
    {...props}
  />
);

export const DropdownMenuSeparator = ({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Separator>): ReactElement => (
  <DropdownMenuPrimitive.Separator
    data-slot="dropdown-menu-separator"
    className={cn('cn-dropdown-menu-separator', className)}
    {...props}
  />
);

/** The key of an item, at its end (`cn-kbd`-less, as gpui-kit's menu names a key in muted text). */
export const DropdownMenuShortcut = ({ className, ...props }: ComponentProps<'span'>): ReactElement => (
  <span data-slot="dropdown-menu-shortcut" className={cn('cn-dropdown-menu-shortcut', className)} {...props} />
);
