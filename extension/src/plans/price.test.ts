/** A price on its card (pro-plans §3.5, §8.1). The amounts are test values, not prices of the product. */
import { formatPrice, periodText } from './price';
import { describe, expect, it } from 'vitest';

// Intl puts a no-break space between a currency code and the amount.
const NBSP = ' ';

describe('formatPrice', () => {
  it('XTS 1111 → XTS 11.11 (two digits, the code as its symbol)', () => {
    expect(formatPrice({ amount: 1111, currency: 'XTS' })).toBe(`XTS${NBSP}11.11`);
    expect(formatPrice({ amount: 11110, currency: 'XTS' })).toBe(`XTS${NBSP}111.10`);
  });

  it('JPY 1111 → no fractional part', () => {
    expect(formatPrice({ amount: 1111, currency: 'JPY' })).toBe('¥1,111');
  });

  it('KWD 1111 → three digits', () => {
    expect(formatPrice({ amount: 1111, currency: 'KWD' })).toBe(`KWD${NBSP}1.111`);
  });

  it('USD 0 → $0.00', () => {
    expect(formatPrice({ amount: 0, currency: 'USD' })).toBe('$0.00');
  });
});

describe('periodText', () => {
  it('per month, per year', () => {
    expect(periodText('month')).toBe('per month');
    expect(periodText('year')).toBe('per year');
  });
});
