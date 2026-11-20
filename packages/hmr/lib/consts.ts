/** The reload server's pool: `RELOAD_POOL_SIZE` ports from the start port; the first free (and, in a container,
 * published) wins. The start: `CEB_RELOAD_START_PORT` → the plugin's `startPort` → this default. */
export const DEFAULT_RELOAD_START_PORT = 8081;
export const RELOAD_POOL_SIZE = 10;
export const DO_UPDATE = 'do_update';
export const DONE_UPDATE = 'done_update';
export const PING = 'ping';
/** How often the server pings its clients: a message under 30 s keeps an MV3 service worker (and its socket) awake. */
export const PING_MS = 20_000;
