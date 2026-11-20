import { DEFAULT_RELOAD_START_PORT, RELOAD_POOL_SIZE } from './consts.js';
import { existsSync, readFileSync } from 'node:fs';
import { request } from 'node:http';

/**
 * Which port the dev reload server listens on, and which one the extension (Chrome, on the HOST) dials.
 *
 * Inside a dev container they differ: the container publishes some of its ports to the host — maybe under
 * another number (a port offset: 8081 → 18081), maybe none at all (preset ports already busy on the host
 * are skipped at the container's start). The container reads its own mapping through the Docker socket
 * (`docker inspect $HOSTNAME`), so the build bakes the HOST port into the reload client.
 *
 * Order: `CEB_RELOAD_PORT` (+ `CEB_RELOAD_HOST_PORT`) when set → the pool's ports the container publishes → the pool
 * as is (no container, or its mapping unknown). The pool is 10 ports from the start port: `CEB_RELOAD_START_PORT` in
 * the root `.env`, else the plugin's `startPort`, else 8081 (→ 8081…8090). The server takes the first candidate it
 * can bind (another project's dev may hold the first ones).
 */
export interface PortCandidate {
  /** The port the server binds (inside the container). */
  listen: number;
  /** The port the extension dials (on the host). */
  client: number;
}

export interface PortPlan {
  candidates: PortCandidate[];
  /** How the candidates were found — for the log line. */
  via: 'env' | 'docker' | 'pool';
  /** Why there are none, or why the mapping is a guess. */
  note?: string;
}

/** Docker's `NetworkSettings.Ports`: «8081/tcp» → its host bindings (null: exposed, not published). */
export type DockerPorts = Record<string, { HostIp?: string; HostPort?: string }[] | null>;

const toPort = (s: string): number => {
  const n = Number(s.trim());
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`[hmr] not a port: «${s}»`);
  return n;
};

/** The pool: `RELOAD_POOL_SIZE` ports from `start`. */
export const reloadPool = (start: number): number[] => {
  if (start + RELOAD_POOL_SIZE - 1 > 65535) throw new Error(`[hmr] the pool from ${start} runs past 65535`);
  return Array.from({ length: RELOAD_POOL_SIZE }, (_, i) => start + i);
};

/** The start port: `CEB_RELOAD_START_PORT` → the plugin's `startPort` → 8081. */
export const startPortOf = (env: NodeJS.ProcessEnv, startPort?: number): number => {
  const fromEnv = env['CEB_RELOAD_START_PORT'];
  if (fromEnv?.trim()) return toPort(fromEnv);
  return startPort === undefined ? DEFAULT_RELOAD_START_PORT : toPort(String(startPort));
};

/** The pool's ports the container publishes on TCP, each with its host port. */
export const publishedFromPool = (pool: number[], ports: DockerPorts): PortCandidate[] =>
  pool.flatMap(listen => {
    const host = (ports[`${listen}/tcp`] ?? []).map(b => Number(b.HostPort)).find(p => Number.isInteger(p) && p > 0);
    return host ? [{ listen, client: host }] : [];
  });

export const inContainer = (): boolean => {
  if (existsSync('/.dockerenv') || existsSync('/run/.containerenv')) return true;
  try {
    return /docker|containerd|kubepods/.test(readFileSync('/proc/1/cgroup', 'utf8'));
  } catch {
    return false;
  }
};

const DOCKER_SOCKET = '/var/run/docker.sock';

/** This container's published ports via the Docker socket; null when there is no socket or it doesn't know us. */
export const dockerPorts = (id = process.env['HOSTNAME'] ?? ''): Promise<DockerPorts | null> =>
  new Promise(resolve => {
    if (!id || !existsSync(DOCKER_SOCKET)) return resolve(null);
    const req = request(
      { socketPath: DOCKER_SOCKET, path: `/containers/${encodeURIComponent(id)}/json`, timeout: 2_000 },
      res => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => (body += chunk));
        res.on('end', () => {
          if (res.statusCode !== 200) return resolve(null);
          try {
            const info = JSON.parse(body) as { NetworkSettings?: { Ports?: DockerPorts | null } };
            resolve(info.NetworkSettings?.Ports ?? {});
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
    req.end();
  });

export const planReloadPorts = async (
  startPort?: number,
  env: NodeJS.ProcessEnv = process.env,
  probe: { inContainer: () => boolean; dockerPorts: () => Promise<DockerPorts | null> } = {
    inContainer,
    dockerPorts: () => dockerPorts(),
  },
): Promise<PortPlan> => {
  const fixed = env['CEB_RELOAD_PORT'];
  if (fixed?.trim()) {
    const listen = toPort(fixed);
    const host = env['CEB_RELOAD_HOST_PORT'];
    return { via: 'env', candidates: [{ listen, client: host?.trim() ? toPort(host) : listen }] };
  }
  const pool = reloadPool(startPortOf(env, startPort));
  const asIs = pool.map(p => ({ listen: p, client: p }));
  if (!probe.inContainer()) return { via: 'pool', candidates: asIs };

  const ports = await probe.dockerPorts();
  if (!ports)
    return {
      via: 'pool',
      candidates: asIs,
      note: 'in a container, but its port mapping is unknown (no Docker socket) — assuming host port = container port',
    };
  const published = publishedFromPool(pool, ports);
  return published.length
    ? { via: 'docker', candidates: published }
    : {
        via: 'docker',
        candidates: [],
        note:
          `the container publishes none of ${pool[0]}…${pool[pool.length - 1]} to the host — relaunch it with ` +
          `these ports published (e.g. \`ports: ["${pool[0]}-${pool[pool.length - 1]}"]\` + \`--port-offset\`), or set ` +
          'CEB_RELOAD_START_PORT to a published range, or CEB_RELOAD_PORT / CEB_RELOAD_HOST_PORT',
      };
};
