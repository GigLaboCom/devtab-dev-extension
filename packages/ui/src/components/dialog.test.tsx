import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './dialog';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(cleanup);

const Example = () => (
  <>
    <p>Behind</p>
    <Dialog>
      <DialogTrigger>Open</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete the entries?</DialogTitle>
          <DialogDescription>They cannot be brought back.</DialogDescription>
        </DialogHeader>
        <input aria-label="Name" />
        <DialogFooter>
          <button type="button">Delete</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
);

describe('Dialog', () => {
  it('a modal dialog named by its title and described by its description, styled by the cn-dialog-* rules', async () => {
    render(<Example />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Open' })));
    const dialog = screen.getByRole('dialog', { name: 'Delete the entries?' });
    expect(dialog.getAttribute('aria-describedby')).toBe(screen.getByText('They cannot be brought back.').id);
    expect(dialog.className).toContain('cn-dialog-content');
    expect(document.querySelector('[data-slot="dialog-overlay"]')!.className).toContain('cn-dialog-overlay');
    // Only the component layer's classes: the layout is in the rules, not in Tailwind utilities.
    expect(dialog.className.split(/\s+/).every(c => c.startsWith('cn-'))).toBe(true);
    // Modal: the rest of the page is hidden from assistive technology, focus is inside.
    expect(screen.getByText('Behind').closest('[aria-hidden="true"]')).toBeTruthy();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('the close button is named and closes it; so does Escape', async () => {
    render(<Example />);
    const trigger = screen.getByRole('button', { name: 'Open' });
    await act(async () => fireEvent.click(trigger));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Close' })));
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => fireEvent.click(trigger));
    await act(async () => fireEvent.keyDown(document.activeElement!, { key: 'Escape' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('without the close button when asked', async () => {
    render(
      <Dialog open>
        <DialogContent showCloseButton={false}>
          <DialogTitle>Plain</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByRole('dialog', { name: 'Plain' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });

  it('makes the page behind inert while it is open, and gives it back as it was when it closes', async () => {
    const already = document.createElement('div');
    already.setAttribute('inert', '');
    document.body.append(already);
    const { container } = render(<Example />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Open' })));
    const dialog = screen.getByRole('dialog');
    expect(container.hasAttribute('inert')).toBe(true);
    // The dialog itself and its overlay stay live.
    expect(dialog.closest('[inert]')).toBeNull();
    expect(document.querySelector('[data-slot="dialog-overlay"]')!.closest('[inert]')).toBeNull();
    // A re-render while open does not give the page back.
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'x' } });
    expect(container.hasAttribute('inert')).toBe(true);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Close' })));
    expect(container.hasAttribute('inert')).toBe(false);
    expect(already.hasAttribute('inert')).toBe(true);
    already.remove();
  });
});
