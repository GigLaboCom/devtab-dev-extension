/**
 * shadcn/ui's `cn`: joins classes and drops the losing utility of a conflict. tailwind-merge is told the scale names
 * @workspace/dna adds (tailwind.css), or it would read `text-code` as a colour and drop it next to `text-foreground`.
 */
import { clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';
import type { ClassValue } from 'clsx';

const merge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['code'],
      leading: ['gpui'],
      radius: ['checkbox', 'thumb'],
      shadow: ['tooltip', 'dialog', 'focus'],
    },
  },
});

export const cn = (...inputs: ClassValue[]): string => merge(clsx(inputs));
