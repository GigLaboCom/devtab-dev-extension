/**
 * Seam `ProjectBackend`: its contract (./contract.ts) on every implementation — the demo's, and the companion's client
 * over the scripted companion (seeded from the companion's vectors) — and the composition root's choice between them.
 */
import { chosenBackend, projectsBehaviors } from './behaviors';
import { companionBackend } from './companion/backend';
import { fakeCompanion } from './companion/fakeLink';
import { createConnection } from './connection';
import { projectBackendContract } from './contract';
import { demoBackend } from './demo/backend';
import { describe, expect, it } from 'vitest';
import type { PermissionGate } from './permission';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0));
};

const permission = (granted: boolean): PermissionGate => ({
  contains: () => Promise.resolve(granted),
  request: () => Promise.resolve(granted),
  usable: () => granted,
  onAdded: () => () => undefined,
  onRemoved: () => () => undefined,
});

const connection = (granted = true) =>
  createConnection({
    permission: permission(granted),
    openLink: fakeCompanion().openLink,
    extension: '1.0.0',
    reload: () => undefined,
  });

projectBackendContract('demo', () => ({ backend: demoBackend({ wait: () => Promise.resolve() }), settle }));
projectBackendContract('companion (scripted)', () => ({ backend: companionBackend(connection()), settle }));

describe('the composition root', () => {
  it('names one backend per page that follows the connection', () => {
    expect(projectsBehaviors().backend.id).toBe('companion-or-demo');
  });

  it('without the permission: the demo, a new one with its own state for each page', async () => {
    const [one, two] = [
      chosenBackend(connection(false), demoBackend()),
      chosenBackend(connection(false), demoBackend()),
    ];
    await one.connect();
    await two.connect();
    expect(one.status().state).toBe('no-permission');
    expect(one.name).toBe('demo');
    expect(one.capabilities().demo).toBe(true);
    const [project] = await one.call('projects.list', {});
    await one.call('file.create', { project: project!.id, path: 'only-in-one.txt', text: '' });
    await expect(two.call('file.read', { project: project!.id, path: 'only-in-one.txt' })).rejects.toThrow();
  });

  it('with the companion connected: the companion’s projects', async () => {
    const backend = chosenBackend(connection(), demoBackend());
    await backend.connect();
    expect(backend.status().state).toBe('ready');
    expect(backend.name).toBe('companion');
    expect(backend.capabilities().demo).toBe(false);
    expect((await backend.call('projects.list', {})).map(p => p.id)).toEqual(['p_abcdefgh23']);
    backend.dispose();
  });
});
