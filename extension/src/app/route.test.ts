import { parseRoute, routeHash } from './route';
import { describe, expect, it } from 'vitest';

describe('route', () => {
  it('reads the sections and a tool', () => {
    expect(parseRoute('#/compare')).toEqual({ section: 'compare' });
    expect(parseRoute('#/review')).toEqual({ section: 'review' });
    expect(parseRoute('#/tools')).toEqual({ section: 'tools' });
    expect(parseRoute('#/tools/json')).toEqual({ section: 'tools', tool: 'json' });
  });
  it('anything else is the comparison', () => {
    expect(parseRoute('')).toEqual({ section: 'compare' });
    expect(parseRoute('#/nowhere')).toEqual({ section: 'compare' });
  });
  it('writes what it reads', () => {
    for (const hash of ['#/compare', '#/review', '#/tools', '#/tools/json'])
      expect(routeHash(parseRoute(hash))).toBe(hash);
  });
});
