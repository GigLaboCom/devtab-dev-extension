import { DONE_UPDATE, DO_UPDATE, PING, PING_MS } from './consts.js';
import { planReloadPorts } from './port.js';
import { WebSocket, WebSocketServer } from 'ws';
import type { PortCandidate, PortPlan } from './port.js';
import type { WebSocketMessage } from './types.js';

export interface ReloadServer {
  /** What the extension dials: ws://localhost:<the host port>. */
  url: string;
  port: PortCandidate;
  /** Tell every connected client that the build `id` landed. */
  broadcast: (id: string) => void;
}

/** Bind the first candidate that is free; null when none is (another project's dev holds them all). */
const bindFirst = async (
  candidates: PortCandidate[],
): Promise<{ wss: WebSocketServer; port: PortCandidate } | null> => {
  for (const port of candidates) {
    const wss = await new Promise<WebSocketServer | null>((resolve, reject) => {
      const server = new WebSocketServer({ port: port.listen });
      server.once('listening', () => resolve(server));
      server.once('error', (error: NodeJS.ErrnoException) => {
        server.close();
        if (error.code === 'EADDRINUSE' || error.code === 'EACCES') resolve(null);
        else reject(error);
      });
    });
    if (wss) return { wss, port };
  }
  return null;
};

/**
 * The dev reload broker, inside the `vite build --watch` process (the reference ran it as a separate turbo task on a
 * fixed 8081: two projects' dev in one container then shared — or lost — one broker, and the port the extension dialed
 * was the container's, not the host's). Here the build picks the port (`planReloadPorts`), bakes its URL into the
 * clients it injects, and after every rebuild broadcasts DO_UPDATE itself.
 */
export const startReloadServer = async (
  log: string,
  plan?: PortPlan | { startPort?: number },
): Promise<ReloadServer | null> => {
  const { candidates, via, note } = plan && 'candidates' in plan ? plan : await planReloadPorts(plan?.startPort);
  const bound = candidates.length ? await bindFirst(candidates) : null;
  if (!bound) {
    console.warn(
      `[${log}] no reload server — the extension will not auto-reload: ` +
        (note ?? `ports ${candidates.map(c => c.listen).join(', ')} are all busy (set CEB_RELOAD_START_PORT)`),
    );
    return null;
  }
  const { wss, port } = bound;
  const url = `ws://localhost:${port.client}`;
  const mapped = port.client === port.listen ? '' : ` (container :${port.listen})`;
  console.log(`[${log}] reload server on ${url}${mapped} — ${via}${note ? `; ${note}` : ''}`);

  const clients = new Set<WebSocket>();
  const send = (message: WebSocketMessage) => {
    const text = JSON.stringify(message);
    for (const client of clients) if (client.readyState === WebSocket.OPEN) client.send(text);
  };
  // Chrome stops an idle MV3 service worker after ~30 s, and its socket with it — then a rebuild reaches nobody. A
  // message every 20 s counts as activity and keeps it (dev only: this server never runs in a prod build).
  setInterval(() => send({ type: PING }), PING_MS).unref();
  wss.on('connection', ws => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
    ws.on('message', data => {
      try {
        if ((JSON.parse(String(data)) as WebSocketMessage).type === DONE_UPDATE) ws.close();
      } catch {
        // not ours — ignore
      }
    });
  });
  return {
    url,
    port,
    broadcast: id => send({ type: DO_UPDATE, id }),
  };
};
