/**
 * A remote `ParameterStorage` for tests only (seam `ParameterStorage`, parameterStorage.ts): a "server" in this
 * process's memory and devices that reach it with a delay, lose it for a while, are refused, and hear of each other's
 * writes. No network and no dependency. It is here to prove that an implementation which is not local needs no change
 * in the logic above the seam, in a tool or in a host's page — not to be a draft of a real one: it has no accounts, no
 * copy on the device and no queue of its own (a change it cannot deliver is answered `unavailable`).
 *
 * Every hop — a request to the server, an answer or a report back — takes `delay` ms, and what the server sends one
 * device arrives in the order it was sent.
 */
import type {
  ParameterEntry,
  ParameterStorage,
  ParameterWatcher,
  ParameterWrite,
  StoredParameters,
} from './parameterStorage';

/** One device's (or page's) connection to the fake server. */
export interface FakeRemoteDevice extends ParameterStorage {
  /** Cuts the device off (offline, signed out) or brings it back. */
  reach(on: boolean): void;
}

export interface FakeRemote {
  connect(): FakeRemoteDevice;
  /** A change made on a device that is none of ours: on the server at once, reported to our devices after the delay. */
  elsewhere(toolId: string, parameters: unknown): void;
  /** Puts a value on the server without a report to anyone — a change our devices have not been told of yet. */
  seed(toolId: string, parameters: unknown): void;
  /** What the server holds for the tool. */
  held(toolId: string): unknown;
  /** The server refuses every write (`failed`) — or takes them again. */
  refuse(on: boolean): void;
  /** Resolves when nothing is on its way (real timers only). */
  settle(): Promise<void>;
  /** How many writes reached the server, accepted or not. */
  readonly writes: number;
}

export const fakeRemote = ({ delay = 2 }: { delay?: number } = {}): FakeRemote => {
  const server = new Map<string, ParameterEntry>();
  const devices = new Set<{ announce(toolId: string): void }>();
  let version = 0;
  let refusing = false;
  let writes = 0;
  let onTheWay = 0;
  const idle = new Set<() => void>();

  const later = (job: () => void) => {
    onTheWay++;
    setTimeout(() => {
      try {
        job();
      } finally {
        if (--onTheWay === 0) {
          idle.forEach(resolve => resolve());
          idle.clear();
        }
      }
    }, delay);
  };
  const hop = <T>(job: () => T): Promise<T> => new Promise(resolve => later(() => resolve(job())));

  const put = (toolId: string, parameters: unknown): ParameterEntry | undefined => {
    const entry =
      parameters === undefined ? undefined : { parameters: structuredClone(parameters), revision: `r${++version}` };
    if (entry) server.set(toolId, entry);
    else server.delete(toolId);
    return entry;
  };
  const apply = (toolId: string, parameters: unknown): ParameterEntry | undefined => {
    const entry = put(toolId, parameters);
    devices.forEach(device => device.announce(toolId));
    return entry;
  };

  return {
    connect: () => {
      const watchers = new Set<ParameterWatcher>();
      let reachable = true;
      /** Tools this device could not be told of, or was refused for: reported when it is back. */
      const owed = new Set<string>();
      const announce = (toolId: string) => {
        if (!reachable) return void owed.add(toolId);
        const entry = server.get(toolId);
        later(() => (reachable ? watchers.forEach(w => w(toolId, entry)) : void owed.add(toolId)));
      };
      devices.add({ announce });
      const refusedHere = (toolId: string) => {
        owed.add(toolId);
        return undefined;
      };
      return {
        keeps: true,
        read: toolId => {
          if (!reachable) return hop(() => refusedHere(toolId));
          return hop(() => server.get(toolId)).then(entry => hop(() => entry));
        },
        write: (toolId: string, parameters: StoredParameters | undefined, base) => {
          if (!reachable) return hop((): ParameterWrite => (refusedHere(toolId), { status: 'unavailable' }));
          return hop((): ParameterWrite => {
            writes++;
            if (refusing) return { status: 'failed', reason: 'the server refused the write' };
            const current = server.get(toolId);
            if (current?.revision !== base) return { status: 'conflict', entry: current };
            return { status: 'accepted', entry: apply(toolId, parameters) };
          }).then(answer => hop(() => answer));
        },
        watch: listener => {
          watchers.add(listener);
          return () => void watchers.delete(listener);
        },
        reach: on => {
          reachable = on;
          if (!on) return;
          const tools = [...owed];
          owed.clear();
          tools.forEach(announce);
        },
      };
    },
    elsewhere: (toolId, parameters) => void apply(toolId, parameters),
    seed: (toolId, parameters) => void put(toolId, parameters),
    held: toolId => server.get(toolId)?.parameters,
    refuse: on => void (refusing = on),
    settle: async () => {
      for (;;) {
        await new Promise(resolve => setTimeout(resolve, 0));
        if (onTheWay === 0) return;
        await new Promise<void>(resolve => idle.add(resolve));
      }
    },
    get writes() {
      return writes;
    },
  };
};
