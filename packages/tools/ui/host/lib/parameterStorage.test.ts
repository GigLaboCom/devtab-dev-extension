import { fakeRemote } from './fakeRemote.testing';
import { parameterStorageContract } from './parameterStorageContract';
import { PLACES } from './places.testing';
import { describe, expect, it } from 'vitest';

for (const [name, place] of PLACES) parameterStorageContract(name, place);

describe('the fake remote (tests only)', () => {
  it('answers after its delay, and reports a change made on another device to every device that is in reach', async () => {
    const remote = fakeRemote({ delay: 5 });
    const here = remote.connect();
    const heard: Array<[string, unknown]> = [];
    here.watch((toolId, entry) => heard.push([toolId, entry?.parameters]));
    let answered = false;
    const write = here.write('json', { schema: 1, values: { indent: 4 } }, undefined).then(answer => {
      answered = true;
      return answer;
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(answered).toBe(false);
    expect(remote.held('json')).toBeUndefined();
    expect((await write).status).toBe('accepted');
    expect(remote.writes).toBe(1);
    remote.elsewhere('json', { schema: 1, values: { indent: 2 } });
    expect(heard.at(-1)).toEqual(['json', { schema: 1, values: { indent: 4 } }]);
    await remote.settle();
    expect(heard.at(-1)).toEqual(['json', { schema: 1, values: { indent: 2 } }]);
  });
});
