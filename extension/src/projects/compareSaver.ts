/**
 * «Compare code» saving a side that is a project's file (the companion's specification §7.6, partial restore: a version
 * opened next to the current file, pieces carried over by hand, Save). The side came with its origin — the project,
 * the path, the version it is (`baseHash`) and which backend had it (../compare/handoff.ts); Save is `projectSaver`'s
 * (./projectSaver.ts): `file.save` from that version, so a file changed on disk meanwhile is not overwritten.
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
import type { ProjectFileOrigin } from '../compare/handoff';
import type { SaveResult, SideSaver } from '../compare/sideSaver';
import type { ProjectBackendFactory } from './backend';

export const compareProjectSaver = (
  origin: ProjectFileOrigin,
  backends: ProjectBackendFactory = projectsBehaviors().backend,
): SideSaver => {
  let base = origin.baseHash;
  return {
    name: 'project',
    async save(request): Promise<SaveResult> {
      const backend = backends();
      try {
        await backend.connect();
        if (backend.name !== origin.backend) return { status: 'failed', message: TEXT.history.compareNotConnected };
        const saver = projectSaver(backend, origin.project, origin.path, base);
        const result = await saver.save(request);
        if (result.status === 'saved') base = saver.baseHash;
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
