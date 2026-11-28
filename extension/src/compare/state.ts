/**
 * The state of «Compare code» as the page keeps it — everything about the two sides but their texts, which live in the
 * editor (the wasm module) once they are in it. Plain data and pure transitions, so the rules are tested without a
 * browser (state.test.ts):
 *
 * - **The example is a pair.** With nothing loaded both sides show the example of the selected language, marked as
 *   such; while both still show it unedited, choosing another language switches the example. The first real text on
 *   either side (a file, the clipboard, a drop, Clear) replaces the example on that side and empties the other.
 * - **Where texts go.** Two texts at once: the first is the original (left), the second the changed text (right).
 *   One: the side it was dropped or opened on; with no side (dropped beside both) it goes nowhere and the page says
 *   where to drop it.
 * - **Read-only by default.** A side the user switches to edit mode stays editable until switched back; new text
 *   from outside makes it read-only again. Whether a side is modified comes from the editor.
 */
import type { SideText } from './files';
import type { ProjectFileOrigin } from './handoff';
import type { DiffShown, Side } from '@extension/review-wasm';

export type { Side } from '@extension/review-wasm';
export const SIDES: readonly Side[] = ['old', 'new'];
export const other = (side: Side): Side => (side === 'old' ? 'new' : 'old');

/** What a side's text is: shown in its bar when it has no file name. `handed`: another part of the page handed it over
 *  (a tool sending the person here with texts pasted into it). */
export type Origin = 'example' | 'file' | 'clipboard' | 'dropped' | 'handed' | 'empty';

export interface SideMeta {
  origin: Origin;
  /** The file's name: opened, dropped, saved as, or the example's. */
  fileName: string | null;
  /** Where Save writes back without asking for a place (File System Access), if the browser gave one. */
  handle: FileSystemFileHandle | null;
  bom: boolean;
  editable: boolean;
  /** Edited since it was loaded or saved (the editor says). */
  modified: boolean;
  empty: boolean;
  /** The project's file the side is (handed over by the Projects section): Save writes it back there. */
  project: ProjectFileOrigin | null;
}

export interface Counts {
  changes: number;
  added: number;
  removed: number;
}

export type Tone = 'info' | 'success' | 'error';
export interface Notice {
  tone: Tone;
  text: string;
}

export interface CompareState {
  sides: Record<Side, SideMeta>;
  language: string;
  /** The language whose example both sides show, unedited; null once either side has something else. */
  example: string | null;
  counts: Counts | null;
  viewer: 'loading' | 'ready' | 'error';
  notice: Notice | null;
}

const emptySide: SideMeta = {
  origin: 'empty',
  fileName: null,
  handle: null,
  bom: false,
  editable: false,
  modified: false,
  empty: true,
  project: null,
};

export const initialState = (language: string): CompareState => ({
  sides: { old: emptySide, new: emptySide },
  language,
  example: null,
  counts: null,
  viewer: 'loading',
  notice: null,
});

/** A text arriving on a side, with what it is. */
export interface Arrival {
  side: Side;
  text: SideText;
  origin: Exclude<Origin, 'example' | 'empty'>;
}

/** Where the texts of one drop, pick or paste go — or why they go nowhere. */
export const place = (
  texts: readonly SideText[],
  side: Side | null,
  origin: Arrival['origin'],
): { arrivals: Arrival[] } | { problem: string } => {
  if (texts.length === 2)
    return {
      arrivals: [
        { side: 'old', text: texts[0]!, origin },
        { side: 'new', text: texts[1]!, origin },
      ],
    };
  if (texts.length !== 1) return { problem: 'Nothing to put on a side.' };
  if (!side)
    return {
      problem:
        'One file goes on the side it is dropped on: drop it on the left (original) or the right (changed) side, ' +
        'or drop two files at once.',
    };
  return { arrivals: [{ side, text: texts[0]!, origin }] };
};

export type CompareEvent =
  | { type: 'example'; language: string; names: Record<Side, string>; empty: Record<Side, boolean> }
  | { type: 'arrived'; arrivals: Arrival[]; language: string }
  | { type: 'cleared'; side: Side }
  | { type: 'swapped' }
  | { type: 'editable'; side: Side; editable: boolean }
  | { type: 'shown'; shown: DiffShown }
  | {
      type: 'saved';
      side: Side;
      fileName: string | null;
      handle: FileSystemFileHandle | null;
      /** Saved somewhere else than its project's file (Save as): the side is that file now, no longer the project's. */
      leftProject?: boolean;
    }
  | { type: 'language'; language: string }
  | { type: 'viewer'; viewer: CompareState['viewer'] }
  | { type: 'notice'; notice: Notice | null };

/** The other side loses the example once one side gets something else. */
const dropExample = (sides: Record<Side, SideMeta>, side: Side): Record<Side, SideMeta> => {
  const theOther = other(side);
  return sides[theOther].origin === 'example' ? { ...sides, [theOther]: emptySide } : sides;
};

export const reduce = (state: CompareState, event: CompareEvent): CompareState => {
  switch (event.type) {
    case 'example':
      return {
        ...state,
        language: event.language,
        example: event.language,
        sides: {
          old: { ...emptySide, origin: 'example', fileName: event.names.old, empty: event.empty.old },
          new: { ...emptySide, origin: 'example', fileName: event.names.new, empty: event.empty.new },
        },
      };
    case 'arrived': {
      let sides = state.sides;
      for (const { side, text, origin } of event.arrivals) {
        sides = dropExample(sides, side);
        sides = {
          ...sides,
          [side]: {
            origin,
            fileName: text.fileName,
            handle: text.handle,
            bom: text.bom,
            editable: false,
            modified: false,
            empty: text.text.length === 0,
            project: text.project ?? null,
          },
        };
      }
      return { ...state, sides, example: null, language: event.language };
    }
    case 'cleared':
      return { ...state, example: null, sides: { ...dropExample(state.sides, event.side), [event.side]: emptySide } };
    case 'swapped':
      return { ...state, sides: { old: state.sides.new, new: state.sides.old } };
    case 'editable':
      return {
        ...state,
        sides: { ...state.sides, [event.side]: { ...state.sides[event.side], editable: event.editable } },
      };
    case 'shown': {
      const { shown } = event;
      const sides = { ...state.sides };
      for (const side of SIDES) {
        const reported = shown.sides[side];
        sides[side] = { ...sides[side], modified: reported.modified, empty: reported.empty };
      }
      const edited = SIDES.some(side => sides[side].modified);
      return {
        ...state,
        sides,
        // An edited example is the user's text now: another language no longer switches it.
        example: edited ? null : state.example,
        counts: { changes: shown.changes, added: shown.added, removed: shown.removed },
      };
    }
    case 'saved': {
      const meta = state.sides[event.side];
      return {
        ...state,
        sides: {
          ...state.sides,
          [event.side]: {
            ...meta,
            origin: event.fileName ? 'file' : meta.origin,
            fileName: event.fileName ?? meta.fileName,
            handle: event.handle ?? meta.handle,
            project: event.leftProject ? null : meta.project,
          },
        },
      };
    }
    case 'language':
      return { ...state, language: event.language };
    case 'viewer':
      return { ...state, viewer: event.viewer };
    case 'notice':
      return { ...state, notice: event.notice };
  }
};

/** What a side's bar names: its file, or what its text is. */
export const sideName = (meta: SideMeta): string => {
  if (meta.fileName) return meta.fileName;
  switch (meta.origin) {
    case 'clipboard':
      return 'Pasted text';
    case 'handed':
      return meta.empty && !meta.modified ? 'Empty' : 'Pasted text';
    case 'dropped':
      return 'Dropped text';
    case 'example':
      return 'Example';
    default:
      return meta.modified || !meta.empty ? 'Typed text' : 'Empty';
  }
};

/** Both sides empty and nobody typing: the page offers the example instead of two blank editors. */
export const isEmptyComparison = (state: CompareState): boolean =>
  SIDES.every(side => state.sides[side].empty && !state.sides[side].editable);

/** The language the page shows after texts arrive: the last file's when its name tells it; plain text when the example
 *  goes away and nothing tells; otherwise the selection stays. */
export const languageAfter = (
  state: CompareState,
  arrivals: readonly Arrival[],
  detect: (fileName: string) => string | undefined,
): string => {
  for (const arrival of [...arrivals].reverse()) {
    const detected = arrival.text.fileName ? detect(arrival.text.fileName) : undefined;
    if (detected) return detected;
  }
  return state.example !== null ? 'text' : state.language;
};

/** The file name Save suggests for a side: its own, or `original.<ext>` / `changed.<ext>`. */
export const suggestedName = (meta: SideMeta, side: Side, extension: string): string =>
  meta.fileName ?? `${side === 'old' ? 'original' : 'changed'}.${extension}`;
