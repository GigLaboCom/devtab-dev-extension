import { DEFAULT_RELOAD_START_PORT, PING_MS, RELOAD_POOL_SIZE } from '../lib/consts.js';
import { planReloadPorts, publishedFromPool, reloadPool, startPortOf } from '../lib/port.js';
import { startReloadServer } from '../lib/reload-server.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { createServer } from 'node:net';
import type { DockerPorts } from '../lib/port.js';
import type { Server } from 'node:net';

const host = (ports: [number, number][]): DockerPorts =>
  Object.fromEntries(ports.map(([c, h]) => [`${c}/tcp`, [{ HostIp: '0.0.0.0', HostPort: String(h) }]]));
const noContainer = { inContainer: () => false, dockerPorts: () => Promise.resolve(null) };
const container = (ports: DockerPorts | null) => ({
  inContainer: () => true,
  dockerPorts: () => Promise.resolve(ports),
});

describe('the pool from the start port', () => {
  it('defaults to 8081…8090', () => {
    expect(reloadPool(startPortOf({}))).toEqual([8081, 8082, 8083, 8084, 8085, 8086, 8087, 8088, 8089, 8090]);
    expect(DEFAULT_RELOAD_START_PORT).toBe(8081);
    expect(RELOAD_POOL_SIZE).toBe(10);
  });
  it('the plugin’s startPort moves it; CEB_RELOAD_START_PORT wins over both', () => {
    expect(startPortOf({}, 9100)).toBe(9100);
    expect(startPortOf({ CEB_RELOAD_START_PORT: '9200' }, 9100)).toBe(9200);
    expect(startPortOf({ CEB_RELOAD_START_PORT: ' ' }, 9100)).toBe(9100);
  });
  it('refuses what is not a port, or a pool past 65535', () => {
    expect(() => startPortOf({ CEB_RELOAD_START_PORT: '80a' })).toThrow(/not a port/);
    expect(() => startPortOf({}, 70000)).toThrow(/not a port/);
    expect(() => reloadPool(65530)).toThrow(/past 65535/);
  });
});

describe('publishedFromPool', () => {
  it('keeps the pool’s published TCP ports with their host ports, in the pool’s order', () => {
    const ports: DockerPorts = {
      ...host([
        [8083, 18083],
        [8081, 18081],
        [9999, 9999],
      ]),
      '8082/tcp': null,
      '8084/udp': [],
    };
    expect(publishedFromPool([8081, 8082, 8083, 8084], ports)).toEqual([
      { listen: 8081, client: 18081 },
      { listen: 8083, client: 18083 },
    ]);
  });
});

describe('planReloadPorts', () => {
  it('CEB_RELOAD_PORT (+ CEB_RELOAD_HOST_PORT) wins over everything', async () => {
    expect(
      await planReloadPorts(undefined, { CEB_RELOAD_PORT: '7001', CEB_RELOAD_HOST_PORT: '17001' }, container({})),
    ).toEqual({
      via: 'env',
      candidates: [{ listen: 7001, client: 17001 }],
    });
    expect((await planReloadPorts(undefined, { CEB_RELOAD_PORT: '7001' }, noContainer)).candidates).toEqual([
      { listen: 7001, client: 7001 },
    ]);
  });
  it('outside a container: the pool as is, from the start port', async () => {
    const plan = await planReloadPorts(7001, {}, noContainer);
    expect(plan.via).toBe('pool');
    expect(plan.candidates).toHaveLength(10);
    expect(plan.candidates[0]).toEqual({ listen: 7001, client: 7001 });
    expect(plan.candidates[9]).toEqual({ listen: 7010, client: 7010 });
  });
  it('in a container: only what it publishes, dialed on the host port (a port offset)', async () => {
    const plan = await planReloadPorts(
      undefined,
      {},
      container(
        host([
          [8081, 8091],
          [8082, 8092],
        ]),
      ),
    );
    expect(plan.via).toBe('docker');
    expect(plan.candidates).toEqual([
      { listen: 8081, client: 8091 },
      { listen: 8082, client: 8092 },
    ]);
  });
  it('in a container that publishes none of the pool: no candidates, and says how to fix it', async () => {
    const plan = await planReloadPorts(undefined, {}, container({}));
    expect(plan.candidates).toEqual([]);
    expect(plan.note).toMatch(/publishes none of 8081…8090/);
  });
  it('in a container without the Docker socket: the pool as is, flagged as a guess', async () => {
    const plan = await planReloadPorts(undefined, { CEB_RELOAD_START_PORT: '7001' }, container(null));
    expect(plan.candidates[0]).toEqual({ listen: 7001, client: 7001 });
    expect(plan.note).toMatch(/mapping is unknown/);
  });
});

describe('startReloadServer', () => {
  const closers: (() => void)[] = [];
  afterEach(() => {
    closers.splice(0).forEach(c => c());
    vi.restoreAllMocks();
  });
  const freePort = (): Promise<number> =>
    new Promise(resolve => {
      const s = createServer().listen(0, () => {
        const { port } = s.address() as { port: number };
        s.close(() => resolve(port));
      });
    });
  const hold = (port: number): Promise<Server> =>
    new Promise(resolve => {
      const s = createServer().listen(port, () => resolve(s));
    });

  it('skips a busy port, dials the host port, and broadcasts DO_UPDATE to its clients', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const [busy, free] = [await freePort(), await freePort()];
    const blocker = await hold(busy);
    closers.push(() => blocker.close());
    const server = await startReloadServer('t', {
      via: 'docker',
      candidates: [
        { listen: busy, client: busy + 1 },
        { listen: free, client: 40000 },
      ],
    });
    expect(server?.port).toEqual({ listen: free, client: 40000 });
    expect(server?.url).toBe('ws://localhost:40000');

    const ws = new WebSocket(`ws://localhost:${free}`);
    closers.push(() => ws.close());
    await new Promise(resolve => ws.once('open', resolve));
    const got = new Promise(resolve => ws.once('message', data => resolve(JSON.parse(String(data)))));
    server!.broadcast('build-1');
    expect(await got).toEqual({ type: 'do_update', id: 'build-1' });
  });

  it('pings its clients every 20 s — an MV3 service worker with a quiet socket is stopped after ~30 s', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ['setInterval'] });
    const port = await freePort();
    await startReloadServer('t', { via: 'pool', candidates: [{ listen: port, client: port }] });
    const ws = new WebSocket(`ws://localhost:${port}`);
    closers.push(
      () => ws.close(),
      () => vi.useRealTimers(),
    );
    await new Promise(resolve => ws.once('open', resolve));
    const got = new Promise(resolve => ws.once('message', data => resolve(JSON.parse(String(data)))));
    vi.advanceTimersByTime(PING_MS);
    expect(await got).toEqual({ type: 'ping' });
  });

  it('none bindable → null and a warning, never a crash', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await startReloadServer('t', { via: 'docker', candidates: [], note: 'publishes none' })).toBeNull();
    expect(warn.mock.calls[0]?.[0]).toMatch(/no reload server.*publishes none/);
  });
});
