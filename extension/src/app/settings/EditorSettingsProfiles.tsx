/**
 * The profiles of Settings → Editor (D39 stage 2, Pro; research §4.3–§4.6, §6.2): above the values, a list of every
 * profile — Default first — where one is the active one (a radio), each with its actions: rename and delete (not
 * Default), duplicate, export to a JSON file. Under the list a new profile is made from the active one under a name of
 * its own (and becomes the active one), and a profile file is imported (checked and normalized like stored data, never
 * trusted; a refusal says what is wrong). The values under this block are the active profile's.
 *
 * Shown only where the edition has profiles (the store says `included`); elsewhere Settings → Editor has one line in
 * its place (EditorSettingsGroup.tsx). Every change is written at once into the store the edition names and reaches
 * every open editor; a refusal is said in one line and what was stored stays.
 */
import { EDITOR_TEXT } from '../editor/text';
import {
  DEFAULT_PROFILE,
  DEFAULT_PROFILE_NAME,
  PROFILES_MAX,
  PROFILE_FILE_MAX_BYTES,
  PROFILE_NAME_MAX,
  chooseActive,
  createProfile,
  deleteProfile,
  duplicateProfile,
  importProfile,
  profileFileName,
  profileFileText,
  readProfileFile,
  renameProfile,
} from '@src/editorSettings/profiles';
import { Button } from '@workspace/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/dialog';
import { Input } from '@workspace/ui/input';
import { CopyIcon, DownloadIcon, PencilIcon, Trash2Icon, UploadIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { EditorProfilesState } from '../editor/useEditorIndent';
import type { EditorSet } from '@src/editorSettings/model';
import type { EditorProfilesRecord, ImportProblem, NameProblem, ProfileChange } from '@src/editorSettings/profiles';
import type { EditorProfilesRefusal, EditorProfilesStore } from '@src/editorSettings/profilesStore';
import type { ReactElement } from 'react';

export interface EditorSettingsProfilesProps {
  store: EditorProfilesStore;
  state: EditorProfilesState;
  /** The active profile's values: what a new profile copies. */
  activeSet: EditorSet;
  /** Why a store refused, in words (after "Not created: " and the like). */
  refusalReason(refusal: EditorProfilesRefusal): string;
}

const nameReason = (problem: NameProblem | 'full' | 'not-found' | 'default', name: string): string => {
  switch (problem) {
    case 'empty':
      return EDITOR_TEXT.nameEmpty;
    case 'too-long':
      return EDITOR_TEXT.nameTooLong(PROFILE_NAME_MAX);
    case 'characters':
      return EDITOR_TEXT.nameCharacters;
    case 'taken':
      return EDITOR_TEXT.nameTaken(name.trim());
    case 'full':
      return EDITOR_TEXT.profilesFull(PROFILES_MAX);
    default:
      return EDITOR_TEXT.nameEmpty;
  }
};

const importReason = (problem: ImportProblem): string =>
  problem === 'too-large'
    ? EDITOR_TEXT.fileTooLarge(PROFILE_FILE_MAX_BYTES / 1024)
    : problem === 'not-json'
      ? EDITOR_TEXT.fileNotJson
      : EDITOR_TEXT.fileNotProfile;

/** Saves a text as a file the person keeps: a link with `download` (no `downloads` permission). */
const saveFile = (text: string, name: string): void => {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

export const EditorSettingsProfiles = ({
  store,
  state,
  activeSet,
  refusalReason,
}: EditorSettingsProfilesProps): ReactElement => {
  const record = state.profiles;
  const rows = [{ id: DEFAULT_PROFILE, name: DEFAULT_PROFILE_NAME }, ...record.profiles];
  const [note, setNote] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
  const [newName, setNewName] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const deleted = useRef(false);
  // The profile just chosen, shown as chosen until the stored record says so (or the write was refused).
  const [choosing, setChoosing] = useState<string | null>(null);
  useEffect(() => {
    if (choosing !== null && record.active === choosing) setChoosing(null);
  }, [choosing, record.active]);
  const controls = useRef(new Map<string, HTMLElement | null>());
  /** Moves the keyboard to a control as soon as it is drawn (a row's Rename once its field is gone, a radio). */
  const wanted = useRef<string | null>(null);
  const [, setFocusAsked] = useState(0);
  const focus = (key: string): void => {
    wanted.current = key;
    setFocusAsked(n => n + 1);
  };
  useEffect(() => {
    const key = wanted.current;
    const el = key === null ? undefined : controls.current.get(key);
    if (!el?.isConnected) return;
    el.focus();
    wanted.current = null;
  });

  /**
   * Applies a change to the record as it is stored now; says why when it is refused (`name`: the name it was about).
   * Returns whether it was saved.
   */
  const change = async (
    make: (latest: EditorProfilesRecord) => ProfileChange | EditorProfilesRecord,
    refused: (reason: string) => string,
    name = '',
    done?: (change: Extract<ProfileChange, { ok: true }>) => string | null,
  ): Promise<boolean> => {
    const latest = await store.load();
    const made = make(latest);
    const next = 'ok' in made ? made : { ok: true as const, record: made, id: '' };
    if (!next.ok) {
      setNote(refused(nameReason(next.problem, name)));
      return false;
    }
    const result = await store.save(next.record);
    if (!result.ok) {
      setNote(refused(refusalReason(result.refused)));
      return false;
    }
    setNote(done ? done(next) : null);
    return true;
  };

  const setOf = (id: string): EditorSet =>
    id === DEFAULT_PROFILE ? state.defaults : (record.profiles.find(p => p.id === id) ?? state.defaults);

  const create = async (): Promise<void> => {
    const name = newName;
    const ok = await change(
      latest => createProfile(latest, name, activeSet),
      EDITOR_TEXT.notCreated,
      name,
      made => EDITOR_TEXT.created(made.record.profiles.find(p => p.id === made.id)?.name ?? name),
    );
    if (ok) setNewName('');
  };

  const rename = async (): Promise<void> => {
    if (!renaming) return;
    const { id, name } = renaming;
    const ok = await change(latest => renameProfile(latest, id, name), EDITOR_TEXT.notRenamed, name);
    if (ok) {
      setRenaming(null);
      focus(`${id}:rename`);
    }
  };

  const importFile = async (file: File): Promise<void> => {
    if (file.size > PROFILE_FILE_MAX_BYTES) {
      setNote(EDITOR_TEXT.notImported(importReason('too-large')));
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      setNote(EDITOR_TEXT.notImported(EDITOR_TEXT.fileUnreadable));
      return;
    }
    const read = readProfileFile(text, EDITOR_TEXT.importedName);
    if (!read.ok) {
      setNote(EDITOR_TEXT.notImported(importReason(read.problem)));
      return;
    }
    await change(
      latest => importProfile(latest, read.profile),
      EDITOR_TEXT.notImported,
      read.profile.name,
      made => EDITOR_TEXT.imported(made.record.profiles.find(p => p.id === made.id)?.name ?? read.profile.name),
    );
  };

  return (
    <div className="kit-editor-profiles" data-editor-profiles="included">
      <h3 id="editor-profiles" className="kit-settings-subtitle">
        {EDITOR_TEXT.profilesTitle}
      </h3>
      <p className="kit-settings-intro kit-settings-hint">{EDITOR_TEXT.profilesIntro}</p>
      <div role="list" aria-labelledby="editor-profiles">
        {rows.map(row => {
          const isDefault = row.id === DEFAULT_PROFILE;
          const editing = renaming?.id === row.id;
          const radioId = `editor-profile-${row.id}`;
          return (
            <div
              key={row.id}
              role="listitem"
              className="kit-settings-row kit-editor-profile"
              data-profile={row.id}
              data-active={record.active === row.id ? '' : undefined}>
              {editing ? (
                <form
                  className="kit-editor-profile-rename"
                  onSubmit={event => {
                    event.preventDefault();
                    void rename();
                  }}>
                  <Input
                    // The input exists only after "Rename" was pressed: it takes the keyboard at once.
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus
                    aria-label={EDITOR_TEXT.profileNameLabel(row.name)}
                    className="kit-editor-profile-input"
                    value={renaming.name}
                    maxLength={PROFILE_NAME_MAX}
                    onChange={event => setRenaming({ id: row.id, name: event.target.value })}
                    onKeyDown={event => {
                      if (event.key !== 'Escape') return;
                      event.preventDefault();
                      setRenaming(null);
                      focus(`${row.id}:rename`);
                    }}
                  />
                  <Button type="submit" size="sm">
                    {EDITOR_TEXT.save}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setRenaming(null);
                      focus(`${row.id}:rename`);
                    }}>
                    {EDITOR_TEXT.cancel}
                  </Button>
                </form>
              ) : (
                <div className="kit-settings-text kit-editor-profile-choice">
                  <input
                    id={radioId}
                    type="radio"
                    name="editor-profile"
                    className="kit-editor-profile-radio"
                    ref={el => void controls.current.set(`${row.id}:radio`, el)}
                    checked={(choosing ?? record.active) === row.id}
                    aria-label={EDITOR_TEXT.profileActive(row.name)}
                    onChange={() => {
                      setChoosing(row.id);
                      void change(
                        latest => chooseActive(latest, row.id),
                        reason => EDITOR_TEXT.notSaved(reason),
                      ).then(saved => !saved && setChoosing(null));
                    }}
                  />
                  <label htmlFor={radioId} className="kit-settings-label kit-editor-profile-name">
                    {row.name}
                  </label>
                </div>
              )}
              {!editing && (
                <div className="kit-settings-controls kit-editor-profile-actions">
                  {!isDefault && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      ref={el => void controls.current.set(`${row.id}:rename`, el)}
                      aria-label={EDITOR_TEXT.profileRename(row.name)}
                      title={EDITOR_TEXT.profileRename(row.name)}
                      onClick={() => setRenaming({ id: row.id, name: row.name })}>
                      <PencilIcon aria-hidden="true" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={EDITOR_TEXT.profileDuplicate(row.name)}
                    title={EDITOR_TEXT.profileDuplicate(row.name)}
                    onClick={() =>
                      void change(
                        latest => duplicateProfile(latest, row.id, setOf(row.id)),
                        EDITOR_TEXT.notCreated,
                        row.name,
                        made => EDITOR_TEXT.created(made.record.profiles.find(p => p.id === made.id)?.name ?? ''),
                      )
                    }>
                    <CopyIcon aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={EDITOR_TEXT.profileExport(row.name)}
                    title={EDITOR_TEXT.profileExport(row.name)}
                    onClick={() => {
                      const file = profileFileName(row.name);
                      saveFile(profileFileText(row.name, setOf(row.id)), file);
                      setNote(EDITOR_TEXT.exported(file));
                    }}>
                    <DownloadIcon aria-hidden="true" />
                  </Button>
                  {!isDefault && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={EDITOR_TEXT.profileDelete(row.name)}
                      title={EDITOR_TEXT.profileDelete(row.name)}
                      onClick={() => setDeleting({ id: row.id, name: row.name })}>
                      <Trash2Icon aria-hidden="true" />
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <form
        className="kit-settings-row"
        onSubmit={event => {
          event.preventDefault();
          void create();
        }}>
        <div className="kit-settings-text">
          <label htmlFor="editor-profile-new" className="kit-settings-label">
            {EDITOR_TEXT.newProfile}
          </label>
          <span id="editor-profile-new-hint" className="kit-settings-hint">
            {EDITOR_TEXT.newProfileHint}
          </span>
        </div>
        <div className="kit-settings-controls">
          <Input
            id="editor-profile-new"
            aria-describedby="editor-profile-new-hint"
            className="kit-editor-profile-input"
            placeholder={EDITOR_TEXT.newProfileName}
            value={newName}
            maxLength={PROFILE_NAME_MAX}
            onChange={event => setNewName(event.target.value)}
          />
          <Button type="submit" variant="outline" size="sm">
            {EDITOR_TEXT.create}
          </Button>
        </div>
      </form>
      <div className="kit-settings-row">
        <div className="kit-settings-text">
          <span className="kit-settings-hint" id="editor-profile-import-hint">
            {EDITOR_TEXT.importHint}
          </span>
        </div>
        <div className="kit-settings-controls">
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            data-editor-profile-file=""
            onChange={event => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void importFile(file);
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-describedby="editor-profile-import-hint"
            onClick={() => fileInput.current?.click()}>
            <UploadIcon aria-hidden="true" />
            {EDITOR_TEXT.importProfile}
          </Button>
        </div>
      </div>
      {note && (
        <p className="kit-settings-note kit-editor-profile-note" role="status">
          {note}
        </p>
      )}
      <Dialog open={deleting !== null} onOpenChange={open => !open && setDeleting(null)}>
        <DialogContent
          onCloseAutoFocus={event => {
            // Deleted: its row is going, so the keyboard goes to the active profile; cancelled: back to Delete.
            if (!deleted.current) return;
            event.preventDefault();
            deleted.current = false;
          }}>
          <DialogHeader>
            <DialogTitle>{deleting ? EDITOR_TEXT.deleteTitle(deleting.name) : ''}</DialogTitle>
            <DialogDescription>{EDITOR_TEXT.deleteBody}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              {EDITOR_TEXT.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const gone = deleting;
                deleted.current = true;
                setDeleting(null);
                if (gone)
                  void change(
                    latest => deleteProfile(latest, gone.id),
                    reason => EDITOR_TEXT.notSaved(reason),
                    gone.name,
                    () => EDITOR_TEXT.deleted(gone.name),
                  ).then(() => focus(`${record.active === gone.id ? DEFAULT_PROFILE : record.active}:radio`));
              }}>
              {EDITOR_TEXT.deleteRun}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
