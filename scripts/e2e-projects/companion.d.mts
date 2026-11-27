// The types of ./companion.mjs, for the extension's unit tests that run against it.
export declare const MAX_FRAME_BYTES: number;
export declare const MAX_TEXT_BYTES: number;
export declare const METHODS: string[];
export declare const HOSTILE_STRINGS: Record<'name' | 'branch' | 'file' | 'label' | 'line', string>;

export type Frame = Record<string, unknown>;

export declare const chunked: (frame: Frame, max?: number) => Frame[];

export interface ScriptedCompanion {
  welcome: Frame;
  subscribed: Set<string>;
  handle(frame: unknown, send: (frame: Frame) => void): Promise<void>;
  emit(name: string, project: string | null, data: unknown, send: (frame: Frame) => void): boolean;
  addFile(project: string, path: string, text: string): void;
}

export declare const createCompanion: (options?: {
  vectors?: Record<string, unknown>;
  mode?: 'normal' | 'empty' | 'version' | 'not-running';
  hostile?: boolean;
  big?: boolean;
  wait?: (ms: number) => Promise<void>;
  maxFrameBytes?: number;
}) => ScriptedCompanion;
