/**
 * shadcn/ui Dialog, Radix base (shadcn-ui/ui e62c9435, apps/v4/registry/bases/radix/ui/dialog.tsx); the look is
 * `cn-dialog-*` in @workspace/dna/style-gpui-dialog.css (gpui-kit's Dialog: 448 wide, 10 % of the window from the top,
 * the `background` surface with a border, radius 8 and the dialog shadow, the theme's `overlay`; theming-components.md
 * §5.2). Base edits: the layout utilities of the base (`fixed`, `top-1/2`, `translate`, `grid`, `z-50`, `sm:*`) are in
 * the `cn-dialog-*` rules instead, so a page that never opens a dialog carries none of it (the extension's start route
 * has a byte budget); the close button is named by `aria-label` rather than an `sr-only` span; no entrance animation
 * (gpui-kit's popups appear in one frame, theming-components.md §4.6).
 *
 * Radix makes it modal: focus is trapped inside while it is open, everything else is hidden from assistive technology
 * (`aria-hidden` on the rest of the page) and takes no pointer; this component also makes the rest `inert`
 * (`inertBehind`), so nothing behind can take focus while it is open, Escape and a press outside close it, and focus goes
 * back on close (to the trigger, or where `onCloseAutoFocus` sends it). The scroll lock is the host's: the extension
 * replaces `react-remove-scroll` (it inserts a `<style>`, which the extension's CSP refuses).
 */
import { Button } from './button';
import { cn } from '../lib/utils';
import { XIcon } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useCallback } from 'react';
import type { ComponentProps, ReactElement } from 'react';

export const Dialog = (props: ComponentProps<typeof DialogPrimitive.Root>): ReactElement => (
  <DialogPrimitive.Root data-slot="dialog" {...props} />
);

export const DialogTrigger = (props: ComponentProps<typeof DialogPrimitive.Trigger>): ReactElement => (
  <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
);

export const DialogPortal = (props: ComponentProps<typeof DialogPrimitive.Portal>): ReactElement => (
  <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
);

export const DialogClose = (props: ComponentProps<typeof DialogPrimitive.Close>): ReactElement => (
  <DialogPrimitive.Close data-slot="dialog-close" {...props} />
);

export const DialogOverlay = ({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Overlay>): ReactElement => (
  <DialogPrimitive.Overlay data-slot="dialog-overlay" className={cn('cn-dialog-overlay', className)} {...props} />
);

/**
 * Everything on the page outside the open dialog is made `inert` (and given back as it was on close, before focus
 * returns): nothing behind can take focus or a pointer — Radix alone only hides it from assistive technology. The
 * dialog's own overlay and anything that already was inert are left as they are. An iframe behind the dialog cannot be
 * focused from this page then, but its own document still can focus itself (Chrome); a host page that has such a frame
 * tells it (the extension's editor page checks `frameElement.closest('[inert]')`).
 */
export const inertBehind = (node: HTMLElement): (() => void) => {
  const doc = node.ownerDocument;
  let layer: HTMLElement = node;
  while (layer.parentElement && layer.parentElement !== doc.body) layer = layer.parentElement;
  const made = [...doc.body.children].filter(
    (el): el is HTMLElement =>
      el instanceof HTMLElement &&
      el !== layer &&
      !el.hasAttribute('inert') &&
      el.getAttribute('data-slot') !== 'dialog-overlay' &&
      !(el instanceof HTMLScriptElement),
  );
  for (const el of made) el.setAttribute('inert', '');
  return () => {
    for (const el of made) el.removeAttribute('inert');
  };
};

export const DialogContent = ({
  className,
  children,
  showCloseButton = true,
  ref,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { showCloseButton?: boolean }): ReactElement => {
  // Mounted when it opens, unmounted when it closes: the page behind is inert exactly while it is open. One callback
  // per `ref`, so a render while open does not give the page back for a moment.
  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
      const restore = node ? inertBehind(node) : undefined;
      return () => {
        restore?.();
        if (typeof ref === 'function') ref(null);
        else if (ref) ref.current = null;
      };
    },
    [ref],
  );
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn('cn-dialog-content', className)}
        ref={attach}
        {...props}>
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close asChild>
            <Button variant="ghost" size="icon-sm" className="cn-dialog-close" aria-label="Close">
              <XIcon aria-hidden="true" />
            </Button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
};

export const DialogHeader = ({ className, ...props }: ComponentProps<'div'>): ReactElement => (
  <div data-slot="dialog-header" className={cn('cn-dialog-header', className)} {...props} />
);

export const DialogFooter = ({ className, ...props }: ComponentProps<'div'>): ReactElement => (
  <div data-slot="dialog-footer" className={cn('cn-dialog-footer', className)} {...props} />
);

export const DialogTitle = ({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>): ReactElement => (
  <DialogPrimitive.Title data-slot="dialog-title" className={cn('cn-dialog-title', className)} {...props} />
);

export const DialogDescription = ({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>): ReactElement => (
  <DialogPrimitive.Description
    data-slot="dialog-description"
    className={cn('cn-dialog-description', className)}
    {...props}
  />
);
