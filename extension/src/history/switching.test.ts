// @vitest-environment node
import { switchingHolder, switchingStore } from './switching';
import { memoryKeyHolder, memoryStore } from '@workspace/tools-shared/history';
import { describe, expect, it, vi } from 'vitest';

const holder = () => ({ ...memoryKeyHolder(), touch: vi.fn(), dispose: vi.fn() });
const key = (n: number) => new Map([['k', new Uint8Array([n])]]);

describe('switchingStore', () => {
  it('forwards every call to the store in use; use() changes it for the calls that follow', async () => {
    const one = memoryStore();
    const two = memoryStore();
    await one.putKeyring('a', 'line-a');
    const switching = switchingStore(one);
    expect([...(await switching.store.keyrings()).keys()]).toEqual(['a']);
    switching.use(two);
    expect([...(await switching.store.keyrings()).keys()]).toEqual([]);
    await switching.store.putKeyring('b', 'line-b');
    expect([...(await two.keyrings()).keys()]).toEqual(['b']);
    expect([...(await one.keyrings()).keys()]).toEqual(['a']);
    expect((await switching.store.stats()).records).toBe(0);
  });

  it('a call begun before the change ends in the store it began with', async () => {
    const one = memoryStore();
    const switching = switchingStore(one);
    const writing = switching.store.putKeyring('a', 'line-a');
    switching.use(memoryStore());
    await writing;
    expect([...(await one.keyrings()).keys()]).toEqual(['a']);
  });
});

describe('switchingHolder', () => {
  it('forwards get, set, clear and touch to the holder in use', async () => {
    const one = holder();
    const two = holder();
    const switching = switchingHolder(one);
    await switching.holder.set(key(1));
    expect(await one.get()).toEqual(key(1));
    switching.use(two);
    expect((await switching.holder.get()).size).toBe(0);
    switching.holder.touch();
    expect(two.touch).toHaveBeenCalledTimes(1);
    expect(one.touch).not.toHaveBeenCalled();
    await switching.holder.clear();
    expect(await one.get()).toEqual(key(1));
  });

  it('listeners hear the holder in use only, and once at a change (so the keys are read again)', async () => {
    const one = holder();
    const two = holder();
    const switching = switchingHolder(one);
    const heard = vi.fn();
    const undo = switching.holder.subscribe(heard);
    await one.set(key(1));
    expect(heard).toHaveBeenCalledTimes(1);
    switching.use(two);
    expect(heard).toHaveBeenCalledTimes(2);
    await one.set(key(2));
    expect(heard).toHaveBeenCalledTimes(2);
    await two.set(key(3));
    expect(heard).toHaveBeenCalledTimes(3);
    switching.use(two);
    expect(heard).toHaveBeenCalledTimes(3);
    undo();
    await two.clear();
    expect(heard).toHaveBeenCalledTimes(3);
  });
});
