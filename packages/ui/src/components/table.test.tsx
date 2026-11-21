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
});
