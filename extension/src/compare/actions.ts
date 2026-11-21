/**
 * Seam `CompareAction` — the toolbar of «Compare code» as a list of definitions, the way the start page's parts and
 * the toolbar menu's items are (start/parts/index.ts, popup/items.ts). The page renders this list and names no action:
 * the side bars take the `side` actions in this order, the common bar the `common` ones; a `shortcut` is handled on the
 * page and in the editor (where ⌘S would otherwise be the browser's "Save page") and shown in the action's tooltip.
 *
 * Which action stands where follows the established diff tools (docs/research/compare-page-conventions.md): what acts
 * on one text sits above that text (Meld and Beyond Compare put the file and its Save above each pane; Save acts on
 * the focused side), what concerns both is common (swap sides is one command in IntelliJ, VS Code, Meld and Beyond
 * Compare; the language is one choice here because both texts are versions of one file).
 *
 * Adding an action: one entry here — `run` gets the page's operations (`page`) and the browser seams (`behaviors`).
 * An action that needs a new operation of the page is a change of `ComparePort`, not of the page's rendering.
 */
import { lineCount } from './files';
import { extensionOf } from './languages';
import { suggestedName } from './state';
import {
  ArrowLeftRightIcon,
  ClipboardPasteIcon,
  CopyIcon,
  EraserIcon,
  FolderOpenIcon,
  PencilIcon,
  SaveAllIcon,
  SaveIcon,
} from 'lucide-react';
import type { Clipboard } from './clipboard';
import type { ExampleSource } from './examples';
import type { SideText } from './files';
import type { SideSaver } from './sideSaver';
import type { Arrival, CompareState, Side, Tone } from './state';
import type { TextSource } from './textSource';
import type { KeyChord } from '@src/shared/viewerProtocol';
import type { LucideIcon } from 'lucide-react';

/** What an action may do to the page. */
export interface ComparePort {
  /** Texts arriving (one or two, placed by the page's rules: state.ts `place`). */
  load(texts: readonly SideText[], side: Side | null, origin: Arrival['origin']): Promise<void>;
  /** A side's text as the editor holds it now (edits included). */
  read(side: Side): Promise<string>;
  setEditable(side: Side, editable: boolean): void;
  clear(side: Side): Promise<void>;
  swap(): void;
  /** The text was saved for the side, under this name and (with File System Access) this handle. */
  saved(side: Side, text: string, fileName: string, handle: FileSystemFileHandle | null): void;
  say(text: string, tone?: Tone): void;
}

/** The browser seams an action uses (behaviors.ts chooses them). */
export interface ActionBehaviors {
  texts: TextSource;
  clipboard: Clipboard;
  saver: SideSaver;
  examples: ExampleSource;
}

export interface ActionContext {
  /** The side of a side action; null for a common one. */
  side: Side | null;
  state: CompareState;
  page: ComparePort;
  behaviors: ActionBehaviors;
}

export interface CompareAction {
  /** Stable: tests, the e2e check and `data-action`. */
  id: string;
  /** The button's accessible name and tooltip. */
  title: string;
  /** Above each side, or once for both. */
  scope: 'side' | 'common';
  icon: LucideIcon;
  shortcut?: KeyChord;
  /** A switch (aria-pressed) and whether it is on. */
  pressed?(state: CompareState, side: Side | null): boolean;
  enabled(state: CompareState, side: Side | null): boolean;
  run(context: ActionContext): Promise<void>;
}

const SIDE_WORD: Record<Side, string> = { old: 'original', new: 'changed' };
const lines = (n: number): string => `${n} ${n === 1 ? 'line' : 'lines'}`;
const ready = (state: CompareState): boolean => state.viewer === 'ready';

const save =
  (as: boolean) =>
  async ({ side, state, page, behaviors }: ActionContext): Promise<void> => {
    if (!side) return;
    const meta = state.sides[side];
    const text = await page.read(side);
    const request = {
      text,
      bom: meta.bom,
      suggestedName: suggestedName(meta, side, extensionOf(state.language)),
      handle: meta.handle,
    };
    const result = await (as ? behaviors.saver.saveAs(request) : behaviors.saver.save(request));
    if (result.status === 'saved') {
      page.saved(side, text, result.fileName, result.handle);
      page.say(
        result.how === 'download'
          ? `Downloaded the ${SIDE_WORD[side]} side as ${result.fileName}.`
          : `Saved ${result.fileName}.`,
        'success',
      );
    } else if (result.status === 'cancelled') page.say('Not saved.');
    else page.say(result.message, 'error');
  };

export const compareActions: readonly CompareAction[] = [
  {
    id: 'open',
    title: 'Open file…',
    scope: 'side',
    icon: FolderOpenIcon,
    enabled: () => true,
    async run({ side, page, behaviors }) {
      const incoming = await behaviors.texts.pick();
      if (!incoming) return;
      if (incoming.problems.length) page.say(incoming.problems.join('. ') + '.', 'error');
      else await page.load(incoming.texts, side, 'file');
    },
  },
  {
    id: 'paste',
    title: 'Paste from the clipboard',
    scope: 'side',
    icon: ClipboardPasteIcon,
    enabled: () => true,
    async run({ side, page, behaviors }) {
      const read = await behaviors.clipboard.read();
      if ('refused' in read) page.say(read.refused, 'error');
      else if (!read.text) page.say('The clipboard has no text.', 'error');
      else await page.load([{ text: read.text, fileName: null, handle: null, bom: false }], side, 'clipboard');
    },
  },
  {
    id: 'copy',
    title: 'Copy the text',
    scope: 'side',
    icon: CopyIcon,
    enabled: ready,
    async run({ side, page, behaviors }) {
      if (!side) return;
      const text = await page.read(side);
      await behaviors.clipboard.write(text);
      page.say(`Copied ${lines(lineCount(text))} of the ${SIDE_WORD[side]} side.`, 'success');
    },
  },
  {
    id: 'save',
    title: 'Save',
    scope: 'side',
    icon: SaveIcon,
    shortcut: { key: 's', mod: true, shift: false },
    enabled: ready,
    run: save(false),
  },
  {
    id: 'saveAs',
    title: 'Save as…',
    scope: 'side',
    icon: SaveAllIcon,
    shortcut: { key: 's', mod: true, shift: true },
    enabled: ready,
    run: save(true),
  },
  {
    id: 'edit',
    title: 'Edit',
    scope: 'side',
    icon: PencilIcon,
    pressed: (state, side) => !!side && state.sides[side].editable,
    enabled: ready,
    async run({ side, state, page }) {
      if (side) page.setEditable(side, !state.sides[side].editable);
    },
  },
  {
    id: 'clear',
    title: 'Clear',
    scope: 'side',
    icon: EraserIcon,
    enabled: (state, side) =>
      !!side && ready(state) && !(state.sides[side].empty && state.sides[side].origin === 'empty'),
    async run({ side, page }) {
      if (side) await page.clear(side);
    },
  },
  {
    id: 'swap',
    title: 'Swap sides',
    scope: 'common',
    icon: ArrowLeftRightIcon,
    enabled: state => ready(state) && !(state.sides.old.empty && state.sides.new.empty),
    async run({ page }) {
      page.swap();
    },
  },
];

export const sideWord = (side: Side): string => SIDE_WORD[side];
