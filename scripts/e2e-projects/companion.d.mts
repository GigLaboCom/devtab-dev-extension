// The types of ./companion.mjs, for the extension's unit tests that run against it.
export declare const MAX_FRAME_BYTES: number;
export declare const MAX_TEXT_BYTES: number;
export declare const METHODS: string[];
export declare const WRITE_METHODS: string[];
export declare const HISTORY_METHODS: string[];
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
}) => ScriptedCompanion;
