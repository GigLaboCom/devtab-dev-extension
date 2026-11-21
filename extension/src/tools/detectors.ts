/**
 * The tools' `detect`, together (D16): every tool package's `./detect` module (`src/detect.ts`), found by its location
 * like the definitions (registry.ts). Pasted text is offered to them in the tools' order (the caller's: the catalogue's)
 * and the first that recognises it opens with it. A chunk of its own: no page imports this module statically, so none
 * loads a tool's `detect` (or what it pulls in) before pasted text needs it — the start page on its first paste or when
 * it is idle after its first paint, the shell's palette when it opens (recogniser.ts).
 *
 * Relative imports only, and not the catalogue: the start page's parts reach this module (parts/recognisePaste.run.ts),
 * and their modules are read outside the app (part.ts).
 */
import type { ToolDetect } from '@workspace/tools-host';

const modules = import.meta.glob<ToolDetect>('../../../packages/tools/ui/*/src/detect.ts', {
  eager: true,
  import: 'detect',
});

/** `packages/tools/ui/<id>/src/detect.ts` → `<id>`. */
const idOf = (path: string): string | undefined => /\/packages\/tools\/ui\/([^/]+)\/src\/detect\.ts$/.exec(path)?.[1];

/** The detectors found, in the order of `order` (the catalogue's): id and `detect`. */
export const detectorsOf = (
  found: Record<string, ToolDetect | undefined>,
  order: readonly string[],
): ReadonlyArray<{ id: string; detect: ToolDetect }> =>
  Object.entries(found)
    .map(([path, detect]) => ({ id: idOf(path), detect }))
    .filter((d): d is { id: string; detect: ToolDetect } => !!d.id && typeof d.detect === 'function')
    .filter(d => order.includes(d.id))
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));

/** The tools that have a `detect`, by id. */
export const DETECTING = Object.keys(modules)
  .map(idOf)
  .filter((id): id is string => id !== undefined);

/**
 * Recognising over the tools in `order` (tool ids): the id of the first tool whose `detect` recognises the text;
 * undefined when none does or the text is blank.
 */
export const recogniseIn = (order: readonly string[]): ((text: string) => string | undefined) => {
  const detectors = detectorsOf(modules, order);
  return text => (text.trim() ? detectors.find(d => d.detect(text))?.id : undefined);
};
