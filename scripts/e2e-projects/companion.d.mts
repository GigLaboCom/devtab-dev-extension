// The types of ./companion.mjs, for the extension's unit tests that run against it.
export declare const MAX_FRAME_BYTES: number;
export declare const MAX_TEXT_BYTES: number;
export declare const METHODS: string[];
export declare const WRITE_METHODS: string[];
export declare const HISTORY_METHODS: string[];
export declare const OPEN_FILE_METHODS: string[];
export declare const TRUSTED_ROOT: string;
export declare const HOSTILE_STRINGS: Record<'name' | 'branch' | 'file' | 'label' | 'line', string>;

export type Frame = Record<string, unknown>;

export declare const chunked: (frame: Frame, max?: number) => Frame[];

export type Confirm = 'unavailable' | 'yes' | 'no' | 'busy' | 'requests-off' | 'rate-limited';

export interface ScriptedCompanion {
  welcome: Frame;
  subscribed: Set<string>;
  handle(frame: unknown, send: (frame: Frame) => void): Promise<void>;
  emit(name: string, project: string | null, data: unknown, send: (frame: Frame) => void): boolean;
  addFile(project: string, path: string, text: string): void;
  changeOnDisk(project: string, path: string, text: string | null): void;
  failNext(
    method: string,
    code: string,
    data?: Record<string, unknown>,
    options?: { stream?: string[]; pauseMs?: number; hang?: boolean; message?: string },
  ): void;
  setConfirm(answer: Confirm): void;
  setIdentity(identity: { name: string; email: string } | null): void;
  gap(project: string, from: number, to: number, paths?: number): void;
  /** Step O2 (`openFiles: true`): a file opened as «Open With» would, and its one-time token. */
  offerFile(spec: OfferedFile): { token: string; file: string | null };
  changeOpenedOnDisk(file: string, text: string): void;
  replaceOpened(file: string): void;
  requestOpen(token: string, send: (frame: Frame) => void): boolean;
  expireTokens(): void;
  opened: {
    activity: { visible: boolean; focusedAt: number | null }[];
    files: Map<string, { text: string; saves: number }>;
  };
}

export interface OfferedFile {
  token?: string;
  file?: string;
  name?: string;
  displayPath?: string;
  text?: string;
  mode?: 'edit' | 'read';
  executes?: boolean;
  /** Why it is read only (mode `read`; given alone, it makes the mode `read`). */
  reason?: 'secret' | 'executes' | 'remote' | 'not-utf8' | 'read-only-file' | 'requested' | 'replaced' | null;
  via?: 'open-with' | 'terminal' | 'link';
  line?: number;
  column?: number;
  /** A file of an added project instead. */
  project?: string;
  path?: string;
  class?: 'view' | 'mine';
  lifeMs?: number;
  /** Listed as if claimed before: no token waits (the answer's token is then empty). */
  claimed?: boolean;
}

export declare const createCompanion: (options?: {
  vectors?: Record<string, unknown>;
  mode?: 'normal' | 'empty' | 'fresh' | 'version' | 'not-running';
  hostile?: boolean;
  big?: boolean;
  wait?: (ms: number) => Promise<void>;
  maxFrameBytes?: number;
  methods?: 'all' | 'stage3' | 'stage6';
  replay?: boolean;
  confirm?: Confirm;
  identity?: { name: string; email: string } | null;
  now?: () => number;
  /** False: a companion older than the points' `content` and the full `welcome.limits`. */
  contentFlag?: boolean;
  /** Announced limits that replace the vectors' (`maxHistoryPage`, say). */
  limits?: Record<string, number>;
  /** A companion of step O2: it also offers `openFile.*` and `page.activity`. */
  openFiles?: boolean;
}) => ScriptedCompanion;
