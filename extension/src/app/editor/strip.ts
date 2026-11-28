/**
 * The strip of the editor's buttons as data (./EditorStrip.tsx draws it): which controls stand on it and in what
 * order, where a thin line or the gap before the toggles goes, what each control is now — its label, whether it does
 * anything and why not, the key it is bound to, a toggle's state — and how many fit a width. One answer for a button
 * and for its line in the "more" menu, so the two cannot disagree. Pure, but for `runStripCommand`, which takes the
 * host's roads (the editor's frame, the `Clipboard` seam) as arguments.
 *
 * The set and the order: the host's Save first, apart (only where the host has something to save), then the editor's
 * operations — Undo, Redo · Cut, Copy, Copy all, Paste · Select all · Indent, Outdent · Find — and at the far end two
 * ways of looking at the text, Wrap long lines and Show whitespace. A button is the same action as its key: the editor's
 * commands run in the module through gpui-kit's own actions (`viewer/command`); Copy all reads the side's text, as the
 * page always reads it (`viewer/read`); Paste reads the clipboard through the seam — the editor's own Paste would ask
 * for a permission — and hands the text to the editor. The tooltip names the key the module binds (the module's one
 * table, `editorKeyOf`), or the host's for Save.
 *
 * What is available: nothing before the editor has drawn; the commands that change the text only on an editable side
 * (Undo, Redo, Cut, Paste, Indent, Outdent — greyed without a word on a read-only one); Cut and Copy while something is
 * selected, as gpui-kit's own menu greys them; Copy all while the text is not empty, its tooltip saying so. Undo and
 * Redo stay available on an editable side: the editor keeps its history to itself, and a button that guessed would grey
 * the one press that would have worked — pressed with nothing to undo, it does what the key does: nothing. Wrap long
 * lines is greyed side by side, with the reason (only one file alone wraps).
 */
import { EDITOR_TEXT } from './text';
import { editorKeyOf } from '@extension/review-wasm';
import type { CommandStanding, EditorCommand, Side, ViewMode } from '@extension/review-wasm';
import type { Clipboard } from '@src/compare/clipboard';
import type { ViewChoice } from '@src/editorSettings/resolve';
import type { KeyChord } from '@src/shared/keys';

/** A command of the strip: the editor's own, Paste (the text comes from the page) and Copy all. */
export type StripCommand = EditorCommand | 'paste' | 'copyAll';

/** A way of looking at the text: a toggle. */
export type StripView = 'softWrap' | 'whitespace';

export type StripControl =
  { kind: 'save' } | { kind: 'command'; command: StripCommand } | { kind: 'view'; view: StripView };

/** Where a control stands: a line goes between two stretches; the toggles are pushed to the far end. */
export type Stretch = 'host' | 'history' | 'clipboard' | 'selection' | 'indent' | 'search' | 'look';

/** The host's Save, offered to the strip in its own words. */
export interface SaveOffer {
  label: string;
  /** The key the host binds to it (its save shortcut); null: none. */
  key: KeyChord | null;
  /** Why it does nothing now (the host's words), or null when it saves. */
  unavailable: string | null;
}

/** What the strip is told about its editor. */
export interface StripState {
  /** The editor has drawn and takes commands. */
  ready: boolean;
  standing: CommandStanding;
  /** The file alone, or both sides compared (nothing wraps then). */
  layout: ViewMode;
  /** What applies now: the saved setting, or the choice for this editor over it. */
  view: Readonly<Record<StripView, boolean>>;
  save: SaveOffer | null;
  mac: boolean;
}

/** What a control is now — read by its button and by its line in the more menu alike. */
export interface ControlStanding {
  /** Stable: `data-control`, the tests and the e2e. */
  id: string;
  label: string;
  enabled: boolean;
  /** Why it does nothing, said instead of its key; null where the greying speaks for itself. */
  why: string | null;
  /** A toggle's state; null for an operation. */
  on: boolean | null;
  key: KeyChord | null;
}

const COMMANDS: readonly StripCommand[] = [
  'undo',
  'redo',
  'cut',
  'copy',
  'copyAll',
  'paste',
  'selectAll',
  'indent',
  'outdent',
  'find',
];
const VIEWS: readonly StripView[] = ['softWrap', 'whitespace'];

const STRETCH: Record<StripCommand, Stretch> = {
  undo: 'history',
  redo: 'history',
  cut: 'clipboard',
  copy: 'clipboard',
  copyAll: 'clipboard',
  paste: 'clipboard',
  selectAll: 'selection',
  indent: 'indent',
  outdent: 'indent',
  find: 'search',
};

const LABEL: Record<StripCommand | StripView, string> = {
  undo: EDITOR_TEXT.stripUndo,
  redo: EDITOR_TEXT.stripRedo,
  cut: EDITOR_TEXT.stripCut,
  copy: EDITOR_TEXT.stripCopy,
  copyAll: EDITOR_TEXT.stripCopyAll,
  paste: EDITOR_TEXT.stripPaste,
  selectAll: EDITOR_TEXT.stripSelectAll,
  indent: EDITOR_TEXT.stripIndent,
  outdent: EDITOR_TEXT.stripOutdent,
  find: EDITOR_TEXT.stripFind,
  softWrap: EDITOR_TEXT.stripWrap,
  whitespace: EDITOR_TEXT.stripWhitespace,
};

/** A toggle pressed, as the choice over the saved settings it makes (../../editorSettings/resolve.ts `ViewChoice`). */
export const viewChoice = (view: StripView, on: boolean): ViewChoice =>
  view === 'softWrap' ? { softWrap: on } : { whitespace: on };

/** Every control on the strip, in its order: Save when the host offers it, the operations, the two toggles. */
export const stripControls = (save: boolean): StripControl[] => [
  ...(save ? [{ kind: 'save' as const }] : []),
  ...COMMANDS.map(command => ({ kind: 'command' as const, command })),
  ...VIEWS.map(view => ({ kind: 'view' as const, view })),
];

export const stretchOf = (control: StripControl): Stretch =>
  control.kind === 'save' ? 'host' : control.kind === 'view' ? 'look' : STRETCH[control.command];

export const controlId = (control: StripControl): string =>
  control.kind === 'save' ? 'save' : control.kind === 'view' ? control.view : control.command;

/** What goes before the control at `index`: a line between two stretches, the gap before the toggles, or nothing. */
export const gapBefore = (controls: readonly StripControl[], index: number): 'line' | 'spacer' | null => {
  if (index === 0) return null;
  const stretch = stretchOf(controls[index]!);
  if (stretch === stretchOf(controls[index - 1]!)) return null;
  return stretch === 'look' ? 'spacer' : 'line';
};

/** The key the module binds to the command on this platform; Copy all has none. */
const keyOf = (command: StripCommand, mac: boolean): KeyChord | null =>
  command === 'copyAll' ? null : editorKeyOf(command, mac);

const enabledCommand = (command: StripCommand, { editable, empty, selection }: CommandStanding): boolean => {
  switch (command) {
    case 'undo':
    case 'redo':
    case 'paste':
    case 'indent':
    case 'outdent':
      return editable;
    case 'cut':
      return editable && selection;
    case 'copy':
      return selection;
    case 'copyAll':
      return !empty;
    case 'selectAll':
    case 'find':
      return true;
  }
};

/** What `control` is now. */
export const standingOf = (control: StripControl, state: StripState): ControlStanding => {
  const id = controlId(control);
  if (control.kind === 'save') {
    const offer = state.save;
    return {
      id,
      label: offer?.label ?? '',
      enabled: !!offer && offer.unavailable === null,
      why: offer?.unavailable ?? null,
      on: null,
      key: offer?.key ?? null,
    };
  }
  if (control.kind === 'view') {
    const blocked = control.view === 'softWrap' && state.layout === 'diff';
    return {
      id,
      label: LABEL[control.view],
      enabled: state.ready && !blocked,
      why: blocked ? EDITOR_TEXT.stripWrapSideBySide : null,
      on: state.view[control.view],
      key: null,
    };
  }
  const { command } = control;
  const enabled = state.ready && enabledCommand(command, state.standing);
  const empty = command === 'copyAll' && state.ready && state.standing.empty;
  return {
    id,
    label: LABEL[command],
    enabled,
    why: empty ? EDITOR_TEXT.stripCopyAllEmpty : null,
    on: null,
    key: keyOf(command, state.mac),
  };
};

/**
 * How many controls fit, from the start: `widths` are the controls' own and `gaps[i]` what stands before control `i`
 * (a line, or the toggles' gap; 0 for none); `more` is the more button's width, taken only when something is left off.
 * A gap is not left at the end of the run.
 */
export const fitCount = (
  widths: readonly number[],
  gaps: readonly number[],
  available: number,
  more: number,
): number => {
  const total = widths.reduce((sum, width, i) => sum + width + (gaps[i] ?? 0), 0);
  if (total <= available) return widths.length;
  let used = 0;
  let kept = 0;
  for (let i = 0; i < widths.length; i++) {
    const next = used + (gaps[i] ?? 0) + widths[i]!;
    if (next + more > available) break;
    used = next;
    kept = i + 1;
  }
  return kept;
};

/** The roads a strip's command takes to its editor: the host's frame. */
export interface StripPort {
  /** Runs an editor command (or Paste with its text) on a side; what Copy or Cut took comes back as `copied`. */
  command(side: Side, command: EditorCommand | 'paste', text?: string): Promise<{ copied?: string }>;
  /** The side's text as the editor holds it now. */
  read(side: Side): Promise<string>;
}

/**
 * Runs one of the strip's commands: Copy and Cut run in the editor and what they took goes on the clipboard from the
 * page (the click's activation is the page's); Copy all reads the text and writes it; Paste reads the clipboard
 * through the seam — refused by Chrome, the seam's own sentence is said, quietly — and hands the text to the editor.
 */
export const runStripCommand = async (
  command: StripCommand,
  side: Side,
  port: StripPort,
  clipboard: Clipboard,
  say: (text: string, tone: 'info' | 'error') => void,
): Promise<void> => {
  const write = async (text: string | undefined): Promise<void> => {
    if (!text) return;
    try {
      await clipboard.write(text);
    } catch (error) {
      say(EDITOR_TEXT.stripNotCopied(error instanceof Error ? error.message : String(error)), 'error');
    }
  };
  if (command === 'copyAll') return write(await port.read(side));
  if (command === 'paste') {
    const read = await clipboard.read();
    if ('refused' in read) return say(read.refused, 'info');
    if (!read.text) return;
    await port.command(side, 'paste', read.text);
    return;
  }
  const { copied } = await port.command(side, command);
  if (command === 'copy' || command === 'cut') await write(copied);
};
