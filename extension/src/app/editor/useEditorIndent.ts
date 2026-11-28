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
 *     `keep: false` forgets it); `null` goes back to automatic.
 *
 * Which set is active is `profile` of ../../editorSettings/resolve.ts: the stored Default set today. Without behaviors
 * (a page drawn with no settings, as in older tests) the place sends nothing and the editor keeps its own defaults.
 */
import { defaultEditorSettings } from '@src/editorSettings/model';
import { effectiveEditorSettings, toModuleSettings } from '@src/editorSettings/resolve';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EditorSettings, Side, SideEditorSettings } from '@extension/review-wasm';
import type { EditorSettingsBehaviors } from '@src/editorSettings/behaviors';
import type { DetectedIndent } from '@src/editorSettings/detect';
import type { EditorSettingsRecord } from '@src/editorSettings/model';
import type { Effective, FileChoice } from '@src/editorSettings/resolve';
import type { ToViewer } from '@src/shared/viewerProtocol';

const SIDES: readonly Side[] = ['old', 'new'];

/** The stored Default set, followed while the page is open; the Default set as it starts until it arrives. */
export const useEditorRecord = (behaviors: EditorSettingsBehaviors | undefined): EditorSettingsRecord => {
  const [record, setRecord] = useState(defaultEditorSettings);
  useEffect(() => behaviors?.store.watch(setRecord), [behaviors]);
  return record;
};

export interface EditorIndent {
  /** Whether this place has settings at all (behaviors were given). */
  readonly enabled: boolean;
  /** What applies to each side now. */
  readonly effective: Readonly<Record<Side, Effective>>;
  /** The person's choice for each side's file; null: automatic. */
  readonly choice: Readonly<Record<Side, FileChoice | null>>;
  readonly language: string;
  /**
   * New texts replace what is shown: detects each side's indentation; with `keep` the choices stay (the same file in
   * another view). Returns what the replacing request carries, or undefined without settings.
   */
  open(texts: { old?: string; new: string }, language: string, keep?: boolean): SideEditorSettings | undefined;
  /** One side's text replaced (a file dropped on it): detected again, its choice forgotten. */
  replaceSide(side: Side, text: string): void;
  /** The language of both sides changed: its values apply from now on. */
  setLanguage(language: string): void;
  /** The person's choice for a side's file (`both`: the two sides are one file); null: back to automatic. */
  choose(side: Side | 'both', choice: FileChoice | null): void;
  /** The sides traded places: their detections and choices go with them. */
  swap(): void;
}

interface Sides {
  language: string;
  detected: Record<Side, DetectedIndent | null>;
  choice: Record<Side, FileChoice | null>;
}

const resolveSide = (state: Sides, profile: EditorSettingsRecord, side: Side): Effective =>
  effectiveEditorSettings({
    profile,
    language: state.language,
    detected: state.detected[side],
    // Stage 3 (`.editorconfig`, Pro) puts the project's values here.
    project: null,
    file: state.choice[side],
  });

export const useEditorIndent = (
  behaviors: EditorSettingsBehaviors | undefined,
  post: (message: ToViewer) => void,
  initialLanguage = 'text',
): EditorIndent => {
  const record = useEditorRecord(behaviors);
  const [sides, setSides] = useState<Sides>(() => ({
    language: initialLanguage,
    detected: { old: null, new: null },
    choice: { old: null, new: null },
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
    (texts, language, keep = false) => {
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
      });
    },
    [behaviors, update],
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

  const swap = useCallback(() => {
    const before = sidesRef.current;
    update({
      ...before,
      detected: { old: before.detected.new, new: before.detected.old },
      choice: { old: before.choice.new, new: before.choice.old },
    });
    // The module carried each side's look with its text: what was sent goes along.
    sent.current = { old: sent.current.new, new: sent.current.old };
  }, [update]);

  return {
    enabled: !!behaviors,
    effective,
    choice: sides.choice,
    language: sides.language,
    open,
    replaceSide,
    setLanguage,
    choose,
    swap,
  };
};
