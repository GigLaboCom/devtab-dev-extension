/**
 * The Button's classes (button.tsx) on their own: a page that only needs a link styled as a button — the extension's
 * start page, whose first load has a byte budget — takes these without the component, its `cn` (tailwind-merge) and
 * Radix Slot.
 */
import { cva } from 'class-variance-authority';

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
