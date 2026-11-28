/**
 * «Compare code» saving a side that is a companion's file (the companion's specification §7.6, partial restore: a
 * version opened next to the current file, pieces carried over by hand, Save). The side came with its origin
 * (../compare/handoff.ts) — which file, the version it is (`baseHash`) and which backend had it:
 *
 * - a project's file: Save is `projectSaver`'s (./projectSaver.ts) — `file.save` from that version;
 * - a file opened from the computer (D42): Save is the root's saver of such files (`openFiles.saver`,
 *   ./openFiles/saver.ts) over the root's seam (`openFiles.files`) — `openFile.save` from that version.
 *
 * Either way a file changed on disk meanwhile is not overwritten.
 *
 * Who holds the port: «Compare code» is another section, and the Projects section let its port go when the person left
 * it (§8.2). So each Save opens a connection of its own through the Projects section's composition root (the same
 * choice — the companion when it is connected, else the demo), writes, and lets it go: no port stays open while
 * «Compare code» only shows the texts. A side whose backend is not the one that answers now (the companion stopped, or
 * the demo's project with the companion connected) is not written. Loaded by «Compare code»'s root on the first such
 * Save, so its chunk carries none of this.
 *
 * Refusals are said in the Projects section's words (src/app/projects/errors.ts), not as the companion's codes.
 */
import { projectsBehaviors } from './behaviors';
import { errorOf, projectSaver } from './projectSaver';
import { errorLine } from '../app/projects/errors';
import { TEXT } from '../app/projects/text';
import { isOpenedFileOrigin } from '../compare/handoff';
import type { CompanionFileOrigin } from '../compare/handoff';
import type { SaveRequest, SaveResult, SideSaver } from '../compare/sideSaver';
import type { ProjectBackend, ProjectBackendFactory } from './backend';
import type { OpenFilesBehaviors } from './behaviors';

/** One Save of the side over a connected backend: the result, and the version the next Save starts from. */
type SaveOnce = (backend: ProjectBackend, request: SaveRequest, base: string) => Promise<[SaveResult, string]>;

export const compareProjectSaver = (
  origin: CompanionFileOrigin,
  backends?: ProjectBackendFactory,
  openFiles?: OpenFilesBehaviors,
): SideSaver => {
  // The root is asked only for what the caller did not give.
  const root = !backends || (isOpenedFileOrigin(origin) && !openFiles) ? projectsBehaviors() : null;
  const backendOf = backends ?? root!.backend;
  const opened = openFiles ?? root?.openFiles;
  let base = origin.baseHash;

  const once: SaveOnce = isOpenedFileOrigin(origin)
    ? async (backend, request, from) => {
        if (!opened) return [{ status: 'failed', message: TEXT.history.compareFailed(TEXT.notOffered) }, from];
        const saver = opened.saver(opened.files(backend), origin.file, origin.name, from);
        return [await saver.save(request), saver.baseHash];
      }
    : async (backend, request, from) => {
        const saver = projectSaver(backend, origin.project, origin.path, from);
        return [await saver.save(request), saver.baseHash];
      };

  return {
    name: 'project',
    async save(request): Promise<SaveResult> {
      const backend = backendOf();
      try {
        await backend.connect();
        if (backend.name !== origin.backend) return { status: 'failed', message: TEXT.history.compareNotConnected };
        const [result, wrote] = await once(backend, request, base);
        if (result.status === 'saved') base = wrote;
        if (result.status !== 'failed') return result;
        const error = errorOf(result);
        return {
          ...result,
          message:
            result.code === 'conflict'
              ? TEXT.history.compareConflict
              : TEXT.history.compareFailed(error ? errorLine(error, 'save') : result.message),
        };
      } catch (error) {
        return { status: 'failed', message: TEXT.history.compareFailed(errorLine(error, 'save')) };
      } finally {
        backend.dispose();
      }
    },
    // Save as of such a side goes where the person chooses, as any side's (../compare/actions.ts): never here.
    saveAs: () => Promise.resolve({ status: 'cancelled' }),
  };
};
