/**
 * `projectSaver` (row 5.4) beyond the shared `SideSaver` contract (src/compare/seams.test.ts runs it there): Save goes
 * from the version the text started from and moves on with each save; a file changed on disk is a refusal that names
 * the disk's version; the write policy's refusals come back with their code and data; a file that runs code is named.
 */
import { demoBackend } from './demo/backend';
import { textHash } from './demo/diff';
import { errorOf, projectSaver } from './projectSaver';
import { describe, expect, it } from 'vitest';
import type { DemoProjectSeed } from './demo/data';

const seed: DemoProjectSeed = {
  id: 'p_saverunit',
  name: 'unit',
  displayPath: '~/unit',
  location: null,
  class: 'mine',
  via: 'terminal',
  branch: 'main',
  remote: null,
  upstream: null,
  behind: 0,
  hooks: [],
  head: { 'a.txt': 'one\n' },
  disk: { 'a.txt': 'one\n', '.env': 'X=1\n', '.husky/pre-commit': '#!/bin/sh\n' },
  ignore: [],
  commits: [{ summary: 'Start', author: 'Someone', ago: 60, pushed: false }],
  history: [],
  messages: [],
};
const request = (text: string) => ({ text, bom: false, suggestedName: 'a.txt', handle: null });

describe('projectSaver', () => {
  it('saves from the version it started from, then from the one it wrote', async () => {
    const backend = demoBackend({ projects: [seed], locations: [] });
    const saver = projectSaver(backend, seed.id, 'a.txt', textHash('one\n'));
    expect(await saver.save(request('two\n'))).toEqual({
      status: 'saved',
      fileName: 'a.txt',
      handle: null,
      how: 'file',
    });
    expect(saver.baseHash).toBe(textHash('two\n'));
    expect((await saver.save(request('three\n'))).status).toBe('saved');
    expect((await backend.call('file.read', { project: seed.id, path: 'a.txt' })).text).toBe('three\n');
  });

  it('a file changed on disk is not written: `conflict` with the disk’s version, for the page’s three choices', async () => {
    const backend = demoBackend({ projects: [seed], locations: [] });
    const saver = projectSaver(backend, seed.id, 'a.txt', textHash('one\n'));
    backend.controls.changeOnDisk(seed.id, 'a.txt', 'theirs\n');
    const result = await saver.save(request('mine\n'));
    expect(result).toMatchObject({ status: 'failed', code: 'conflict', data: { currentHash: textHash('theirs\n') } });
    expect(errorOf(result)?.code).toBe('conflict');
    // «Keep mine»: from the disk's version.
    await saver.write('mine\n', textHash('theirs\n'), 'explicit');
    expect((await backend.call('file.read', { project: seed.id, path: 'a.txt' })).text).toBe('mine\n');
  });

  it('a refusal of the write policy keeps its code; a file that runs code is named; Save as cancelled writes nothing', async () => {
    const backend = demoBackend({ projects: [seed], locations: [] });
    const secret = projectSaver(backend, seed.id, '.env', textHash('X=1\n'));
    expect(await secret.save(request('X=2\n'))).toMatchObject({ status: 'failed', code: 'secret-file' });
    const hook = projectSaver(backend, seed.id, '.husky/pre-commit', textHash('#!/bin/sh\n'));
    expect(await hook.write('#!/bin/sh\nexit 0\n', textHash('#!/bin/sh\n'), 'auto')).toMatchObject({
      protected: 'hooks',
    });
    expect(await hook.saveAs(request('x'))).toEqual({ status: 'cancelled' });
  });

  it('Save as creates the named file in the project and Save goes there next', async () => {
    const backend = demoBackend({ projects: [seed], locations: [] });
    const saver = projectSaver(backend, seed.id, 'a.txt', textHash('one\n'), { ask: async () => 'b/copy.txt' });
    expect(await saver.saveAs(request('copy\n'))).toMatchObject({ status: 'saved', fileName: 'copy.txt' });
    expect(saver.path).toBe('b/copy.txt');
    expect((await saver.save(request('copy 2\n'))).status).toBe('saved');
    expect((await backend.call('file.read', { project: seed.id, path: 'b/copy.txt' })).text).toBe('copy 2\n');
    expect(await saver.saveAs(request('again\n'))).toMatchObject({ status: 'failed', code: 'exists' });
  });
});
