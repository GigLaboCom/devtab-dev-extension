/** Seam `ProjectBackend`: its contract (./contract.ts) on every implementation — the demo's, today. */
import { projectsBehaviors } from './behaviors';
import { projectBackendContract } from './contract';
import { demoBackend } from './demo/backend';
import { describe, expect, it } from 'vitest';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

projectBackendContract('demo', () => ({ backend: demoBackend({ wait: () => Promise.resolve() }), settle }));

describe('the composition root', () => {
  it('names the demo, a new backend with its own state for each page', async () => {
    const behaviors = projectsBehaviors();
    expect(behaviors.backend.id).toBe('demo');
    const [one, two] = [behaviors.backend(), behaviors.backend()];
    expect(one).not.toBe(two);
    expect(one.name).toBe('demo');
    expect(one.capabilities().demo).toBe(true);
    const [project] = await one.call('projects.list', {});
    await one.call('file.create', { project: project!.id, path: 'only-in-one.txt', text: '' });
    await expect(two.call('file.read', { project: project!.id, path: 'only-in-one.txt' })).rejects.toThrow();
  });
});
