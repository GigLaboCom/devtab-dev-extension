import { MIN_BITS, passwordStrength } from './passwordStrength';
import { describe, expect, it } from 'vitest';

describe('passwordStrength', () => {
  it('asks for 12 characters and an estimate of 60 bits', () => {
    expect(passwordStrength('Short1!').ok).toBe(false);
    expect(passwordStrength('aaaaaaaaaaaaaaaaaaaa')).toMatchObject({
      ok: false,
      problem: expect.stringMatching(/guess/),
    });
    expect(passwordStrength('abcdefghijklmnop').ok).toBe(false);
    expect(passwordStrength('correct horse battery staple').ok).toBe(true);
    expect(passwordStrength('Tr0ub4dor&3xyz').bits).toBeGreaterThanOrEqual(MIN_BITS);
  });
});
