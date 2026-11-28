/**
 * The editor's settings at one editor (D39; research §6.4): what applies to each side's text and how it reaches the
 * editor module. A place with an editor — a project's file, a scratch, «Compare code» — keeps one of these:
 *
 *   - `open(texts)` when a text replaces what is shown: the indentation is detected from each side's text (once, at
 *     opening — never per keystroke) and the values come back for the replacing request (`editor`), so the text opens
 *     with them, not a frame later;
 *   - afterwards every change — the stored set (Settings → Editor, on any page of ours), the language, the person's
 *     choice in the indicator — is resolved again and sent as `viewer/set-editor-settings`, to the side it concerns and
 *     only when it differs from what the side has;
 *   - `choose(side, choice)` is the indicator's choice for one file: it lives while the file is open (`open` with
 *     `keep: false` forgets it); `null` goes back to automatic;
 *   - `chooseView(side, choice)` is the editor strip's Wrap long lines / Show whitespace for one file: over the saved
 *     settings in the same way and for as long (a new text forgets it, the same file in another view keeps it, a swap
 *     carries it); Settings and the profiles never change by it.
 *
 * Which set is active is `profile` of ../../editorSettings/resolve.ts: the profile a project names for itself, else the
 * active one (Pro, ../../editorSettings/profiles.ts), else — and always in the free edition — the Default set; a
 * switch of profile, here or in another tab, reaches every open editor at once. What a project says about the file
 * (its `.editorconfig`, Pro) comes with `open` and later with `setProject`; it is the same for both sides (one path).
 * Without behaviors (a page drawn with no settings, as in older tests) the place sends nothing and the editor keeps its
 * own defaults.
 */
import { defaultEditorSettings } from '@src/editorSettings/model';
import { DEFAULT_PROFILE, emptyEditorProfiles, nameOf, profileFor } from '@src/editorSettings/profiles';
import { effectiveEditorSettings, toModuleSettings } from '@src/editorSettings/resolve';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EditorSettings, Side, SideEditorSettings } from '@extension/review-wasm';
import type { EditorSettingsBehaviors } from '@src/editorSettings/behaviors';
import type { DetectedIndent } from '@src/editorSettings/detect';
import type { EditorSet, EditorSettingsRecord } from '@src/editorSettings/model';
import type { EditorProfilesRecord } from '@src/editorSettings/profiles';
import type { ProjectSettings } from '@src/editorSettings/project';
import type { Effective, FileChoice, ViewChoice } from '@src/editorSettings/resolve';
import type { ToViewer } from '@src/shared/viewerProtocol';

const SIDES: readonly Side[] = ['old', 'new'];

/** The stored Default set, followed while the page is open; the Default set as it starts until it arrives. */
export const useEditorRecord = (behaviors: EditorSettingsBehaviors | undefined): EditorSettingsRecord => {
  const [record, setRecord] = useState(defaultEditorSettings);
  useEffect(() => behaviors?.store.watch(setRecord), [behaviors]);
  return record;
};

/** The profiles as the page knows them: the Default set, the other profiles' record, whether the edition has them. */
export interface EditorProfilesState {
  defaults: EditorSettingsRecord;
  profiles: EditorProfilesRecord;
  /** Whether the edition in force has profiles (false: Default alone, and Settings says they are part of Pro). */
  included: boolean;
  /** Whether profiles exist here at all (false: no edition was given — nothing is said about them). */
  offered: boolean;
}

/** Both records, followed while the page is open. An edition without profiles reads nothing of theirs. */
export const useEditorProfiles = (behaviors: EditorSettingsBehaviors | undefined): EditorProfilesState => {
  const defaults = useEditorRecord(behaviors);
  const store = behaviors?.profiles;
  const [profiles, setProfiles] = useState(emptyEditorProfiles);
  useEffect(() => {
    if (!store) return setProfiles(emptyEditorProfiles());
    return store.watch(setProfiles);
  }, [store]);
  return useMemo(
    () => ({
      defaults,
      profiles: store?.included ? profiles : emptyEditorProfiles(),
      included: !!store?.included,
      offered: !!store,
    }),
    [defaults, profiles, store],
  );
};

/** The profile a place uses (`project`: its project's own, if it names one) — its id, name and values. */
export const profileIn = (
  state: EditorProfilesState,
  project?: string,
): { id: string; name: string; set: EditorSet } => {
  const id = profileFor(state.profiles, project);
  const own = state.profiles.profiles.find(p => p.id === id);
  return { id, name: nameOf(state.profiles, id), set: id === DEFAULT_PROFILE || !own ? state.defaults : own };
};

export interface EditorIndent {
  /** Whether this place has settings at all (behaviors were given). */
  readonly enabled: boolean;
  /** What applies to each side now. */
  readonly effective: Readonly<Record<Side, Effective>>;
  /** The person's choice for each side's file; null: automatic. */
  readonly choice: Readonly<Record<Side, FileChoice | null>>;
  /** How each side's editor shows its text by the person's choice (the strip's toggles); null: as the settings say. */
  readonly view: Readonly<Record<Side, ViewChoice | null>>;
  readonly language: string;
  /** The profile in force here: its id and name. */
  readonly profile: { readonly id: string; readonly name: string };
  /** Both records of the profiles, as the page knows them. */
  readonly profiles: EditorProfilesState;
  /** What the project says about the open file (both sides); null: no project, or nothing asked yet. */
  readonly project: ProjectSettings | null;
  /**
   * New texts replace what is shown: detects each side's indentation; with `keep` the choices stay (the same file in
   * another view); `project` is what the file's project says. Returns what the replacing request carries, or undefined
   * without settings.
   */
  open(
    texts: { old?: string; new: string },
    language: string,
    keep?: boolean,
    project?: ProjectSettings | null,
  ): SideEditorSettings | undefined;
  /** What the project says about the open file changed (its `.editorconfig` was edited, or read for the first time). */
  setProject(project: ProjectSettings | null): void;
  /** One side's text replaced (a file dropped on it): detected again, its choice forgotten. */
  replaceSide(side: Side, text: string): void;
  /** The language of both sides changed: its values apply from now on. */
  setLanguage(language: string): void;
  /** The person's choice for a side's file (`both`: the two sides are one file); null: back to automatic. */
  choose(side: Side | 'both', choice: FileChoice | null): void;
  /** The strip's toggles for a side's file (`both`: the two sides are one file): what they are to be from now on. */
  chooseView(side: Side | 'both', choice: ViewChoice): void;
  /** The sides traded places: their detections and choices go with them. */
  swap(): void;
}

interface Sides {
  language: string;
  detected: Record<Side, DetectedIndent | null>;
  choice: Record<Side, FileChoice | null>;
  view: Record<Side, ViewChoice | null>;
  project: ProjectSettings | null;
}

const resolveSide = (state: Sides, profile: EditorSet, side: Side): Effective =>
  effectiveEditorSettings({
    profile,
    language: state.language,
    detected: state.detected[side],
    project: state.project?.values ?? null,
    file: state.choice[side],
    view: state.view[side],
  });

export const useEditorIndent = (
  behaviors: EditorSettingsBehaviors | undefined,
  post: (message: ToViewer) => void,
  initialLanguage = 'text',
  /** The project of the files shown (its own profile, if it names one); absent: a scratch or «Compare code». */
  projectId?: string,
): EditorIndent => {
  const profiles = useEditorProfiles(behaviors);
  const active = useMemo(() => profileIn(profiles, projectId), [profiles, projectId]);
  const record = active.set;
  const [sides, setSides] = useState<Sides>(() => ({
    language: initialLanguage,
    detected: { old: null, new: null },
    choice: { old: null, new: null },
    view: { old: null, new: null },
    project: null,
  }));
  const sidesRef = useRef(sides);
  const recordRef = useRef(record);
  recordRef.current = record;
  // What each side was last given, as JSON: a change is sent only when it differs.
  const sent = useRef<Record<Side, string | null>>({ old: null, new: null });
  const postRef = useRef(post);
  postRef.current = post;

  const update = useCallback((next: Sides) => {
    sidesRef.current = next;
    setSides(next);
  }, []);

  const effective = useMemo(
    () => ({ old: resolveSide(sides, record, 'old'), new: resolveSide(sides, record, 'new') }),
    [sides, record],
  );

  // A change after opening: each side that now differs gets its values.
  useEffect(() => {
    if (!behaviors) return;
    for (const side of SIDES) {
      const settings: EditorSettings = toModuleSettings(effective[side]);
      const json = JSON.stringify(settings);
      if (sent.current[side] === json) continue;
      sent.current[side] = json;
      postRef.current({ type: 'viewer/set-editor-settings', side, settings });
    }
  }, [behaviors, effective]);

  const open = useCallback<EditorIndent['open']>(
    (texts, language, keep = false, project = null) => {
      if (!behaviors) return undefined;
      const before = sidesRef.current;
      const detectedNew = behaviors.detector.detect(texts.new);
      const next: Sides = {
        language,
        detected: {
          old: texts.old === undefined || texts.old === texts.new ? detectedNew : behaviors.detector.detect(texts.old),
          new: detectedNew,
        },
        choice: keep ? before.choice : { old: null, new: null },
        view: keep ? before.view : { old: null, new: null },
        project,
      };
      update(next);
      const payload = {} as Required<SideEditorSettings>;
      for (const side of SIDES) {
        payload[side] = toModuleSettings(resolveSide(next, recordRef.current, side));
        sent.current[side] = JSON.stringify(payload[side]);
      }
      return payload;
    },
    [behaviors, update],
  );

  const replaceSide = useCallback<EditorIndent['replaceSide']>(
    (side, text) => {
      if (!behaviors) return;
      const before = sidesRef.current;
      update({
        ...before,
        detected: { ...before.detected, [side]: behaviors.detector.detect(text) },
        choice: { ...before.choice, [side]: null },
        view: { ...before.view, [side]: null },
      });
    },
    [behaviors, update],
  );

  const setProject = useCallback<EditorIndent['setProject']>(
    project => update({ ...sidesRef.current, project }),
    [update],
  );

  const setLanguage = useCallback<EditorIndent['setLanguage']>(
    language => {
      if (sidesRef.current.language !== language) update({ ...sidesRef.current, language });
    },
    [update],
  );

  const choose = useCallback<EditorIndent['choose']>(
    (side, choice) => {
      const before = sidesRef.current;
      const targets = side === 'both' ? SIDES : [side];
      const next = { ...before.choice };
      for (const target of targets) next[target] = choice && { ...before.choice[target], ...choice };
      update({ ...before, choice: next });
    },
    [update],
  );

  const chooseView = useCallback<EditorIndent['chooseView']>(
    (side, choice) => {
      const before = sidesRef.current;
      const targets = side === 'both' ? SIDES : [side];
      const next = { ...before.view };
      for (const target of targets) next[target] = { ...before.view[target], ...choice };
      update({ ...before, view: next });
      // Without settings nothing is resolved or sent by itself: the toggle goes to the editor as it is.
      if (!behaviors)
        for (const target of targets)
          postRef.current({ type: 'viewer/set-editor-settings', side: target, settings: { ...choice } });
    },
    [behaviors, update],
  );

  const swap = useCallback(() => {
    const before = sidesRef.current;
    update({
      ...before,
      detected: { old: before.detected.new, new: before.detected.old },
      choice: { old: before.choice.new, new: before.choice.old },
      view: { old: before.view.new, new: before.view.old },
    });
    // The module carried each side's look with its text: what was sent goes along.
    sent.current = { old: sent.current.new, new: sent.current.old };
  }, [update]);

  return {
    enabled: !!behaviors,
    effective,
    choice: sides.choice,
    view: sides.view,
    language: sides.language,
    profile: { id: active.id, name: active.name },
    profiles,
    project: sides.project,
    open,
    setProject,
    replaceSide,
    setLanguage,
    choose,
    chooseView,
    swap,
  };
};
