import type { DONE_UPDATE, DO_UPDATE, PING } from './consts.js';

export type WebSocketMessage =
  { type: typeof DO_UPDATE; id: string } | { type: typeof DONE_UPDATE } | { type: typeof PING };

/** Which dev reload client to prepend into a chunk. */
export type InjectionKind = 'reload' | 'refresh';

export interface WatchRebuildRule {
  /** Tested against the chunk's facadeModuleId (posix path) and its bundle key. */
  match: RegExp;
  inject: InjectionKind;
}

export interface WatchRebuildConfig {
  /** Stable id gating which build's DO_UPDATE the injected clients respond to; also the log prefix. */
  id: string;
  /**
   * Injection targeting. Unlike the reference (which injected into every chunk), rules make every
   * chunk opt-in: only entries that match a rule get a reload client. Shared/vendor chunks stay
   * byte-identical to prod, and a future content script running in a page's MAIN world (page CSP
   * would block the WebSocket there) is left clean unless a rule names it explicitly.
   */
  rules: WatchRebuildRule[];
  /**
   * The first port of the reload server's pool (10 ports from it). Default 8081 (→ 8081…8090); the root `.env`'s
   * `CEB_RELOAD_START_PORT` overrides it.
   */
  startPort?: number;
}
