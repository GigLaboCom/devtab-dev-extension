/**
 * Severity-gated logger, ported from @extension/logger debug.ts (chrome-extensions reference).
 *
 * Gate resolution order:
 *  1. an explicit setDebugMode(severity) call wins;
 *  2. otherwise dev detection: `process.env.NODE_ENV === 'development'` — vite statically
 *     replaces this literal at build time (dev builds run `vite build --mode development`), so
 *     no `process` reference survives into any bundle — or a
 *     `?debug` URL param;
 *  3. otherwise the prod default: WARN and above only.
 */
export const SEVERITY = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  FATAL: 4,
} as const;

export type LogSeverity = (typeof SEVERITY)[keyof typeof SEVERITY];

let currentSeverity: LogSeverity | null = null;
let isDebugEnabled: boolean | null = null;

export const setDebugMode = (severity: LogSeverity): void => {
  currentSeverity = severity;
};

export const resetDebugMode = (): void => {
  currentSeverity = null;
  isDebugEnabled = null;
};

const detectDebugMode = (): boolean => {
  const isDev = process.env.NODE_ENV === 'development';
  const hasDebugParam =
    typeof window !== 'undefined' &&
    typeof window.location !== 'undefined' &&
    new URLSearchParams(window.location.search).has('debug');
  return isDev || hasDebugParam;
};

const checkMode = (requestedSeverity: LogSeverity): boolean => {
  if (currentSeverity !== null) return requestedSeverity >= currentSeverity;
  if (isDebugEnabled === null) isDebugEnabled = detectDebugMode();
  if (isDebugEnabled) return true;
  return requestedSeverity >= SEVERITY.WARN;
};

const TAGS: Record<LogSeverity, string> = {
  [SEVERITY.DEBUG]: '[DEBUG]',
  [SEVERITY.INFO]: '[INFO]',
  [SEVERITY.WARN]: '[WARN]',
  [SEVERITY.ERROR]: '[ERROR]',
  [SEVERITY.FATAL]: '[FATAL]',
};

export interface DebugLogger {
  log: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  fatal: (...args: unknown[]) => void;
}

const emit = (
  severity: LogSeverity,
  consoleFn: (...args: unknown[]) => void,
  scope: string | undefined,
  args: unknown[],
): void => {
  if (!checkMode(severity)) return;
  const prefix = scope ? `${TAGS[severity]} [${scope}]` : TAGS[severity];
  consoleFn(prefix, ...args);
};

/**
 * Scoped logger factory (addition over the reference, which only had severity tags): tags every
 * line with the execution context, e.g. createDebug('app:compare').
 */
export const createDebug = (scope?: string): DebugLogger => ({
  log: (...args) => emit(SEVERITY.DEBUG, console.debug, scope, args),
  info: (...args) => emit(SEVERITY.INFO, console.info, scope, args),
  warn: (...args) => emit(SEVERITY.WARN, console.warn, scope, args),
  error: (...args) => emit(SEVERITY.ERROR, console.error, scope, args),
  fatal: (...args) => emit(SEVERITY.FATAL, console.error, scope, args),
});

/** Unscoped default logger, same shape as the reference's `debug` export. */
export const debug: DebugLogger = createDebug();
