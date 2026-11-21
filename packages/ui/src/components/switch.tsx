/**
 * shadcn/ui Switch, Radix base (shadcn-ui/ui e62c9435, apps/v4/registry/bases/radix/ui/switch.tsx); the look is
 * `cn-switch*` in @workspace/dna/style-gpui.css (gpui-kit's numbers: 36 × 20, thumb 16). Base edits: no
 * `disabled:opacity-50` (gpui-kit fades the track only, §5). Under the extension's CSP: Radix renders a hidden
 * checkbox for forms with a `style` prop, which React sets through CSSOM — allowed; no `<style>` element.
 */
import { cn } from '../lib/utils';
import { Switch as SwitchPrimitive } from 'radix-ui';
import type { ComponentProps, ReactElement } from 'react';

export const Switch = ({
  className,
  size = 'default',
  ...props
}: ComponentProps<typeof SwitchPrimitive.Root> & { size?: 'sm' | 'default' }): ReactElement => (
  <SwitchPrimitive.Root
    data-slot="switch"
    data-size={size}
    className={cn(
      'cn-switch peer group/switch relative inline-flex shrink-0 items-center outline-none after:absolute after:-inset-x-3 after:-inset-y-2 disabled:cursor-not-allowed',
      className,
    )}
    {...props}>
    <SwitchPrimitive.Thumb data-slot="switch-thumb" className="cn-switch-thumb pointer-events-none block ring-0" />
  </SwitchPrimitive.Root>
);
