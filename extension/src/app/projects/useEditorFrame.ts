/**
 * The editor page in the Projects section's iframe (src/viewer/, the same module as «Compare code»): what the section
 * sends it (shared/viewerProtocol.ts) and what it answers. Messages wait until the editor has drawn; a full
 * replacement (two texts, one file) drops what waited before it. Only the answer to the latest request that changes
 * what is shown is taken, and the user's edits (no id) always are. The strip of the editor's buttons runs the editor's
 * commands through it (`command`, answered by `viewer/done` or `viewer/error`) and greys its buttons by what the module
 * last said the sides offer (`standing`).
 */
import { isFromViewer } from '@src/shared/viewerProtocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DiffShown, EditorStanding, Side } from '@extension/review-wasm';
import type { KeyChord, ToViewer, ViewerCommand } from '@src/shared/viewerProtocol';
import type { RefObject } from 'react';

type Request = Extract<ToViewer, { id: number }>;
type Replacing = 'viewer/compare' | 'viewer/show-diff' | 'viewer/show-file';

export interface EditorFrame {
  frame: RefObject<HTMLIFrameElement | null>;
  ready: boolean;
  /** The editor could not start. */
  failed: string | null;
  /** The latest result: what is shown (after a request, or after the user's edit). */
  shown: DiffShown | null;
  /** How many results have arrived (tests and the e2e wait on it). */
  shownCount: number;
  /** A request that changes what is shown; its id is made here. */
  request(make: (id: number) => Request): void;
  /** A message without an answer (edit mode, focus, a reveal, the keys). */
  post(message: Exclude<ToViewer, Request> | Request): void;
  /** The text of a side as the editor holds it now. */
  read(side: 'old' | 'new'): Promise<string>;
  /** What the sides offer the editor's commands, as the module last said (nothing before it has: all off). */
  standing: EditorStanding;
  /** Runs an editor command on a side (Paste with its text); `copied`: what a Copy or Cut took. */
  command(side: Side, command: ViewerCommand, text?: string): Promise<{ copied?: string }>;
}

/** Before the module has said anything: nothing editable, nothing selected. */
export const NO_STANDING: EditorStanding = {
  old: { editable: false, empty: true, selection: false },
  new: { editable: false, empty: true, selection: false },
};

export interface EditorFrameHooks {
  /** A key the editor hands up (⌘S, the frame's shortcuts). */
  onKey?(chord: KeyChord): void;
  /** Every result, the user's edits included. */
  onShown?(shown: DiffShown): void;
  /** An error of the latest request. */
  onError?(message: string): void;
}

const REPLACING = new Set<string>(['viewer/compare', 'viewer/show-diff', 'viewer/show-file'] satisfies Replacing[]);

export const useEditorFrame = (keys: KeyChord[], hooks: EditorFrameHooks): EditorFrame => {
  const frame = useRef<HTMLIFrameElement>(null);
  const readyRef = useRef(false);
  const outbox = useRef<ToViewer[]>([]);
  const nextId = useRef(0);
  const latest = useRef(0);
  const reads = useRef(new Map<number, { resolve: (text: string) => void; reject: (error: Error) => void }>());
  const commands = useRef(
    new Map<number, { resolve: (done: { copied?: string }) => void; reject: (error: Error) => void }>(),
  );
  const [standing, setStanding] = useState<EditorStanding>(NO_STANDING);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [shown, setShown] = useState<{ shown: DiffShown | null; count: number }>({ shown: null, count: 0 });
  const hooksRef = useRef(hooks);
  hooksRef.current = hooks;
  const keysRef = useRef(keys);
  keysRef.current = keys;

  const send = (message: ToViewer): void => frame.current?.contentWindow?.postMessage(message, location.origin);
  const post = useCallback((message: ToViewer) => {
    if (readyRef.current) send(message);
    else outbox.current = REPLACING.has(message.type) ? [message] : [...outbox.current, message];
  }, []);
  const request = useCallback(
    (make: (id: number) => Request) => {
      const id = ++nextId.current;
      latest.current = id;
      post(make(id));
    },
    [post],
  );
  const read = useCallback(
    (side: 'old' | 'new') =>
      new Promise<string>((resolve, reject) => {
        if (!readyRef.current) return reject(new Error('The editor is still loading.'));
        const id = ++nextId.current;
        reads.current.set(id, { resolve, reject });
        send({ type: 'viewer/read', id, side });
      }),
    [],
  );

  const command = useCallback(
    (side: Side, name: ViewerCommand, text?: string) =>
      new Promise<{ copied?: string }>((resolve, reject) => {
        if (!readyRef.current) return reject(new Error('The editor is still loading.'));
        // The keyboard goes where a key would have been pressed: into the frame (its document takes keys only while
        // its window is focused), and there into the side's editor (the editor page focuses it).
        frame.current?.focus();
        frame.current?.contentWindow?.focus();
        const id = ++nextId.current;
        commands.current.set(id, { resolve, reject });
        send({ type: 'viewer/command', id, side, command: name, ...(text !== undefined && { text }) });
      }),
    [],
  );

  const keyList = JSON.stringify(keys);
  useEffect(() => {
    if (readyRef.current) send({ type: 'viewer/keys', keys: keysRef.current });
  }, [keyList]);

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow) return;
      const data: unknown = event.data;
      if (!isFromViewer(data)) return;
      switch (data.type) {
        case 'viewer/ready':
          readyRef.current = true;
          setReady(true);
          for (const message of [{ type: 'viewer/keys', keys: keysRef.current } as ToViewer, ...outbox.current])
            send(message);
          outbox.current = [];
          return;
        case 'viewer/shown':
          if (data.id === undefined ? data.shown.cause !== 'edit' : data.id !== latest.current) return;
          setShown(s => ({ shown: data.shown, count: s.count + 1 }));
          hooksRef.current.onShown?.(data.shown);
          return;
        case 'viewer/text':
          reads.current.get(data.id)?.resolve(data.text);
          reads.current.delete(data.id);
          return;
        case 'viewer/standing':
          setStanding(data.standing);
          return;
        case 'viewer/done':
          commands.current.get(data.id)?.resolve(data.copied !== undefined ? { copied: data.copied } : {});
          commands.current.delete(data.id);
          return;
        case 'viewer/error': {
          const pending =
            data.id !== undefined ? (reads.current.get(data.id) ?? commands.current.get(data.id)) : undefined;
          if (pending) {
            pending.reject(new Error(data.message));
            reads.current.delete(data.id!);
            commands.current.delete(data.id!);
          } else if (data.id === undefined && !readyRef.current) setFailed(data.message);
          else if (data.id === undefined || data.id === latest.current) hooksRef.current.onError?.(data.message);
          return;
        }
        case 'viewer/key':
          hooksRef.current.onKey?.(data.chord);
          return;
        default:
        // Drops and drags belong to «Compare code»; a grammar's note is the editor's own.
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return { frame, ready, failed, shown: shown.shown, shownCount: shown.count, request, post, read, standing, command };
};
