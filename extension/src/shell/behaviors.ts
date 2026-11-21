/**
 * The composition root of the shell (AGENTS.md, "Replaceable Behavior"): the one place that picks the implementation
 * behind each of its seams. Loaded with the shell's lazy chunk, never with the start page.
 *
 *   PaletteSource   what the palette offers — our places from their definitions (palette.ts)
 *   ShortcutAction  what a keyboard shortcut can be bound to — the palette, the start page, every place
 *                   (src/shortcuts/actions.ts); the start page builds the same list when it loads its listener
 *   PasteRecogniser which tool text pasted into the palette is for — the tools' `detect`, their chunk loaded when the
 *                   palette opens (src/tools/toolRecogniser.ts)
 */
import { placesPalette } from './palette';
import { DESTINATIONS } from '@src/shared/destinations';
import { shortcutActions, suggestedKeys } from '@src/shortcuts/actions';
import { TOOL_CATALOGUE } from '@src/tools/catalogue';
import { toolRecogniser } from '@src/tools/toolRecogniser';
import type { PaletteSource } from './palette';
import type { ShortcutAction } from '@src/shortcuts/actions';
import type { PasteRecogniser } from '@src/tools/recogniser';

export interface ShellBehaviors {
  palette: PaletteSource;
  shortcuts: readonly ShortcutAction[];
  recogniser: PasteRecogniser;
}

export const shellBehaviors = (): ShellBehaviors => ({
  palette: placesPalette(DESTINATIONS),
  shortcuts: shortcutActions(DESTINATIONS, suggestedKeys(TOOL_CATALOGUE)),
  recogniser: toolRecogniser(TOOL_CATALOGUE.map(t => t.id)),
});
