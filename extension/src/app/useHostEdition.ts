/**
 * What the edition in force says to the pages, followed while the page is open: whether the history is part of it and
 * whether automatic copying exists, whether the Projects section has scratch files, what stands behind the editor's
 * profiles and a project's editor settings, and what the section does with a file opened from the system (HistoryHost
 * `included`, `automaticCopying`, `scratches`, `editorProfiles`, `projectEditorSettings`, `openFiles`), and — where
 * the build follows a licence — the licence's state. A page reads them here, never once at mount: when the edition or the licence state
 * changes (`onEdition`), every place re-renders with the new values.
 */
import { useCallback, useSyncExternalStore } from 'react';
import type { OpenFilesEdition } from '@src/edition/edition';
import type { SourceState } from '@src/edition/source';
import type { EditorProfilesStore } from '@src/editorSettings/profilesStore';
import type { ProjectEditorSettingsFactory } from '@src/editorSettings/project';
import type { HistoryHost } from '@src/history/behaviors';

/** What the edition in force says, as it is now; re-renders on every change. */
export const useHostEdition = (
  host: HistoryHost,
): {
  readonly included: boolean;
  readonly automaticCopying: boolean;
  readonly scratches: boolean;
  readonly editorProfiles: EditorProfilesStore;
  readonly projectEditorSettings: ProjectEditorSettingsFactory;
  readonly openFiles: OpenFilesEdition;
} => {
  const subscribe = useCallback((listener: () => void) => host.onEdition(listener), [host]);
  const included = useSyncExternalStore(
    subscribe,
    useCallback(() => host.included, [host]),
  );
  const automaticCopying = useSyncExternalStore(
    subscribe,
    useCallback(() => host.automaticCopying, [host]),
  );
  const scratches = useSyncExternalStore(
    subscribe,
    useCallback(() => host.scratches, [host]),
  );
  const editorProfiles = useSyncExternalStore(
    subscribe,
    useCallback(() => host.editorProfiles, [host]),
  );
  const projectEditorSettings = useSyncExternalStore(
    subscribe,
    useCallback(() => host.projectEditorSettings, [host]),
  );
  const openFiles = useSyncExternalStore(
    subscribe,
    useCallback(() => host.openFiles, [host]),
  );
  return { included, automaticCopying, scratches, editorProfiles, projectEditorSettings, openFiles };
};

/**
 * The licence state for Settings → Pro and the History notice; `undefined` without a licence (a build whose source is
 * fixed: `fixedPro`, `fixedFree`). The source keeps one state object until it changes, so it is read as it is.
 */
export const useLicenceState = (host: Pick<HistoryHost, 'licence' | 'onEdition'>): SourceState | undefined => {
  const subscribe = useCallback((listener: () => void) => host.onEdition(listener), [host]);
  return useSyncExternalStore(
    subscribe,
    useCallback(() => host.licence?.state(), [host]),
  );
};
