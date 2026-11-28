/**
 * A scratch file open (D34): its bar — the way back, its name (renamed in place, as VS Code renames in its explorer:
 * Enter keeps, Escape leaves it as it was, the name without its extension selected), the language, Download and
 * Delete — over the editor module (the page in the iframe, as for a project's file), one file, editable, highlighted by
 * the language. Changing the language re-highlights the same text (`viewer/set-language`): the text, the caret and the
 * undo history stay.
 *
 * The text saves itself as a project's file does (the section's autosave, ./../../projects/autosave.ts: a pause after
 * the last change, at once on leaving, hiding the tab or ⌘S), into the store the composition root names. A refusal —
 * the scratch too long, the storage full — leaves the text in the editor and what was stored as it was, and the bar
 * says so in one line; the next edit tries again. Download is «Compare code»'s seam `SideSaver`: Save as through the
 * browser's file picker, or a download, under the scratch's file name.
 *
 * Keys (D38): while the scratch is open the view offers download, rename, change language (the page's language popup,
 * ./LanguagePicker.tsx, the scratch's language chosen) and delete (it asks first); ⌘S stays "save now". Each control's
 * tooltip says its key now.
 *
 * Indentation (D39): the scratch opens with what applies to its text (detected from it, its language's values, the
 * settings); a new language brings that language's values; the indent indicator in the editor's bar shows them and
 * changes them for this scratch while it is open.
 */
import { DeleteScratchDialog } from './DeleteScratchDialog';
import { LanguagePicker } from './LanguagePicker';
import { TEXT, printable, scratchRefusal } from './text';
import { useEditorFrame } from './useEditorFrame';
import { IndentIndicator } from '../editor/IndentIndicator';
import { useEditorIndent } from '../editor/useEditorIndent';
import { go, routeHash } from '../route';
import { hintOf, useOffer } from '../shell/sectionKeys';
import { LANGUAGES, labelOf } from '@src/compare/languages';
import { createAutosave } from '@src/projects/autosave';
import { fileName } from '@src/projects/scratch/store';
import { VIEWER_PAGE } from '@src/shared/pages';
import { sameChord } from '@src/shared/viewerProtocol';
import { Button } from '@workspace/ui/button';
import { Input } from '@workspace/ui/input';
import { Label } from '@workspace/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/select';
import { DownloadIcon, Trash2Icon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SectionKeys } from '../shell/sectionKeys';
import type { SideSaver } from '@src/compare/sideSaver';
import type { EditorSettingsBehaviors } from '@src/editorSettings/behaviors';
import type { Autosave, SaveState } from '@src/projects/autosave';
import type { ScratchInfo, ScratchRefusal, ScratchStore } from '@src/projects/scratch/store';
import type { FrameKeys, KeyChord } from '@src/shared/keys';
import type { ReactElement } from 'react';

const SAVE_KEY: KeyChord = { key: 's', mod: true, shift: false };

/** A write the store refused: the autosave keeps the edit and tries again (on the next edit, or after a while). */
class NotKept extends Error {
  constructor(readonly refusal: ScratchRefusal) {
    super(refusal.kind);
  }
}

export interface ScratchViewProps {
  id: string;
  store: ScratchStore;
  saver: SideSaver;
  frameKeys?: FrameKeys;
  /** The user's shortcuts as the section gets them; absent: no keys. */
  keys?: SectionKeys;
  autosaveDelayMs?: number;
  /** Give the editor the keyboard once the text is in (a scratch just made). */
  focus?: boolean;
  /** The editor's settings (D39); absent: the editor keeps its own defaults and there is no indicator. */
  editorSettings?: EditorSettingsBehaviors;
}

type Loaded = { kind: 'loading' } | { kind: 'missing' } | { kind: 'open'; info: ScratchInfo };

const saveText = (state: SaveState): string =>
  state.kind === 'pending' ? TEXT.pendingState : state.kind === 'saving' ? TEXT.savingState : TEXT.savedState;

export const ScratchView = ({
  id,
  store,
  saver,
  frameKeys,
  keys,
  autosaveDelayMs,
  focus,
  editorSettings,
}: ScratchViewProps): ReactElement => {
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' });
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'saved' });
  // Why the latest write was not kept; cleared by the next one that is.
  const [refused, setRefused] = useState<ScratchRefusal | null>(null);
  const [note, setNote] = useState<{ text: string; tone: 'error' | 'success' } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState<ScratchInfo | null>(null);
  const autosave = useRef<Autosave | null>(null);
  const nameField = useRef<HTMLInputElement>(null);
  const renameButton = useRef<HTMLButtonElement>(null);
  // The rename ended (Enter, Escape, or the field left): whatever comes after — the field's blur as it goes — is no
  // second answer.
  const renameEnded = useRef(true);
  // The editor's text as of its latest edit, read at each pause of the typing: what leaving the scratch writes once
  // the editor's page is gone and can no longer be asked.
  const latest = useRef<string | null>(null);
  const gone = useRef(false);
  const readRef = useRef<((side: 'old' | 'new') => Promise<string>) | null>(null);
  const frameKeysRef = useRef(frameKeys);
  frameKeysRef.current = frameKeys;

  const handedUp = useMemo(() => [SAVE_KEY, ...(frameKeys?.keys ?? [])], [frameKeys?.keys]);
  const editor = useEditorFrame(handedUp, {
    onKey: chord => {
      if (sameChord(chord, SAVE_KEY)) void autosave.current?.flush('explicit');
      else frameKeysRef.current?.run(chord);
    },
    onShown: shown => {
      if (shown.cause !== 'edit') return;
      autosave.current?.edited();
      readRef.current?.('new').then(
        text => (latest.current = text),
        () => undefined,
      );
    },
    onError: message => setNote({ text: TEXT.failed(message), tone: 'error' }),
  });
  const { request, post, read } = editor;
  readRef.current = read;
  const indent = useEditorIndent(editorSettings, post);
  const indentRef = useRef(indent);
  indentRef.current = indent;
  const [indentOpen, setIndentOpen] = useState(false);

  /** Leaves the scratch: what waits is written now. */
  const leave = useCallback(async () => {
    const current = autosave.current;
    autosave.current = null;
    if (!current) return;
    await current.flush('auto');
    current.dispose();
  }, []);

  useEffect(() => {
    let live = true;
    gone.current = false;
    latest.current = null;
    Promise.all([store.list(), store.read(id)]).then(
      ([list, text]) => {
        if (!live) return;
        const info = list.scratches.find(s => s.id === id);
        if (!info || text === null) return setLoaded({ kind: 'missing' });
        setLoaded({ kind: 'open', info });
        // No path: the bar above names the scratch, and a rename or a new language would leave a path stale.
        const editorSettings = indentRef.current.open({ new: text }, info.language)?.new;
        request(n => ({
          type: 'viewer/show-file',
          id: n,
          request: {
            path: '',
            language: info.language,
            text,
            readOnly: false,
            ...(editorSettings && { editor: editorSettings }),
          },
        }));
        if (focus) post({ type: 'viewer/set-editable', side: 'new', editable: true, focus: true });
        autosave.current = createAutosave({
          delayMs: autosaveDelayMs,
          baseHash: '0',
          savedText: text,
          read: () => (gone.current && latest.current !== null ? Promise.resolve(latest.current) : read('new')),
          save: async written => {
            const result = await store.write(id, written);
            if (!result.ok) {
              setRefused(result.refused);
              throw new NotKept(result.refused);
            }
            setRefused(null);
            setLoaded(l => (l.kind === 'open' ? { kind: 'open', info: { ...l.info, ...result.value } } : l));
            return { hash: String(result.value.updatedMs) };
          },
          onSaved: written => request(n => ({ type: 'viewer/mark-saved', id: n, side: 'new', text: written })),
          onState: setSaveState,
        });
      },
      () => live && setLoaded({ kind: 'missing' }),
    );
    return () => {
      live = false;
      gone.current = true;
      void leave();
    };
    // Opened once per scratch: `focus` only says what to do as it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, store]);

  // Leaving the page, hiding the tab or the window losing focus writes at once, as for a project's file.
  useEffect(() => {
    const now = (): void => void autosave.current?.flush('auto');
    const hidden = (): void => {
      if (document.visibilityState === 'hidden') now();
    };
    // A reload or a closed tab while an edit is not stored yet asks first, as web editors do; the write goes on meanwhile.
    const unsaved = (event: BeforeUnloadEvent): void => {
      const state = autosave.current?.state.kind;
      if (state === 'pending' || state === 'saving' || state === 'offline') {
        now();
        event.preventDefault();
      }
    };
    window.addEventListener('pagehide', now);
    window.addEventListener('blur', now);
    window.addEventListener('beforeunload', unsaved);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('beforeunload', unsaved);
      window.removeEventListener('pagehide', now);
      window.removeEventListener('blur', now);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, []);

  const info = loaded.kind === 'open' ? loaded.info : null;

  const applied = (result: Awaited<ReturnType<ScratchStore['rename']>>, before: ScratchInfo): void => {
    if (!result.ok) {
      setNote({ text: scratchRefusal(result.refused), tone: 'error' });
      return;
    }
    setNote(null);
    setLoaded({ kind: 'open', info: result.value });
    indent.setLanguage(result.value.language);
    if (result.value.language !== before.language)
      request(n => ({ type: 'viewer/set-language', id: n, language: result.value.language }));
  };

  const changeLanguage = async (language: string): Promise<void> => {
    if (!info || language === info.language) return;
    // The editor first: the highlighting follows the choice at once, whatever the storage answers.
    request(n => ({ type: 'viewer/set-language', id: n, language }));
    indent.setLanguage(language);
    setLoaded({ kind: 'open', info: { ...info, language } });
    applied(await store.setLanguage(id, language), { ...info, language });
  };

  // The field takes the keyboard when it appears; the Rename button takes it back when the field goes.
  const wasRenaming = useRef(false);
  useEffect(() => {
    if (renaming) nameField.current?.focus();
    else if (wasRenaming.current) renameButton.current?.focus();
    wasRenaming.current = renaming;
  }, [renaming]);

  const endRename = async (typed: string | null): Promise<void> => {
    if (renameEnded.current) return;
    renameEnded.current = true;
    setRenaming(false);
    if (!info || typed === null || typed === fileName(info)) return;
    applied(await store.rename(id, typed), info);
  };

  const download = async (): Promise<void> => {
    if (!info) return;
    setNote(null);
    try {
      const text = await read('new');
      const result = await saver.saveAs({ text, bom: false, suggestedName: fileName(info), handle: null });
      if (result.status === 'saved') setNote({ text: TEXT.downloaded(result.fileName, result.how), tone: 'success' });
      else if (result.status === 'failed') setNote({ text: TEXT.notDownloaded(result.message), tone: 'error' });
    } catch (error) {
      setNote({ text: TEXT.notDownloaded(error instanceof Error ? error.message : String(error)), tone: 'error' });
    }
  };

  const remove = async (scratch: ScratchInfo): Promise<void> => {
    setDeleting(null);
    // Nothing is written after the deletion: what waited would only meet a missing scratch.
    autosave.current?.dispose();
    autosave.current = null;
    const done = await store.remove(scratch.id);
    if (done.ok) go(routeHash({ section: 'projects' }));
    else setNote({ text: scratchRefusal(done.refused), tone: 'error' });
  };

  const startRename = (): void => {
    renameEnded.current = false;
    setRenaming(true);
  };
  const [picking, setPicking] = useState(false);
  useOffer(keys, {
    'scratch:download': !!info && editor.ready && (() => void download()),
    'scratch:rename': !!info && !renaming && startRename,
    'scratch:language': !!info && (() => setPicking(true)),
    'scratch:delete': !!info && (() => setDeleting(info)),
    'editor:indentation': !!info && indent.enabled && (() => setIndentOpen(true)),
  });

  const state = refused ? 'refused' : saveState.kind;
  return (
    <>
      <header className="kit-projects-bar">
        <a className="kit-projects-bar-back" href={routeHash({ section: 'projects' })}>
          {TEXT.allProjects}
        </a>
        {info &&
          (renaming ? (
            <Input
              ref={nameField}
              className="kit-projects-bar-name"
              aria-label={TEXT.scratchName}
              defaultValue={fileName(info)}
              onFocus={e => e.currentTarget.setSelectionRange(0, info.name.length)}
              onBlur={e => void endRename(e.currentTarget.value)}
              onKeyDown={e => {
                // Prevented: the key's own press would otherwise reach the Rename button, which has the focus back
                // by then, and open the field again.
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void endRename(e.currentTarget.value);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  void endRename(null);
                }
              }}
            />
          ) : (
            <h1 className="kit-projects-bar-title">{printable(fileName(info))}</h1>
          ))}
        <span className="kit-projects-class" data-class="scratch">
          {TEXT.scratchMark}
        </span>
        {info && !renaming && (
          <Button
            ref={renameButton}
            variant="ghost"
            size="sm"
            onClick={startRename}
            {...hintOf(keys, 'scratch:rename', TEXT.renameScratchTitle)}>
            {TEXT.renameScratch}
          </Button>
        )}
        {info && (
          <div className="kit-projects-bar-actions">
            <Label htmlFor="scratch-open-language" className="sr-only">
              {TEXT.scratchLanguage}
            </Label>
            <Select value={info.language} onValueChange={language => void changeLanguage(language)}>
              <SelectTrigger
                id="scratch-open-language"
                className="kit-projects-scratch-language"
                size="sm"
                {...hintOf(keys, 'scratch:language', TEXT.changeLanguageTitle)}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map(l => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              disabled={!editor.ready}
              onClick={() => void download()}
              {...hintOf(keys, 'scratch:download', TEXT.downloadScratchTitle)}>
              <DownloadIcon aria-hidden="true" />
              {TEXT.downloadScratch}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeleting(info)}
              {...hintOf(keys, 'scratch:delete', TEXT.deleteScratchTitleShort)}>
              <Trash2Icon aria-hidden="true" />
              {TEXT.deleteScratch}
            </Button>
          </div>
        )}
      </header>
      {note && (
        <p className="kit-projects-note" data-tone={note.tone} role="status">
          {note.text}
        </p>
      )}
      <div className="kit-projects-workspace">
        <section className="kit-projects-editor" aria-label={TEXT.editorTitle}>
          <div className="kit-projects-editor-bar">
            <span className="kit-projects-editor-path">{info ? printable(fileName(info)) : ''}</span>
            <span className="kit-projects-editor-tools">
              {info && indent.enabled && (
                <IndentIndicator
                  effective={indent.effective.new}
                  choice={indent.choice.new}
                  languageLabel={labelOf(info.language)}
                  onChoose={choice => indent.choose('both', choice)}
                  open={indentOpen}
                  onOpenChange={setIndentOpen}
                  settingsHref={routeHash({ section: 'settings' })}
                />
              )}
              {info && (
                <span className="kit-projects-save" data-state={state} role="status">
                  {refused ? scratchRefusal(refused) : saveText(saveState)}
                </span>
              )}
            </span>
          </div>
          <div className="kit-projects-editor-view">
            <iframe
              ref={editor.frame}
              className="kit-projects-frame"
              src={`/${VIEWER_PAGE}`}
              title={TEXT.editorTitle}
              data-ready={editor.ready ? '' : undefined}
              data-shown={editor.shownCount}
              data-mode={editor.shown?.mode}
              data-language={info?.language}
            />
            {(loaded.kind === 'missing' || editor.failed) && (
              <div className="kit-projects-card">
                <p>{editor.failed ?? TEXT.scratchMissing}</p>
              </div>
            )}
          </div>
        </section>
      </div>
      <DeleteScratchDialog scratch={deleting} onCancel={() => setDeleting(null)} onDelete={s => void remove(s)} />
      {info && (
        <LanguagePicker
          open={picking}
          onOpenChange={setPicking}
          title={TEXT.languageOf(printable(fileName(info)))}
          first={info.language}
          onChoose={language => {
            setPicking(false);
            void changeLanguage(language);
          }}
        />
      )}
    </>
  );
};
