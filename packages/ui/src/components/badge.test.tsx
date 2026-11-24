import { Badge } from './badge';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(cleanup);

describe('Badge', () => {
  it('is a span with the cn-badge classes; each variant adds its cn-badge-variant-* class', () => {
    render(
      <>
        <Badge>Plain</Badge>
        <Badge variant="secondary">Second</Badge>
        <Badge variant="outline" className="extra">
          Outlined
        </Badge>
      </>,
    );
    const plain = screen.getByText('Plain');
    expect(plain.tagName).toBe('SPAN');
    expect(plain.dataset.slot).toBe('badge');
    expect(plain.classList.contains('cn-badge')).toBe(true);
    expect(plain.classList.contains('cn-badge-variant-default')).toBe(true);
    expect(plain.dataset.variant).toBe('default');
    expect(screen.getByText('Second').classList.contains('cn-badge-variant-secondary')).toBe(true);
    const outlined = screen.getByText('Outlined');
    expect(outlined.classList.contains('cn-badge-variant-outline')).toBe(true);
    expect(outlined.classList.contains('cn-badge-variant-default')).toBe(false);
    expect(outlined.classList.contains('extra')).toBe(true);
  });
});
