/**
 * Seam `PaletteSource`: the shared contract every implementation passes (IMPLEMENTATIONS), then what the default —
 * our places from their definitions — offers before anything is typed and for a query.
 */
import { MAX_RECENT_ROWS, placesPalette } from './palette';
import { DESTINATIONS, SECTION_DESTINATIONS, SETTINGS_DESTINATION } from '@src/shared/destinations';
import { TOOLS } from '@src/tools/registry';
import { describe, expect, it } from 'vitest';
import type { PaletteSource } from './palette';
import type { FinderGroup } from '@src/shared/finder';

const IMPLEMENTATIONS: Array<[string, () => PaletteSource]> = [['placesPalette', () => placesPalette(DESTINATIONS)]];

const rows = (groups: readonly FinderGroup[]) => groups.flatMap(g => g.results);
const hashes = (groups: readonly FinderGroup[]) =>
  rows(groups).map(r =>
    r.kind === 'open' ? r.destination.hash : r.kind === 'web' ? `web:${r.text}` : `command:${r.id}`,
  );

describe.each(IMPLEMENTATIONS)('PaletteSource contract: %s', (_name, make) => {
  it('answers with a promise, also for the empty query; every row it offers can be opened', async () => {
    const source = make();
    const offer = source.offer('', { recent: [] });
    expect(offer).toBeInstanceOf(Promise);
    const groups = await offer;
    expect(rows(groups).length).toBeGreaterThan(0);
    for (const group of groups) expect(group.id).toMatch(/\S/);
    for (const hash of hashes(groups)) expect(hash).toMatch(/^#\//);
  });

  it('a group id is unique, so the list can key its rows by group', async () => {
    const groups = await make().offer('', { recent: ['#/compare'] });
    expect(new Set(groups.map(g => g.id)).size).toBe(groups.length);
  });

  it('a query finds a place by its title, best first; nothing found is no rows', async () => {
    const source = make();
    expect(hashes(await source.offer('json', { recent: [] }))[0]).toBe('#/tools/json');
    expect(hashes(await source.offer('  Compare ', { recent: [] }))[0]).toBe('#/compare');
    expect(rows(await source.offer('zzzz-nothing', { recent: [] }))).toEqual([]);
  });

  it('reads nothing but its arguments: the same query gives the same rows', async () => {
    const source = make();
    expect(await source.offer('ha', { recent: [] })).toEqual(await source.offer('ha', { recent: [] }));
  });
});

describe('placesPalette', () => {
  it('before anything is typed: the places opened last, then the menu — sections, then each one’s places', async () => {
    const groups = await placesPalette(DESTINATIONS).offer('', { recent: ['#/tools/hash', '#/compare', '#/nope'] });
    expect(groups.map(g => [g.id, g.label])).toEqual([
      ['recent', 'Recent'],
      ['places', 'Go to'],
      ['tools', 'Tools'],
    ]);
    expect(hashes([groups[0]])).toEqual(['#/tools/hash', '#/compare']);
    expect(hashes([groups[1]])).toEqual([...SECTION_DESTINATIONS, SETTINGS_DESTINATION].map(d => d.hash));
    // Every tool of the registry, in its order — from the definitions, not a list here.
    expect(hashes([groups[2]])).toEqual(TOOLS.map(t => `#/tools/${t.id}`));
  });

  it('no recent group without recent places, and at most a few recent rows', async () => {
    const none = await placesPalette(DESTINATIONS).offer('', { recent: [] });
    expect(none[0].id).toBe('places');
    const many = await placesPalette(DESTINATIONS).offer('', {
      recent: DESTINATIONS.map(d => d.hash),
    });
    expect(many[0].results).toHaveLength(MAX_RECENT_ROWS);
  });

  it('a query is not cut at the start page’s six rows: the palette’s list scrolls', async () => {
    const places = Array.from({ length: 12 }, (_, i) => ({
      id: `tools/t${i}`,
      kind: 'tool' as const,
      title: `Tool ${i}`,
      summary: '',
      keywords: [],
      hash: `#/tools/t${i}`,
      parent: 'tools',
    }));
    expect(rows(await placesPalette(places).offer('tool', { recent: [] }))).toHaveLength(12);
  });

  it('a query finds the commands that have a target now, ranked with the places; none before anything is typed', async () => {
    const commands = [
      { id: 'scratch:new', title: 'New scratch file', keywords: ['scratch', 'note'] },
      { id: 'projects:files', title: 'Files panel', keywords: ['tree'] },
    ];
    const source = placesPalette(DESTINATIONS);
    expect(hashes(await source.offer('new scratch', { recent: [], commands }))[0]).toBe('command:scratch:new');
    expect(hashes(await source.offer('scratch', { recent: [], commands }))).toContain('command:scratch:new');
    const found = rows(await source.offer('files panel', { recent: [], commands }))[0];
    expect(found).toMatchObject({ kind: 'command', id: 'projects:files', title: 'Files panel' });
    // Not offered now (no target): not found.
    expect(hashes(await source.offer('new scratch', { recent: [] }))).not.toContain('command:scratch:new');
    // The empty query shows the places as before.
    expect(await source.offer('', { recent: [], commands })).toEqual(await source.offer('', { recent: [] }));
  });

  it('answers at once: the rows are readable without waiting (React’s `use` reads them in the same frame)', () => {
    const offer = placesPalette(DESTINATIONS).offer('json', { recent: [] }) as Promise<unknown> & { status?: string };
    expect(offer.status).toBe('fulfilled');
  });
});
