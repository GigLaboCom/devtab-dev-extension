import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(cleanup);

describe('Table', () => {
  it('is a real table with the cn-table classes the style dresses', () => {
    render(
      <Table aria-label="Query parameters">
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Value</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>q</TableCell>
            <TableCell>1</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    const table = screen.getByRole('table', { name: 'Query parameters' });
    expect(table.className).toBe('cn-table');
    expect(screen.getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Name', 'Value']);
    expect(screen.getByRole('cell', { name: 'q' }).className).toBe('cn-table-cell');
    expect(table.parentElement?.className).toBe('cn-table-container');
  });

  it('colours a row on hover only when a person can act on it; a long value wraps', () => {
    render(
      <Table aria-label="Parts">
        <TableBody>
          <TableRow>
            <TableCell>scheme</TableCell>
          </TableRow>
          <TableRow interactive>
            <TableCell>open</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    const [plain, acting] = screen.getAllByRole('row');
    expect(plain.hasAttribute('data-interactive')).toBe(false);
    expect(acting.getAttribute('data-interactive')).toBe('true');
  });

  it('a container that scrolls sideways is a focusable region named by the table; one that does not is neither', () => {
    const widths = { scrollWidth: 0, clientWidth: 0 };
    const scroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth');
    const client = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => widths.scrollWidth });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => widths.clientWidth });
    try {
      widths.scrollWidth = 800;
      widths.clientWidth = 400;
      const wide = render(
        <Table aria-label="Query parameters">
          <TableBody>
            <TableRow>
              <TableCell>a very long value</TableCell>
            </TableRow>
          </TableBody>
        </Table>,
      );
      const region = screen.getByRole('region', { name: 'Query parameters' });
      expect(region.getAttribute('tabindex')).toBe('0');
      wide.unmount();
      widths.scrollWidth = 400;
      render(
        <Table aria-label="Short">
          <TableBody>
            <TableRow>
              <TableCell>a</TableCell>
            </TableRow>
          </TableBody>
        </Table>,
      );
      expect(screen.queryByRole('region')).toBeNull();
      expect(screen.getByRole('table').parentElement?.hasAttribute('tabindex')).toBe(false);
    } finally {
      if (scroll) Object.defineProperty(HTMLElement.prototype, 'scrollWidth', scroll);
      if (client) Object.defineProperty(HTMLElement.prototype, 'clientWidth', client);
    }
  });
});
