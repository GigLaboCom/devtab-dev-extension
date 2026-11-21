import { detectTool, fieldResults, findDestinations } from './finder';
import { DESTINATIONS } from '@src/shared/destinations';
import { TOOLS } from '@src/tools/registry';
import { describe, expect, it } from 'vitest';

const titles = (query: string) => findDestinations(query, DESTINATIONS).map(d => d.title);

describe('the start page field', () => {
  it('finds our places by title first, then by keyword', () => {
    expect(titles('json')[0]).toBe('JSON');
    expect(titles('Comp')[0]).toBe('Compare code');
    expect(titles('diff')).toContain('Compare code');
    expect(titles('git')).toEqual(['Live review']);
    expect(titles('theme')).toEqual(['Settings']);
    expect(titles('minify')).toEqual(['JSON']);
    expect(titles('   ')).toEqual([]);
  });

  it('puts web search last, and only when it is on', () => {
    const on = fieldResults('json', { destinations: DESTINATIONS, webSearch: true });
    expect(on[0]).toMatchObject({ kind: 'open', destination: { id: 'tools/json' } });
    expect(on.at(-1)).toEqual({ kind: 'web', text: 'json' });
    expect(fieldResults('json', { destinations: DESTINATIONS, webSearch: false }).some(r => r.kind === 'web')).toBe(
      false,
    );
  });

  it('when nothing of ours matches, the web search is the first row — what Enter takes', () => {
    expect(fieldResults(' kittens 42 ', { destinations: DESTINATIONS, webSearch: true })).toEqual([
      { kind: 'web', text: 'kittens 42' },
    ]);
    expect(fieldResults('kittens', { destinations: DESTINATIONS, webSearch: false })).toEqual([]);
  });

  it('offers pasted text to the tools’ detect', () => {
    expect(detectTool('{"a": [1, 2]}', TOOLS)?.id).toBe('json');
    expect(detectTool('[1, 2', TOOLS)).toBeUndefined();
    expect(detectTool('hello world', TOOLS)).toBeUndefined();
    expect(detectTool('  ', TOOLS)).toBeUndefined();
  });
});
