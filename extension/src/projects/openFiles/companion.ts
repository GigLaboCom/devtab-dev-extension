/**
 * `companionOpenedFiles` — the seam `OpenedFiles` (./files.ts) over the companion, and the ONE module that knows the
 * wire of files opened from the system: the methods `openFile.*` and `page.activity`, the event `open.requested`, and
 * the shapes of their requests and answers (the companion's contract, ../api/types.gen.ts). What the page gets is the
 * seam's own types, read here field by field: an answer in a shape this module cannot read is an `internal` error,
 * never a crash, and an unknown mark is no mark.
 *
 * The calls go through the page's backend (the section's one port, ../backend.ts): a method the companion's `welcome`
 * does not list is refused there with `unknown-method` and never sent. `offered()` asks the same list, so the page does
 * not even try. The event comes with the companion's own events (`subscribe(null, …)`); the companion sends it only to
 * a connection that has told it `page.activity`.
 */
import { CompanionError } from '../types';
import type { ProjectBackend } from '../backend';
import type { Method } from '../types';
import type {
  Claim,
  OpenedAt,
  OpenedFile,
  OpenedFilePoint,
  OpenedFileReason,
  OpenedFiles,
  OpenedFilesAction,
  OpenedFilesFactory,
} from './files';

/** The event that says a file waits for the page. */
export const OPEN_REQUESTED = 'open.requested';

/** The methods without which there are no opened files on the page. */
const CORE: readonly Method[] = ['openFile.claim', 'openFile.read', 'openFile.list'];

const ACTIONS: Record<OpenedFilesAction, Method> = {
  save: 'openFile.save',
  history: 'openFile.history',
  historyContent: 'openFile.historyContent',
  restore: 'openFile.restore',
  forget: 'openFile.forget',
  activity: 'page.activity',
};

const REASONS: readonly OpenedFileReason[] = [
  'secret',
  'executes',
  'remote',
  'not-utf8',
  'read-only-file',
  'requested',
  'replaced',
];
const VIAS = ['open-with', 'terminal', 'link'] as const;
const CLASSES = ['view', 'mine'] as const;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const isIndex = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

const unreadable = (method: Method): CompanionError =>
  new CompanionError('internal', `the companion answered ${method} in a shape this page does not read`);

const atOf = (answer: Record<string, unknown>): OpenedAt | null =>
  isIndex(answer.line) ? { line: answer.line, ...(isIndex(answer.column) && { column: answer.column }) } : null;

/** An opened file as the seam has it, from a claim's (`kind: "file"`) or a list's entry; null when it is not one. */
const fileOf = (entry: unknown): OpenedFile | null => {
  if (!isObject(entry)) return null;
  const { file, name, displayPath, mode, executes, reason, via, openedAt } = entry;
  if (!isText(file) || !isText(name) || typeof displayPath !== 'string' || (mode !== 'edit' && mode !== 'read'))
    return null;
  return {
    id: file,
    name,
    displayPath,
    mode,
    executes: executes === true,
    reason: mode === 'read' && REASONS.includes(reason as OpenedFileReason) ? (reason as OpenedFileReason) : null,
    via: VIAS.includes(via as (typeof VIAS)[number]) ? (via as OpenedFile['via']) : null,
    openedAt: Number.isFinite(openedAt) ? (openedAt as number) : null,
  };
};

const pointOf = (entry: unknown): OpenedFilePoint | null => {
  if (!isObject(entry)) return null;
  const { point, label, timeMs, size, content } = entry;
  if (!isText(point) || typeof label !== 'string' || !Number.isFinite(timeMs)) return null;
  return { point, label, timeMs: timeMs as number, size: isIndex(size) ? size : 0, content: content !== false };
};

export const companionOpenedFiles: OpenedFilesFactory = Object.assign(
  (backend: ProjectBackend): OpenedFiles => {
    const announced = (method: Method): boolean => backend.capabilities().methods.includes(method);

    return {
      offered: () => CORE.every(announced),
      can: action => CORE.every(announced) && announced(ACTIONS[action]),
      async list() {
        const answer: unknown = await backend.call('openFile.list', {});
        if (!Array.isArray(answer)) throw unreadable('openFile.list');
        return answer.map(fileOf).filter((f): f is OpenedFile => f !== null);
      },
      async pending() {
        const answer: unknown = await backend.call('openFile.pending', {});
        if (!isObject(answer) || !Array.isArray(answer.tokens)) throw unreadable('openFile.pending');
        return answer.tokens.filter(isText);
      },
      async claim(token): Promise<Claim> {
        const answer: unknown = await backend.call('openFile.claim', { token });
        if (!isObject(answer)) throw unreadable('openFile.claim');
        const at = atOf(answer);
        if (answer.kind === 'file') {
          const file = fileOf(answer);
          if (file) return { kind: 'file', file, at };
        }
        if (
          answer.kind === 'project' &&
          isText(answer.project) &&
          typeof answer.path === 'string' &&
          CLASSES.includes(answer.class as (typeof CLASSES)[number])
        )
          return {
            kind: 'project',
            project: answer.project,
            path: answer.path,
            name: typeof answer.name === 'string' ? answer.name : answer.path,
            displayPath: typeof answer.displayPath === 'string' ? answer.displayPath : '',
            class: answer.class as (typeof CLASSES)[number],
            at,
          };
        throw unreadable('openFile.claim');
      },
      async read(file) {
        const answer = await backend.call('openFile.read', { file });
        if (!isObject(answer) || typeof answer.text !== 'string' || typeof answer.hash !== 'string')
          throw unreadable('openFile.read');
        return answer;
      },
      async save(file, baseHash, text) {
        const answer: unknown = await backend.call('openFile.save', { file, baseHash, text });
        if (!isObject(answer) || !isText(answer.hash)) throw unreadable('openFile.save');
        return { hash: answer.hash };
      },
      async history(file) {
        const answer: unknown = await backend.call('openFile.history', { file });
        if (!isObject(answer) || !Array.isArray(answer.points)) throw unreadable('openFile.history');
        return answer.points.map(pointOf).filter((p): p is OpenedFilePoint => p !== null);
      },
      async historyContent(file, point) {
        const answer: unknown = await backend.call('openFile.historyContent', { file, point });
        if (!isObject(answer) || typeof answer.text !== 'string') throw unreadable('openFile.historyContent');
        return { text: answer.text, secret: answer.secret === true };
      },
      async restore(file, point, currentHash) {
        const answer: unknown = await backend.call('openFile.restore', { file, point, currentHash });
        if (!isObject(answer) || !isText(answer.hash)) throw unreadable('openFile.restore');
        return { hash: answer.hash, before: typeof answer.before === 'string' ? answer.before : '' };
      },
      async forget(file) {
        await backend.call('openFile.forget', { file });
      },
      async activity(visible, focusedAt) {
        if (!announced('page.activity')) return;
        await backend.call('page.activity', { visible, focusedAt: Math.max(0, Math.floor(focusedAt)) });
      },
      onRequested(listener) {
        return backend.subscribe(null, event => {
          if (event.name !== OPEN_REQUESTED || !isObject(event.data)) return;
          const { token } = event.data;
          if (isText(token)) listener(token);
        });
      },
    };
  },
  { id: 'companion' as const },
);
