/**
 * The places the host package's own tests run the two contract suites over (parameterStorageContract.ts,
 * settingsContract.ts): every implementation of seam `ParameterStorage` this package has — in memory, switched off —
 * and the fake remote (fakeRemote.testing.ts). The extension adds its local one in its own tests.
 */
import { fakeRemote } from './fakeRemote.testing';
import { memoryParameterStorage, noParameterStorage } from './parameterStorage';
import type { FakeRemoteDevice } from './fakeRemote.testing';
import type { StoredParameters } from './parameterStorage';
import type { ParameterStorageHarness } from './parameterStorageContract';

/** One storage object shared by every page, as a host with no storage of its own shares it. */
export const memoryPlace = (): ParameterStorageHarness => {
  const place = memoryParameterStorage();
  return {
    open: () => place,
    held: async toolId => (await place.read(toolId))?.parameters,
    seed: async (toolId, raw) =>
      void (await place.write(toolId, raw as StoredParameters, (await place.read(toolId))?.revision)),
    settle: async () => undefined,
  };
};

/** No place at all: there is nothing to look at past the storage. */
export const offPlace = (): ParameterStorageHarness => ({
  open: noParameterStorage,
  held: async () => undefined,
  seed: async () => undefined,
  settle: async () => undefined,
});

/** A server with a delay; every page is a device of its own, which can be cut off; the server can refuse. */
export const remotePlace = (): ParameterStorageHarness => {
  const remote = fakeRemote();
  return {
    open: remote.connect,
    held: async toolId => remote.held(toolId),
    seed: async (toolId, raw) => remote.seed(toolId, raw),
    settle: remote.settle,
    refuse: remote.refuse,
    cut: (storage, on) => (storage as FakeRemoteDevice).reach(!on),
  };
};

export const PLACES = [
  ['in memory', memoryPlace],
  ['switched off', offPlace],
  ['a fake remote', remotePlace],
] as const;
