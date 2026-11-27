import { addressLeavingOptions, isBare, isNewTabLoad, parseRoute, routeHash } from './route';
import { describe, expect, it } from 'vitest';

describe('route', () => {
  it('reads the sections and a tool', () => {
    expect(parseRoute('#/start')).toEqual({ section: 'start' });
    expect(parseRoute('#/settings')).toEqual({ section: 'settings' });
    expect(parseRoute('#/compare')).toEqual({ section: 'compare' });
    expect(parseRoute('#/projects')).toEqual({ section: 'projects' });
    expect(parseRoute('#/tools')).toEqual({ section: 'tools' });
    expect(parseRoute('#/tools/json')).toEqual({ section: 'tools', tool: 'json' });
  });
  it('anything else — a new tab has no hash — is the start page', () => {
    expect(parseRoute('')).toEqual({ section: 'start' });
    expect(parseRoute('#/nowhere')).toEqual({ section: 'start' });
  });
  it('reads a project and a file open in it; the former «Live review» address opens Projects', () => {
    expect(parseRoute('#/review')).toEqual({ section: 'projects' });
    expect(parseRoute('#/projects/p_demo0ledgr')).toEqual({ section: 'projects', project: 'p_demo0ledgr' });
    expect(parseRoute('#/projects/p_demo0ledgr/src%2Fserver.ts')).toEqual({
      section: 'projects',
      project: 'p_demo0ledgr',
      path: 'src/server.ts',
    });
    // An unencoded path reads the same; a broken escape is no file.
    expect(parseRoute('#/projects/p_x/src/a b.ts').path).toBe('src/a b.ts');
    expect(parseRoute('#/projects/p_x/%E0%A4%A')).toEqual({ section: 'projects', project: 'p_x' });
    expect(routeHash({ section: 'projects', project: 'p_x', path: 'src/a b.ts' })).toBe(
      '#/projects/p_x/src%2Fa%20b.ts',
    );
    expect(routeHash(parseRoute('#/projects/p_x/src%2Fa%20b.ts'))).toBe('#/projects/p_x/src%2Fa%20b.ts');
  });
  it('writes what it reads', () => {
    for (const hash of ['#/start', '#/settings', '#/compare', '#/projects', '#/tools', '#/tools/json'])
      expect(routeHash(parseRoute(hash))).toBe(hash);
  });
});

describe('the address', () => {
  it('a new tab opens the main page with no route and no query; anything else was opened by its address', () => {
    expect(isNewTabLoad({ hash: '', search: '' })).toBe(true);
    expect(isNewTabLoad({ hash: '#/', search: '' })).toBe(true);
    expect(isNewTabLoad({ hash: '#/start', search: '' })).toBe(false);
    expect(isNewTabLoad({ hash: '#/tools', search: '' })).toBe(false);
    expect(isNewTabLoad({ hash: '', search: '?options' })).toBe(false);
  });

  it('?bare asks for the route without the frame', () => {
    expect(isBare('?options&bare')).toBe(true);
    expect(isBare('?options')).toBe(false);
    expect(isBare('')).toBe(false);
  });

  it('the options page that goes to another route drops the options flag and keeps the rest', () => {
    const at = (search: string, hash: string) => ({ pathname: '/src/app/index.html', search, hash });
    expect(addressLeavingOptions(at('?options', '#/settings'), { section: 'settings' })).toBeNull();
    expect(addressLeavingOptions(at('?options', '#/tools/json'), { section: 'tools', tool: 'json' })).toBe(
      '/src/app/index.html#/tools/json',
    );
    expect(addressLeavingOptions(at('?options&bare', '#/compare'), { section: 'compare' })).toBe(
      '/src/app/index.html?bare=#/compare',
    );
    expect(addressLeavingOptions(at('', '#/compare'), { section: 'compare' })).toBeNull();
  });
});
